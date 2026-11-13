import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

// Append-only audit writer (SEC-03, plan section 6). Callers pass the transaction client of the
// change they audit, so the data change and its audit rows commit or roll back together:
//
//   await prisma.$transaction(async (tx) => {
//     const after = await tx.performanceGoal.update(...);
//     await writeAudit(tx, { actorId, entity: "performance_goal", entityId: after.id, action: "UPDATE", before, after });
//   });
//
// There is deliberately no update or delete API; the database also revokes both from the app role.

/** Only the audit_log delegate is needed, so any transaction client (or the root client) fits. */
export type AuditTx = Pick<Prisma.TransactionClient, "auditLog">;

const MAX_NAME_LENGTH = 100;
const MAX_ENTITY_ID_LENGTH = 100;

const auditEntrySchema = z.object({
  // Null for system actions (imports run by a job, scheduled tasks).
  actorId: z.number().int().positive().nullable(),
  entity: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  entityId: z
    .union([z.string(), z.number().int()])
    .transform(String)
    .pipe(z.string().trim().min(1).max(MAX_ENTITY_ID_LENGTH)),
  action: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

export type AuditEntry = z.input<typeof auditEntrySchema>;

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

type AuditJson = Prisma.InputJsonValue | typeof Prisma.DbNull;

// Snapshots are stored as plain JSON (Dates become ISO strings); missing values become SQL NULL.
function toAuditJson(value: unknown, field: "before" | "after"): AuditJson {
  if (value === undefined || value === null) return Prisma.DbNull;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AuditError(`Audit "${field}" snapshot is not JSON-serialisable: ${reason}`);
  }
}

function toRow(entry: AuditEntry): Prisma.AuditLogCreateManyInput {
  const parsed = auditEntrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new AuditError(`Invalid audit entry: ${z.prettifyError(parsed.error)}`);
  }
  const { actorId, entity, entityId, action, before, after } = parsed.data;
  return {
    actorId,
    entity,
    entityId,
    action,
    before: toAuditJson(before, "before"),
    after: toAuditJson(after, "after"),
  };
}

/** Appends one audit row using the caller's transaction client. */
export async function writeAudit(tx: AuditTx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({ data: toRow(entry) });
}

/** Appends several audit rows in one statement (e.g. one per imported employee). */
export async function writeAuditMany(tx: AuditTx, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.auditLog.createMany({ data: entries.map(toRow) });
}
