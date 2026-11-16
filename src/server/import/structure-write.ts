import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { writeAuditMany, type AuditEntry } from "@/server/audit";
import { rebuildHierarchy } from "@/server/hierarchy";
import type { ApplyContext, ImportPlan, PlannedChange } from "./pipeline";
import type { StructureRecord } from "./structure";

// Write step of the structure import. Runs inside the pipeline's confirm transaction, after the
// employee rows and the hierarchy were locked and the plan was recomputed and its fingerprint
// checked, so every manager AMEI in the plan resolves and the resulting structure is acyclic.
// Deactivation only flips is_active: documents, goals and history stay for HR (ACC-04).

type StructureChange = PlannedChange<StructureRecord>;

const AUDIT_ENTITY = "employee";
// Keeps every multi-row INSERT far below Postgres' 65,535 bind-parameter limit.
const INSERT_CHUNK_SIZE = 1000;

const toDate = (isoDate: string | null): Date | null => (isoDate === null ? null : new Date(`${isoDate}T00:00:00.000Z`));

function columns(record: StructureRecord): Omit<Prisma.EmployeeCreateManyInput, "managerId"> {
  return {
    amei: record.amei,
    email: record.email,
    firstName: record.firstName,
    lastName: record.lastName,
    department: record.department,
    position: record.position,
    location: record.location,
    isWhiteCollar: record.isWhiteCollar,
    isActive: record.isActive,
    isHrAdmin: record.isHrAdmin,
    hireDate: toDate(record.hireDate),
  };
}

/** Only the changed columns of an update; the manager AMEI becomes a manager id. */
function changedColumns(change: StructureChange, managerIdOf: (amei: string) => number): Prisma.EmployeeUncheckedUpdateInput {
  const all: Record<string, unknown> = columns(change.after);
  const data = Object.fromEntries(change.fields.filter((f) => f.field in all).map((f) => [f.field, all[f.field]]));
  const { managerAmei } = change.after;
  const managerMoved = change.fields.some((f) => f.field === "managerAmei");
  return managerMoved ? { ...data, managerId: managerAmei === null ? null : managerIdOf(managerAmei) } : data;
}

function chunks<T>(items: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / INSERT_CHUNK_SIZE) }, (_, i) =>
    items.slice(i * INSERT_CHUNK_SIZE, (i + 1) * INSERT_CHUNK_SIZE),
  );
}

async function idsByAmei(tx: Prisma.TransactionClient): Promise<Map<string, number>> {
  const rows = await tx.employee.findMany({ select: { id: true, amei: true } });
  return new Map(rows.map((r) => [r.amei, r.id]));
}

function resolver(ids: ReadonlyMap<string, number>): (amei: string) => number {
  return (amei) => {
    const id = ids.get(amei);
    if (id === undefined) throw new Error(`Import plan refers to unknown AMEI ${amei}`);
    return id;
  };
}

const changedValues = (change: StructureChange, side: "before" | "after") =>
  Object.fromEntries(change.fields.map((f) => [f.field, f[side]]));

function auditEntries(plan: ImportPlan<StructureRecord>, idOf: (amei: string) => number, ctx: ApplyContext): AuditEntry[] {
  const entry = (change: StructureChange, action: string, before: unknown, after: object): AuditEntry => ({
    actorId: ctx.actorId,
    entity: AUDIT_ENTITY,
    entityId: idOf(change.key),
    action,
    before,
    after: { ...after, importBatchId: ctx.batchId },
  });
  return [
    ...plan.created.map((c) => entry(c, "IMPORT_CREATE", null, c.after)),
    ...plan.changed.map((c) => entry(c, "IMPORT_UPDATE", changedValues(c, "before"), changedValues(c, "after"))),
    ...plan.deactivated.map((c) => entry(c, "IMPORT_DEACTIVATE", changedValues(c, "before"), changedValues(c, "after"))),
  ];
}

/** Applies a structure plan: create, update, deactivate, rebuild the hierarchy, audit each change. */
export async function applyStructure(
  tx: Prisma.TransactionClient,
  plan: ImportPlan<StructureRecord>,
  ctx: ApplyContext,
): Promise<void> {
  const existingId = resolver(await idsByAmei(tx));

  // Two people may swap e-mails in one file; park the moving ones first so the unique index holds.
  for (const change of plan.changed.filter((c) => c.fields.some((f) => f.field === "email"))) {
    const id = existingId(change.key);
    await tx.employee.update({ where: { id }, data: { email: `import-${ctx.batchId}-${id}@pending.invalid` } });
  }

  for (const batch of chunks(plan.created)) {
    await tx.employee.createMany({ data: batch.map((c) => columns(c.after)) });
  }
  const idOf = resolver(await idsByAmei(tx));

  for (const change of plan.changed) {
    await tx.employee.update({ where: { id: idOf(change.key) }, data: changedColumns(change, idOf) });
  }
  for (const change of plan.created) {
    const { managerAmei } = change.after;
    if (managerAmei !== null) {
      await tx.employee.update({ where: { id: idOf(change.key) }, data: { managerId: idOf(managerAmei) } });
    }
  }
  for (const batch of chunks(plan.deactivated)) {
    await tx.employee.updateMany({ where: { amei: { in: batch.map((c) => c.key) } }, data: { isActive: false } });
  }

  await rebuildHierarchy(tx);
  for (const batch of chunks(auditEntries(plan, idOf, ctx))) {
    await writeAuditMany(tx, batch);
  }
}
