import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import {
  canEditDocument,
  canValidateDocument,
  canViewEmployee,
  decidePermissions,
  ForbiddenError,
  isAccessError,
  NotFoundError,
  permissionsForEmployee,
  requireDocumentPermission,
  requireEmployeePermission,
  scopedDocumentsWhere,
  scopedEmployeesWhere,
  validatableDocumentsWhere,
  type AccessSubject,
  type Viewer,
} from "./permissions";

const viewer = (id: number, isHrAdmin = false): Viewer => ({ id, isHrAdmin });
const subject = (employeeId: number, managerId: number | null, validatorOverrideId: number | null = null): AccessSubject => ({
  employeeId,
  managerId,
  validatorOverrideId,
});
const sorted = (values: string[]): string[] => [...values].sort();

describe("decidePermissions - pure rules", () => {
  it("[ACC-10] an employee views and edits only their own data and never validates it", () => {
    expect(decidePermissions(viewer(5), subject(5, 2), false)).toEqual({ view: true, edit: true, validate: false });
    expect(decidePermissions(viewer(5), subject(6, 2), false)).toEqual({ view: false, edit: false, validate: false });
  });

  it("[ACC-11] N+1 views and validates a direct report but cannot edit it", () => {
    expect(decidePermissions(viewer(2), subject(5, 2), true)).toEqual({ view: true, edit: false, validate: true });
  });

  it("[ACC-12] N+2 and above only view the subtree", () => {
    expect(decidePermissions(viewer(1), subject(5, 2), true)).toEqual({ view: true, edit: false, validate: false });
  });

  it("[ACC-13] HR views and edits everyone but does not validate by default (Q-05)", () => {
    expect(decidePermissions(viewer(9, true), subject(5, 2), false)).toEqual({ view: true, edit: true, validate: false });
  });

  it("[WF-09] the override validator views and validates that person", () => {
    expect(decidePermissions(viewer(3), subject(7, null, 3), false)).toEqual({ view: true, edit: false, validate: true });
  });

  it("[WF-09] an override is additive: the manager keeps validating too", () => {
    expect(decidePermissions(viewer(2), subject(7, 2, 3), true).validate).toBe(true);
    expect(decidePermissions(viewer(3), subject(7, 2, 3), false).validate).toBe(true);
  });

  it("nobody validates their own document, even as their own manager or override", () => {
    expect(decidePermissions(viewer(5), subject(5, 5, 5), false).validate).toBe(false);
  });
});

