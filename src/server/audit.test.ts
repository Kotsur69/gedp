import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import * as auditModule from "./audit";
import { AuditError, writeAudit, writeAuditMany, type AuditTx } from "./audit";

function fakeTx() {
  const create = vi.fn().mockResolvedValue({});
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const tx = { auditLog: { create, createMany } } as unknown as AuditTx;
  return { tx, create, createMany };
}

describe("[SEC-03] audit writer - unit", () => {
  it("writes the mapped row through the given transaction client", async () => {
    const { tx, create } = fakeTx();
    await writeAudit(tx, { actorId: 7, entity: "performance_goal", entityId: 42, action: "UPDATE", before: { weight: 20 }, after: { weight: 30 } });
    expect(create).toHaveBeenCalledWith({
      data: { actorId: 7, entity: "performance_goal", entityId: "42", action: "UPDATE", before: { weight: 20 }, after: { weight: 30 } },
    });
  });

  it("stores missing snapshots as SQL NULL and Dates as ISO strings", async () => {
    const { tx, create } = fakeTx();
    await writeAudit(tx, { actorId: null, entity: "cycle", entityId: "2027", action: "OPEN", after: { at: new Date("2027-01-25T00:00:00Z") } });
    const data = create.mock.calls[0][0].data;
    expect(data.before).toBe(Prisma.DbNull);
    expect(data.after).toEqual({ at: "2027-01-25T00:00:00.000Z" });
  });

  it.each([
    ["empty entity", { actorId: 1, entity: " ", entityId: 1, action: "X" }],
    ["empty action", { actorId: 1, entity: "employee", entityId: 1, action: "" }],
    ["non-integer actor", { actorId: 1.5, entity: "employee", entityId: 1, action: "X" }],
    ["too long entity id", { actorId: 1, entity: "employee", entityId: "x".repeat(101), action: "X" }],
  ])("rejects an invalid entry (%s) without writing", async (_label, entry) => {
    const { tx, create } = fakeTx();
    await expect(writeAudit(tx, entry)).rejects.toBeInstanceOf(AuditError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a snapshot that cannot be serialised (BigInt)", async () => {
    const { tx } = fakeTx();
    await expect(writeAudit(tx, { actorId: 1, entity: "e", entityId: 1, action: "X", after: { n: BigInt(1) } })).rejects.toThrow(/not JSON-serialisable/);
  });

  it("writes many rows in one statement and skips empty input", async () => {
    const { tx, createMany } = fakeTx();
    await writeAuditMany(tx, []);
    expect(createMany).not.toHaveBeenCalled();
    await writeAuditMany(tx, [
      { actorId: 1, entity: "employee", entityId: 1, action: "IMPORT_NEW" },
      { actorId: 1, entity: "employee", entityId: 2, action: "IMPORT_CHANGED" },
    ]);
    expect(createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("exports no update or delete API", () => {
    expect(Object.keys(auditModule).sort()).toEqual(["AuditError", "writeAudit", "writeAuditMany"]);
  });
});

describe.skipIf(!hasTestDb)("[SEC-03] audit writer - database", () => {
  const db = hasTestDb ? createTestDb() : null!;

  beforeEach(async () => {
    await resetTestDb(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("commits together with the audited change", async () => {
    const ids = await insertPeople(db, [{ amei: "TST0001", managerAmei: null }]);
    const id = ids.get("TST0001")!;
    await db.$transaction(async (tx) => {
      const before = await tx.employee.findUniqueOrThrow({ where: { id } });
      const after = await tx.employee.update({ where: { id }, data: { department: "HR" } });
      await writeAudit(tx, { actorId: id, entity: "employee", entityId: id, action: "UPDATE", before, after });
    });
    const rows = await db.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "employee", entityId: String(id), action: "UPDATE" });
    expect((rows[0].after as { department: string }).department).toBe("HR");
  });

  it("rolls back together with the audited change", async () => {
    const ids = await insertPeople(db, [{ amei: "TST0001", managerAmei: null }]);
    const id = ids.get("TST0001")!;
    await expect(
      db.$transaction(async (tx) => {
        await tx.employee.update({ where: { id }, data: { department: "HR" } });
        await writeAudit(tx, { actorId: id, entity: "employee", entityId: id, action: "UPDATE" });
        throw new Error("business rule failed after audit");
      }),
    ).rejects.toThrow("business rule failed after audit");
    expect(await db.auditLog.count()).toBe(0);
    expect((await db.employee.findUniqueOrThrow({ where: { id } })).department).toBeNull();
  });
});
