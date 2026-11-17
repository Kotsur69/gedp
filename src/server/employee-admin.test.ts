import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeEditPayload } from "@/domain/employee-edit";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import {
  AUDIT_ACTION_UPDATE,
  EmployeeAdminError,
  employeeListWhere,
  listEmployees,
  loadEmployeeFilterOptions,
  parseEmployeeListFilters,
  updateEmployee,
  type EmployeeAdminDb,
} from "./employee-admin";
import { HIERARCHY_TX_OPTIONS, isDirectReport, isInSubtree, rebuildHierarchy } from "./hierarchy";
import { ForbiddenError } from "./permissions";

const HR = { id: 1, isHrAdmin: true };

describe("[HR-04] list filters - pure", () => {
  it("defaults to no filter and page 1", () => {
    expect(parseEmployeeListFilters({})).toEqual({
      q: "",
      department: "",
      manager: "",
      active: "all",
      whiteCollar: "all",
      hrAdmin: "all",
      page: 1,
    });
    expect(employeeListWhere(parseEmployeeListFilters({}))).toEqual({});
  });

  it("falls back on invalid or repeated params instead of failing", () => {
    const filters = parseEmployeeListFilters({ active: "maybe", page: "-3", q: ["jan", "x"], hrAdmin: "yes" });
    expect(filters).toMatchObject({ active: "all", page: 1, q: "jan", hrAdmin: "yes" });
    expect(parseEmployeeListFilters({ q: "x".repeat(101) }).q).toBe("");
  });

  it("requires every search word and combines all filters", () => {
    const where = employeeListWhere(
      parseEmployeeListFilters({ q: " Jan  Kow ", department: "IT", manager: "ab1", active: "no", whiteCollar: "yes" }),
    );
    const and = where.AND as unknown[];
    expect(and).toHaveLength(6);
    expect(and[0]).toMatchObject({ OR: expect.arrayContaining([{ firstName: { contains: "Jan", mode: "insensitive" } }]) });
    expect(and).toContainEqual({ department: "IT" });
    expect(and).toContainEqual({ manager: { amei: "AB1" } });
    expect(and).toContainEqual({ isActive: false });
    expect(and).toContainEqual({ isWhiteCollar: true });
  });
});