describe("access errors", () => {
  it("carry a stable code and status that survive server-action serialization", () => {
    const notFound = new NotFoundError("document 7");
    const forbidden = new ForbiddenError("edit");
    expect([notFound.code, notFound.status, notFound.message]).toEqual(["NOT_FOUND", 404, "Not found"]);
    expect([forbidden.code, forbidden.status, forbidden.action]).toEqual(["FORBIDDEN", 403, "edit"]);
    expect(isAccessError(notFound)).toBe(true);
    expect(isAccessError(forbidden)).toBe(true);
    expect(isAccessError(new Error("boom"))).toBe(false);
    expect(isAccessError({ code: "NOT_FOUND" })).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("permissions - database", () => {
  const db = createTestDb();
  let ids: Map<string, number>;
  let docs: Map<string, number>;
  const id = (amei: string): number => {
    const value = ids.get(amei);
    if (value === undefined) throw new Error(`unknown test person ${amei}`);
    return value;
  };
  const doc = (amei: string): number => {
    const value = docs.get(amei);
    if (value === undefined) throw new Error(`no document for ${amei}`);
    return value;
  };
  const as = (amei: string): Viewer => viewer(id(amei), amei === "HR");

  // TOP -> M1 -> {A, B}; TOP -> M2 -> C; X has no manager and M2 as override validator; HR is admin.
  beforeEach(async () => {
    await resetTestDb(db);
    ids = await insertPeople(db, [
      { amei: "TOP", managerAmei: null },
      { amei: "M1", managerAmei: "TOP" },
      { amei: "M2", managerAmei: "TOP" },
      { amei: "A", managerAmei: "M1" },
      { amei: "B", managerAmei: "M1" },
      { amei: "C", managerAmei: "M2" },
      { amei: "X", managerAmei: null },
      { amei: "HR", managerAmei: null },
    ]);
    await db.employee.update({ where: { id: id("HR") }, data: { isHrAdmin: true } });
    await db.employee.update({ where: { id: id("X") }, data: { validatorOverrideId: id("M2") } });
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);

    const cycle = await db.cycle.create({ data: { year: 2027 } });
    docs = new Map();
    for (const amei of ["TOP", "M1", "A", "B", "C", "X"]) {
      const created = await db.gedpDocument.create({ data: { employeeId: id(amei), cycleId: cycle.id } });
      docs.set(amei, created.id);
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("[ACC-10] an employee opening a colleague's document by a hand-edited id gets 404, not 403", async () => {
    await expect(requireDocumentPermission(db, as("A"), doc("A"), "edit")).resolves.toMatchObject({
      employeeId: id("A"),
      documentId: doc("A"),
      status: "SZKIC",
    });
    await expect(requireDocumentPermission(db, as("A"), doc("B"), "view")).rejects.toBeInstanceOf(NotFoundError);
    await expect(requireDocumentPermission(db, as("A"), doc("M1"), "view")).rejects.toBeInstanceOf(NotFoundError);
    await expect(requireDocumentPermission(db, as("A"), 999_999, "view")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("out-of-range or malformed ids are 'not found', never a database error", async () => {
    for (const bad of [0, -1, 2_147_483_648, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(requireDocumentPermission(db, as("HR"), bad, "view")).rejects.toBeInstanceOf(NotFoundError);
      await expect(requireEmployeePermission(db, as("HR"), bad, "view")).rejects.toBeInstanceOf(NotFoundError);
      expect(await canEditDocument(db, as("HR"), bad)).toBe(false);
      expect(await canViewEmployee(db, as("HR"), bad)).toBe(false);
    }
  });

  it("[ACC-11] N+1 views and validates direct reports; editing them is 403", async () => {
    expect(await canValidateDocument(db, as("M1"), doc("A"))).toBe(true);
    expect(await canValidateDocument(db, as("M1"), doc("B"))).toBe(true);
    await expect(requireDocumentPermission(db, as("M1"), doc("A"), "validate")).resolves.toMatchObject({
      employeeId: id("A"),
    });
    expect(await canEditDocument(db, as("M1"), doc("A"))).toBe(false);
    await expect(requireDocumentPermission(db, as("M1"), doc("A"), "edit")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await canValidateDocument(db, as("M1"), doc("M1"))).toBe(false);
  });

  it("[ACC-12] N+2 views the whole subtree read-only; the parallel branch is invisible to N+1", async () => {
    for (const amei of ["M1", "M2", "A", "B", "C"]) expect(await canViewEmployee(db, as("TOP"), id(amei))).toBe(true);
    await expect(requireDocumentPermission(db, as("TOP"), doc("A"), "validate")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await canEditDocument(db, as("TOP"), doc("C"))).toBe(false);

    expect(await canViewEmployee(db, as("M1"), id("C"))).toBe(false);
    expect(await canViewEmployee(db, as("M2"), id("A"))).toBe(false);
    await expect(requireDocumentPermission(db, as("M2"), doc("A"), "view")).rejects.toBeInstanceOf(NotFoundError);
    await expect(requireEmployeePermission(db, as("M2"), id("A"), "view")).rejects.toBeInstanceOf(NotFoundError);
    expect(await canViewEmployee(db, as("A"), id("TOP"))).toBe(false);
  });

  it("[ACC-13] HR views and edits every document", async () => {
    for (const amei of ["TOP", "A", "C", "X"]) {
      expect(await canViewEmployee(db, as("HR"), id(amei))).toBe(true);
      expect(await canEditDocument(db, as("HR"), doc(amei))).toBe(true);
      await expect(requireDocumentPermission(db, as("HR"), doc(amei), "edit")).resolves.toBeDefined();
    }
    expect(await canValidateDocument(db, as("HR"), doc("A"))).toBe(false);
    await expect(requireEmployeePermission(db, as("HR"), id("A"), "validate")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("[WF-09] the override validator views and validates a person without a manager", async () => {
    expect(await canValidateDocument(db, as("M2"), doc("X"))).toBe(true);
    expect(await canViewEmployee(db, as("M1"), id("X"))).toBe(false);
    expect(await canViewEmployee(db, as("TOP"), id("X"))).toBe(false);
  });

  it("[WF-09] an override on someone with a manager adds a validator without removing the manager", async () => {
    await db.employee.update({ where: { id: id("A") }, data: { validatorOverrideId: id("M2") } });
    expect(await canValidateDocument(db, as("M1"), doc("A"))).toBe(true);
    expect(await canValidateDocument(db, as("M2"), doc("A"))).toBe(true);
    expect(await canViewEmployee(db, as("M2"), id("A"))).toBe(true);
  });

  it("a manager change flips access immediately", async () => {
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: id("A") }, data: { managerId: id("M2") } });
      await rebuildHierarchy(tx);
    }, HIERARCHY_TX_OPTIONS);

    expect(await canViewEmployee(db, as("M1"), id("A"))).toBe(false);
    expect(await canValidateDocument(db, as("M1"), doc("A"))).toBe(false);
    expect(await canValidateDocument(db, as("M2"), doc("A"))).toBe(true);
    expect(await canViewEmployee(db, as("TOP"), id("A"))).toBe(true);
  });

  it("checks run on a transaction client and see the transaction's own uncommitted changes", async () => {
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: id("A") }, data: { managerId: id("M2") } });
      expect(await canValidateDocument(tx, as("M2"), doc("A"))).toBe(true);
      expect(await canValidateDocument(tx, as("M1"), doc("A"))).toBe(false);
      throw new Error("rollback");
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    });
    expect(await canValidateDocument(db, as("M1"), doc("A"))).toBe(true);
  });

  it("scopedEmployeesWhere returns exactly the people the per-record rule lets each viewer see", async () => {
    const everyone = [...ids.keys()];
    for (const amei of everyone) {
      const v = as(amei);
      const listed = await db.employee.findMany({ where: scopedEmployeesWhere(v), select: { amei: true } });
      const allowed: string[] = [];
      for (const other of everyone) if ((await permissionsForEmployee(db, v, id(other))).view) allowed.push(other);
      expect(sorted(listed.map((e) => e.amei)), `scope of ${amei}`).toEqual(sorted(allowed));
    }
  });

  it("scopedDocumentsWhere and validatableDocumentsWhere match the per-record rule for every viewer", async () => {
    for (const amei of ids.keys()) {
      const v = as(amei);
      const visible = await db.gedpDocument.findMany({ where: scopedDocumentsWhere(v), select: { id: true } });
      const validatable = await db.gedpDocument.findMany({ where: validatableDocumentsWhere(v), select: { id: true } });
      const expectedVisible: number[] = [];
      const expectedValidatable: number[] = [];
      for (const docId of docs.values()) {
        const access = await requireDocumentPermission(db, v, docId, "view").catch(() => null);
        if (access) expectedVisible.push(docId);
        if (access?.permissions.validate) expectedValidatable.push(docId);
      }
      const byNumber = (a: number, b: number) => a - b;
      expect(visible.map((d) => d.id).sort(byNumber), `visible to ${amei}`).toEqual(expectedVisible.sort(byNumber));
      expect(validatable.map((d) => d.id).sort(byNumber), `validatable by ${amei}`).toEqual(
        expectedValidatable.sort(byNumber),
      );
    }
  });

  it("a caller's own OR / employee filter narrows the scope and never widens it", async () => {
    const search = { OR: [{ lastName: "C" }, { lastName: "A" }] };
    const people = await db.employee.findMany({ where: scopedEmployeesWhere(as("M1"), search), select: { amei: true } });
    expect(people.map((e) => e.amei)).toEqual(["A"]);

    const documents = await db.gedpDocument.findMany({
      where: scopedDocumentsWhere(as("M1"), { employee: { lastName: { in: ["A", "C"] } } }),
      select: { employee: { select: { amei: true } } },
    });
    expect(documents.map((d) => d.employee.amei)).toEqual(["A"]);
  });
});
