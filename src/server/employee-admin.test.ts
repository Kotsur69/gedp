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
import { ForbiddenError, permissionsForEmployee } from "./permissions";

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
    validatorOverrideAmei: "",
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

describe("[WF-09] override validator - HR sets who validates (fake transaction, no database)", () => {
  interface FakePerson {
    id: number;
    amei: string;
    managerId: number | null;
    validatorOverrideId: number | null;
    isActive: boolean;
    isWhiteCollar: boolean;
    isHrAdmin: boolean;
  }
  const VERSION = "2026-11-17T10:00:00.000Z";
  const fakePerson = (id: number, amei: string, extra: Partial<FakePerson> = {}): FakePerson => ({
    id,
    amei,
    managerId: null,
    validatorOverrideId: null,
    isActive: true,
    isWhiteCollar: true,
    isHrAdmin: false,
    ...extra,
  });
  // HR (1, HR admin) ; TOP (2, no manager) ; OV (3) ; GONE (4, inactive) ; BLUE (5, not White Collar)
  const people = () => [
    fakePerson(1, "TSTHR", { isHrAdmin: true }),
    fakePerson(2, "TSTTOP"),
    fakePerson(3, "TSTOV"),
    fakePerson(4, "TSTGONE", { isActive: false }),
    fakePerson(5, "TSTBLUE", { isWhiteCollar: false }),
  ];

  /** Implements only the calls updateEmployee makes when the manager does not move. */
  function fakeDb(initial: FakePerson[]) {
    const state = { people: structuredClone(initial), updates: [] as unknown[], audit: [] as Record<string, unknown>[] };
    const byId = (id: number | null) => state.people.find((p) => p.id === id);
    const ameiOf = (id: number | null) => (id === null ? null : { amei: byId(id)!.amei });
    const tx = {
      $executeRaw: async () => 0,
      $queryRaw: async () => [],
      employee: {
        findFirst: async ({ where }: { where: { id: number; isActive: true; isHrAdmin: true } }) => {
          const p = byId(where.id);
          return p?.isActive && p.isHrAdmin ? { id: p.id } : null;
        },
        findUnique: async ({ where }: { where: { id?: number; amei?: string } }) => {
          if (where.amei !== undefined) {
            const p = state.people.find((x) => x.amei === where.amei);
            return p ? { id: p.id, isActive: p.isActive, isWhiteCollar: p.isWhiteCollar } : null;
          }
          const p = byId(where.id ?? null);
          if (!p) return null;
          return {
            ...p,
            department: null,
            position: null,
            location: null,
            updatedAt: new Date(VERSION),
            manager: ameiOf(p.managerId),
            validatorOverride: ameiOf(p.validatorOverrideId),
          };
        },
        update: async ({ where, data }: { where: { id: number }; data: Partial<FakePerson> }) => {
          state.updates.push({ id: where.id, data });
          Object.assign(byId(where.id)!, data);
          return {};
        },
      },
      auditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.audit.push(data);
          return data;
        },
      },
    };
    const db = { ...tx, $transaction: async <T,>(fn: (client: typeof tx) => Promise<T>) => fn(tx) };
    return { db: db as unknown as EmployeeAdminDb, state };
  }

  const form = (employeeId: number, validatorOverrideAmei: string): EmployeeEditPayload => ({
    employeeId,
    version: VERSION,
    managerAmei: "",
    validatorOverrideAmei,
    department: "",
    position: "",
    location: "",
    isActive: true,
    isHrAdmin: false,
  });

  it("sets the override of a person without a manager, audited, without touching the manager", async () => {
    const { db, state } = fakeDb(people());
    const result = await updateEmployee(db, HR, form(2, " tstov "));

    expect(result.changes).toEqual([{ field: "validatorOverrideAmei", before: null, after: "TSTOV" }]);
    expect(state.updates).toEqual([{ id: 2, data: { validatorOverrideId: 3 } }]);
    expect(state.audit).toEqual([
      expect.objectContaining({
        actorId: HR.id,
        entity: "employee",
        entityId: "2",
        action: AUDIT_ACTION_UPDATE,
        before: { validatorOverrideAmei: null },
        after: { validatorOverrideAmei: "TSTOV" },
      }),
    ]);
  });

  it("clears an override with an empty field; an unchanged override writes nothing", async () => {
    const initial = people().map((p) => (p.id === 2 ? { ...p, validatorOverrideId: 3 } : p));
    const unchanged = fakeDb(initial);
    expect((await updateEmployee(unchanged.db, HR, form(2, "TSTOV"))).changes).toEqual([]);
    expect(unchanged.state.audit).toEqual([]);

    const { db, state } = fakeDb(initial);
    await updateEmployee(db, HR, form(2, ""));
    expect(state.updates).toEqual([{ id: 2, data: { validatorOverrideId: null } }]);
    expect(state.audit).toEqual([expect.objectContaining({ after: { validatorOverrideAmei: null } })]);
  });

  it("refuses the person themselves, an unknown AMEI and someone who cannot sign in", async () => {
    const cases = [
      ["TSTTOP", "SELF_VALIDATOR"],
      ["ZZZ999", "UNKNOWN_VALIDATOR"],
      ["TSTGONE", "INACTIVE_VALIDATOR"],
      ["TSTBLUE", "INACTIVE_VALIDATOR"],
    ] as const;
    for (const [amei, code] of cases) {
      const { db, state } = fakeDb(people());
      await expect(updateEmployee(db, HR, form(2, amei)), amei).rejects.toMatchObject({
        code,
        fieldErrors: { validatorOverrideAmei: code },
      });
      expect(state.updates).toEqual([]);
      expect(state.audit).toEqual([]);
    }
  });

  it("non-HR is refused, and so is an HR session whose live row lost HR rights", async () => {
    const { db, state } = fakeDb(people());
    await expect(updateEmployee(db, { id: 3, isHrAdmin: false }, form(2, "TSTOV"))).rejects.toThrow(ForbiddenError);

    const demoted = fakeDb(people().map((p) => (p.id === 1 ? { ...p, isHrAdmin: false } : p)));
    await expect(updateEmployee(demoted.db, HR, form(2, "TSTOV"))).rejects.toThrow(ForbiddenError);
    expect([...state.updates, ...demoted.state.updates]).toEqual([]);
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
      include: { manager: { select: { amei: true } }, validatorOverride: { select: { amei: true } } },
    });
    return {
      employeeId: row.id,
      version: row.updatedAt.toISOString(),
      managerAmei: row.manager?.amei ?? "",
      validatorOverrideAmei: row.validatorOverride?.amei ?? "",
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

  it("[WF-09] an override set by HR lets that person validate someone at the top of the structure", async () => {
    const validator = { id: id("TSTB"), isHrAdmin: false };
    expect((await permissionsForEmployee(db, validator, id("TSTTOP"))).validate).toBe(false);

    await updateEmployee(db, hr, { ...(await formFor("TSTTOP")), validatorOverrideAmei: "tstb" });

    expect((await permissionsForEmployee(db, validator, id("TSTTOP"))).validate).toBe(true);
    const [audit] = await auditRows();
    expect(audit).toMatchObject({ before: { validatorOverrideAmei: null }, after: { validatorOverrideAmei: "TSTB" } });
    const listed = await listEmployees(db, hr, parseEmployeeListFilters({ q: "tsttop" }));
    expect(listed.items[0]).toMatchObject({ validatorOverrideAmei: "TSTB", validatorOverrideName: "Test TSTB" });
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