describe("[HR-04] access and input - no database", () => {
  const notHrDb = {
    employee: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  } as unknown as EmployeeAdminDb;

  const input: EmployeeEditPayload = {
    employeeId: 5,
    version: "2026-11-17T10:00:00.000Z",
    managerAmei: "",
    department: "",
    position: "",
    location: "",
    isActive: true,
    isHrAdmin: false,
  };

  it("refuses a non-HR viewer and an HR viewer whose live row lost HR rights", async () => {
    await expect(listEmployees(notHrDb, { id: 2, isHrAdmin: false }, parseEmployeeListFilters({}))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(loadEmployeeFilterOptions(notHrDb, HR)).rejects.toThrow(ForbiddenError);
  });

  it("rejects an invalid payload before opening a transaction", async () => {
    await expect(updateEmployee(notHrDb, HR, { ...input, managerAmei: "??" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { managerAmei: "INVALID_AMEI" },
    });
    expect(notHrDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses HR deactivating themselves or dropping their own HR flag", async () => {
    const self = { ...input, employeeId: HR.id, isHrAdmin: true };
    await expect(updateEmployee(notHrDb, HR, { ...self, isActive: false })).rejects.toMatchObject({
      code: "SELF_LOCKOUT",
      fieldErrors: { isActive: "SELF_LOCKOUT" },
    });
    await expect(updateEmployee(notHrDb, HR, { ...self, isHrAdmin: false })).rejects.toMatchObject({
      code: "SELF_LOCKOUT",
      fieldErrors: { isHrAdmin: "SELF_LOCKOUT" },
    });
  });
});

describe.skipIf(!hasTestDb)("[HR-04] employee edit - database", () => {
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  const id = (amei: string) => ids.get(amei)!;
  let hr: { id: number; isHrAdmin: true };

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetTestDb(db);
    // TSTHR (HR, top) ; TSTTOP -> TSTA -> TSTA1 ; TSTTOP -> TSTB
    ids = await insertPeople(db, [
      { amei: "TSTHR", managerAmei: null },
      { amei: "TSTTOP", managerAmei: null },
      { amei: "TSTA", managerAmei: "TSTTOP" },
      { amei: "TSTB", managerAmei: "TSTTOP" },
      { amei: "TSTA1", managerAmei: "TSTA" },
    ]);
    await db.employee.update({ where: { id: id("TSTHR") }, data: { isHrAdmin: true } });
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);
    hr = { id: id("TSTHR"), isHrAdmin: true };
  });

  async function formFor(amei: string): Promise<EmployeeEditPayload> {
    const row = await db.employee.findUniqueOrThrow({
      where: { id: id(amei) },
      include: { manager: { select: { amei: true } } },
    });
    return {
      employeeId: row.id,
      version: row.updatedAt.toISOString(),
      managerAmei: row.manager?.amei ?? "",
      department: row.department ?? "",
      position: row.position ?? "",
      location: row.location ?? "",
      isActive: row.isActive,
      isHrAdmin: row.isHrAdmin,
    };
  }

  const auditRows = () => db.auditLog.findMany({ orderBy: { id: "asc" } });

  it("a manager change rebuilds the hierarchy at once: visibility moves to the new manager", async () => {
    expect(await isInSubtree(db, id("TSTA"), id("TSTA1"))).toBe(true);

    const result = await updateEmployee(db, hr, { ...(await formFor("TSTA1")), managerAmei: "tstb" });

    expect(result.changes).toEqual([{ field: "managerAmei", before: "TSTA", after: "TSTB" }]);
    expect(await isDirectReport(db, id("TSTB"), id("TSTA1"))).toBe(true);
    expect(await isInSubtree(db, id("TSTA"), id("TSTA1"))).toBe(false);
    expect(await isInSubtree(db, id("TSTTOP"), id("TSTA1"))).toBe(true);
  });

  it("rejects a cycle-creating manager change and writes nothing", async () => {
    const before = await db.employeeHierarchy.count();
    // TSTA1 reports to TSTA, so TSTA under TSTA1 would form a loop.
    await expect(updateEmployee(db, hr, { ...(await formFor("TSTA")), managerAmei: "TSTA1" })).rejects.toMatchObject({
      code: "HIERARCHY_CYCLE",
      fieldErrors: { managerAmei: "HIERARCHY_CYCLE" },
    });

    const row = await db.employee.findUniqueOrThrow({ where: { id: id("TSTA") } });
    expect(row.managerId).toBe(id("TSTTOP"));
    expect(await db.employeeHierarchy.count()).toBe(before);
    expect(await isDirectReport(db, id("TSTA"), id("TSTA1"))).toBe(true);
    expect(await auditRows()).toEqual([]);
  });

  it("rejects a person as their own manager and an unknown manager", async () => {
    await expect(updateEmployee(db, hr, { ...(await formFor("TSTA")), managerAmei: "TSTA" })).rejects.toMatchObject({
      code: "SELF_MANAGER",
    });
    await expect(updateEmployee(db, hr, { ...(await formFor("TSTA")), managerAmei: "ZZZ999" })).rejects.toMatchObject({
      code: "UNKNOWN_MANAGER",
    });
    expect(await auditRows()).toEqual([]);
  });

  it("audits every edit with the changed fields before and after", async () => {
    await updateEmployee(db, hr, {
      ...(await formFor("TSTB")),
      department: "Sprzedaż",
      position: "Specjalista",
      isActive: false,
      isHrAdmin: true,
    });

    const [audit] = await auditRows();
    expect(audit).toMatchObject({
      actorId: hr.id,
      entity: "employee",
      entityId: String(id("TSTB")),
      action: AUDIT_ACTION_UPDATE,
      before: { department: null, position: null, isActive: true, isHrAdmin: false },
      after: { department: "Sprzedaż", position: "Specjalista", isActive: false, isHrAdmin: true },
    });
    const row = await db.employee.findUniqueOrThrow({ where: { id: id("TSTB") } });
    expect(row).toMatchObject({ department: "Sprzedaż", position: "Specjalista", isActive: false, isHrAdmin: true });
  });

  it("a save without changes writes no row and no audit", async () => {
    const result = await updateEmployee(db, hr, await formFor("TSTB"));
    expect(result.changes).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  it("rejects a stale form instead of overwriting a newer change", async () => {
    const stale = await formFor("TSTB");
    await updateEmployee(db, hr, { ...stale, location: "Oddział A" });
    await expect(updateEmployee(db, hr, { ...stale, location: "Oddział B" })).rejects.toBeInstanceOf(EmployeeAdminError);
    const row = await db.employee.findUniqueOrThrow({ where: { id: id("TSTB") } });
    expect(row.location).toBe("Oddział A");
    expect(await auditRows()).toHaveLength(1);
  });

  it("refuses an HR viewer whose live row is no longer HR", async () => {
    await db.employee.update({ where: { id: hr.id }, data: { isHrAdmin: false } });
    await expect(updateEmployee(db, hr, await formFor("TSTB"))).rejects.toThrow(ForbiddenError);
  });

  it("lists, searches and filters with the manager shown", async () => {
    await db.employee.update({ where: { id: id("TSTB") }, data: { department: "IT", isActive: false } });

    const all = await listEmployees(db, hr, parseEmployeeListFilters({}));
    expect(all.total).toBe(5);
    const a1 = all.items.find((item) => item.amei === "TSTA1");
    expect(a1).toMatchObject({ managerAmei: "TSTA", managerName: "Test TSTA" });

    const search = await listEmployees(db, hr, parseEmployeeListFilters({ q: "tsta1" }));
    expect(search.items.map((item) => item.amei)).toEqual(["TSTA1"]);

    const byManager = await listEmployees(db, hr, parseEmployeeListFilters({ manager: "tsttop" }));
    expect(byManager.items.map((item) => item.amei).sort()).toEqual(["TSTA", "TSTB"]);

    const inactiveIt = await listEmployees(db, hr, parseEmployeeListFilters({ department: "IT", active: "no" }));
    expect(inactiveIt.items.map((item) => item.amei)).toEqual(["TSTB"]);

    const options = await loadEmployeeFilterOptions(db, hr);
    expect(options.departments).toEqual(["IT"]);
    expect(options.managers.map((m) => m.amei)).not.toContain("TSTB");
  });
});
