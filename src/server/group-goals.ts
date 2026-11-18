import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { CycleStatus, DocumentStatus, GroupGoalType } from "@/generated/prisma/enums";
import { EDITABLE_DOCUMENT_STATUSES } from "@/domain/document-status";
import {
  HR_CORRECTION_AUDIT_ACTION,
  parseHrCorrectionReason,
  type HrCorrectionReasonErrorCode,
} from "@/domain/hr-correction";
import { writeAudit } from "@/server/audit";
import { lockHrGoalDocument } from "@/server/goal-document";
import { ForbiddenError, requireDocumentPermission, type Viewer } from "@/server/permissions";

// Goal Centre, Part 1: the three Group goals (G1-01..12, WF-23).
//
// - Leadership (PRZYWODZTWO) and Company values (WARTOSCI): HR-defined text, read-only. The owner
//   acknowledges once ("Potwierdzam zapoznanie"); the ack row is the lock - there is no update or
//   delete path for it, so nobody can edit or un-acknowledge (G1-05, G1-06).
// - Health and safety (BHP): Believe in Zero text + the owner's own commitment (1..1000 chars).
//   Saving the commitment counts as acknowledged (G1-09); it stays editable while the document is
//   not sent (G1-11).
//
// Who: requireDocumentPermission(..., "edit") plus "owner only". HR may edit documents in general,
// but an acknowledgement or a personal commitment made by someone else would be a false statement.
// When: only in an OPEN cycle and while the document is SZKIC or ZWROCONY (not sent / returned).
// Both rules are re-asserted inside the write transaction, which also locks the document row.
//
// HR-07 (correctBhpCommitmentAsHr): an active HR admin corrects the text of a BHP commitment the
// employee has already saved, in any status and cycle, with a required reason kept in the audit
// row. HR never creates a commitment or an acknowledgement on someone's behalf.

export const BHP_COMMITMENT_MAX_LENGTH = 1000;

// Same rule as cycles.ts isCycleReadOnly; not imported because cycles.ts pulls in the auth session.
const isCycleReadOnly = (status: CycleStatus): boolean => status !== "OTWARTY";

/** Statuses in which the owner may still change the document; the rule lives in the workflow domain. */
export { EDITABLE_DOCUMENT_STATUSES };

const MAX_INT4 = 2_147_483_647;
const dbIdSchema = z.number().int().min(1).max(MAX_INT4);

export const bhpCommitmentSchema = z
  .string()
  .trim()
  .min(1, "COMMITMENT_REQUIRED")
  .max(BHP_COMMITMENT_MAX_LENGTH, "COMMITMENT_TOO_LONG")
  // Postgres text cannot store NUL; refuse it here instead of failing in the database.
  .refine((value) => !value.includes("\u0000"), "INVALID_INPUT");

export const acknowledgeInputSchema = z.object({ documentId: dbIdSchema, templateId: dbIdSchema }).strict();

export const bhpCommitmentInputSchema = z
  .object({ documentId: dbIdSchema, templateId: dbIdSchema, commitment: bhpCommitmentSchema })
  .strict();

/** HR-07: the reason is checked separately (parseHrCorrectionReason) so its own codes reach the form. */
export const hrBhpCorrectionInputSchema = z
  .object({ documentId: dbIdSchema, templateId: dbIdSchema, commitment: bhpCommitmentSchema, reason: z.unknown() })
  .strict();

export type GroupGoalErrorCode =
  | "INVALID_INPUT"
  | "COMMITMENT_REQUIRED"
  | "COMMITMENT_TOO_LONG"
  | "NOT_EDITABLE"
  | "ALREADY_ACKNOWLEDGED"
  | "WRONG_GOAL_TYPE"
  | "TEMPLATE_NOT_FOUND"
  /** HR-07: there is no saved commitment to correct. */
  | "NOT_ACKNOWLEDGED"
  | HrCorrectionReasonErrorCode;

export class GroupGoalError extends Error {
  constructor(readonly code: GroupGoalErrorCode) {
    super(`Group goal: ${code}`);
    this.name = "GroupGoalError";
  }
}

/** Maps a zod failure to the first domain code it carries (custom messages), else INVALID_INPUT. */
export function inputErrorCode(error: z.ZodError): GroupGoalErrorCode {
  const message = error.issues[0]?.message;
  return message === "COMMITMENT_REQUIRED" || message === "COMMITMENT_TOO_LONG" ? message : "INVALID_INPUT";
}

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new GroupGoalError(inputErrorCode(parsed.error));
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Counters (G1-10, WF-23)
// ---------------------------------------------------------------------------

/** Counters of one Goal Centre section. Display only until Q-16 says whether they filter. */
export interface SectionCounters {
  drafts: number;
  /** Part 1 "Potwierdzone"; Parts 2-3 "Dodane do planu". Both feed the top bar's "Dodane do planu". */
  done: number;
  changedByManager: number;
}

export interface GroupGoalView {
  templateId: number;
  type: GroupGoalType;
  sortOrder: number;
  contentPl: string;
  contentEn: string;
  acknowledgedAt: Date | null;
  /** BHP only. */
  commitment: string | null;
}

/** N+1 cannot change Group goals (their text is HR's), so "changed by N+1" is always 0 here. */
export function groupGoalCounters(goals: readonly Pick<GroupGoalView, "acknowledgedAt">[]): SectionCounters {
  const done = goals.filter((goal) => goal.acknowledgedAt !== null).length;
  return { drafts: goals.length - done, done, changedByManager: 0 };
}

/**
 * Top bar across all parts (WF-23): Szkice / Dodane do planu / Zmienione przez N+1. Parts 2 and 3
 * plug in by passing their own SectionCounters next to Part 1's.
 */
export function aggregateCounters(sections: readonly SectionCounters[]): SectionCounters {
  return sections.reduce(
    (sum, section) => ({
      drafts: sum.drafts + section.drafts,
      done: sum.done + section.done,
      changedByManager: sum.changedByManager + section.changedByManager,
    }),
    { drafts: 0, done: 0, changedByManager: 0 },
  );
}

// ---------------------------------------------------------------------------
// Document on first open
// ---------------------------------------------------------------------------

export interface OwnDocument {
  id: number;
  status: DocumentStatus;
}

export type GoalCentreDb = Pick<PrismaClient, "$transaction" | "gedpDocument">;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * The viewer's own document for the cycle, created as SZKIC on first open of an OPEN cycle (with
 * its initial status-history row and an audit entry). Read-only cycles never get a new document:
 * returns null when there is none.
 */
export async function ensureOwnDocument(
  db: GoalCentreDb,
  viewer: Viewer,
  cycle: { id: number; status: CycleStatus },
): Promise<OwnDocument | null> {
  const where = { employeeId_cycleId: { employeeId: viewer.id, cycleId: cycle.id } };
  const select = { id: true, status: true } as const;
  const existing = await db.gedpDocument.findUnique({ where, select });
  if (existing || isCycleReadOnly(cycle.status)) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.gedpDocument.create({
        data: { employeeId: viewer.id, cycleId: cycle.id, status: "SZKIC" },
        select,
      });
      await tx.documentStatusHistory.create({
        data: { documentId: created.id, fromStatus: null, toStatus: "SZKIC", authorId: viewer.id },
      });
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: "gedp_document",
        entityId: created.id,
        action: "CREATE",
        after: { employeeId: viewer.id, cycleId: cycle.id, status: "SZKIC" },
      });
      return created;
    });
  } catch (error: unknown) {
    // Two tabs opened at once: the other request created it first.
    if (!isUniqueViolation(error)) throw error;
    return db.gedpDocument.findUniqueOrThrow({ where, select });
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type GroupGoalReader = Pick<PrismaClient, "groupGoalTemplate" | "groupGoalAck" | "employee" | "gedpDocument">;

/** HR texts of the cycle, in card order, with nothing acknowledged (read-only cycle, no document). */
export async function loadGroupGoalTemplates(
  db: Pick<PrismaClient, "groupGoalTemplate">,
  cycleId: number,
): Promise<GroupGoalView[]> {
  const templates = await db.groupGoalTemplate.findMany({ where: { cycleId }, orderBy: { sortOrder: "asc" } });
  return templates.map((t) => ({
    templateId: t.id,
    type: t.type,
    sortOrder: t.sortOrder,
    contentPl: t.contentPl,
    contentEn: t.contentEn,
    acknowledgedAt: null,
    commitment: null,
  }));
}

export interface GroupGoalsForDocument {
  documentId: number;
  status: DocumentStatus;
  /** The viewer may acknowledge / edit the commitment right now. */
  canChange: boolean;
  goals: GroupGoalView[];
}

/** Group goals of a document the viewer may see (NotFoundError otherwise - never reveals it exists). */
export async function loadGroupGoals(
  db: GroupGoalReader,
  viewer: Viewer,
  documentId: number,
  cycleStatus: CycleStatus,
): Promise<GroupGoalsForDocument> {
  const access = await requireDocumentPermission(db, viewer, documentId, "view");
  const [templates, acks] = await Promise.all([
    loadGroupGoalTemplates(db, access.cycleId),
    db.groupGoalAck.findMany({
      where: { documentId },
      select: { templateId: true, acknowledgedAt: true, hsCommitment: true },
    }),
  ]);
  const ackByTemplate = new Map(acks.map((ack) => [ack.templateId, ack]));
  return {
    documentId,
    status: access.status,
    canChange:
      access.employeeId === viewer.id &&
      !isCycleReadOnly(cycleStatus) &&
      EDITABLE_DOCUMENT_STATUSES.includes(access.status),
    goals: templates.map((goal) => {
      const ack = ackByTemplate.get(goal.templateId);
      return { ...goal, acknowledgedAt: ack?.acknowledgedAt ?? null, commitment: ack?.hsCommitment ?? null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;
export type GroupGoalWriter = Pick<PrismaClient, "$transaction">;

interface LockedDocumentRow {
  documentStatus: string;
  cycleStatus: string;
}

/**
 * Inside the write transaction: viewer may edit, viewer is the owner, the cycle is open and the
 * document is not sent. The document row is locked FOR UPDATE and the cycle row FOR SHARE before
 * the statuses are read, so a concurrent "send" or cycle close waits for this transaction (or this
 * one waits and then sees the new status) - never both succeed. Returns the template, which must
 * belong to the same cycle.
 */
async function lockEditableTemplate(tx: Tx, viewer: Viewer, documentId: number, templateId: number) {
  // documentId is a validated int4; $queryRaw binds it as a parameter.
  const [locked] = await tx.$queryRaw<LockedDocumentRow[]>`
    SELECT d.status::text AS "documentStatus", c.status::text AS "cycleStatus"
    FROM gedp_document d JOIN cycle c ON c.id = d.cycle_id
    WHERE d.id = ${documentId}
    FOR UPDATE OF d FOR SHARE OF c`;

  // Missing documents fall through to the permission check, which reports them as not found.
  const access = await requireDocumentPermission(tx, viewer, documentId, "edit");
  if (access.employeeId !== viewer.id) throw new ForbiddenError("edit", `document ${documentId}: owner only`);

  const isEditable =
    locked !== undefined &&
    locked.cycleStatus === "OTWARTY" &&
    (EDITABLE_DOCUMENT_STATUSES as readonly string[]).includes(locked.documentStatus);
  if (!isEditable) throw new GroupGoalError("NOT_EDITABLE");

  const template = await tx.groupGoalTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, type: true, cycleId: true },
  });
  if (!template || template.cycleId !== access.cycleId) throw new GroupGoalError("TEMPLATE_NOT_FOUND");
  return template;
}

export interface AcknowledgedGoal {
  templateId: number;
  acknowledgedAt: Date;
  commitment: string | null;
}

/** "Potwierdzam zapoznanie" for Leadership / Company values. One-way: a second call is refused. */
export async function acknowledgeGroupGoal(
  db: GroupGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<AcknowledgedGoal> {
  const { documentId, templateId } = parseInput(acknowledgeInputSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      const template = await lockEditableTemplate(tx, viewer, documentId, templateId);
      if (template.type === "BHP") throw new GroupGoalError("WRONG_GOAL_TYPE");

      const ack = await tx.groupGoalAck.create({
        data: { documentId, templateId },
        select: { id: true, acknowledgedAt: true },
      });
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: "group_goal_ack",
        entityId: ack.id,
        action: "ACKNOWLEDGE",
        after: { documentId, templateId, type: template.type, acknowledgedAt: ack.acknowledgedAt },
      });
      return { templateId, acknowledgedAt: ack.acknowledgedAt, commitment: null };
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new GroupGoalError("ALREADY_ACKNOWLEDGED");
    throw error;
  }
}

/** Saves (creates or replaces) the BHP commitment; the first save is the acknowledgement. */
export async function saveBhpCommitment(
  db: GroupGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<AcknowledgedGoal> {
  const { documentId, templateId, commitment } = parseInput(bhpCommitmentInputSchema, input);
  return db.$transaction(async (tx) => {
    const template = await lockEditableTemplate(tx, viewer, documentId, templateId);
    if (template.type !== "BHP") throw new GroupGoalError("WRONG_GOAL_TYPE");

    const key = { documentId_templateId: { documentId, templateId } };
    const before = await tx.groupGoalAck.findUnique({
      where: key,
      select: { hsCommitment: true, acknowledgedAt: true },
    });
    // Unchanged text: no write and no audit row, so repeated saves cannot grow audit_log.
    if (before?.hsCommitment === commitment) {
      return { templateId, acknowledgedAt: before.acknowledgedAt, commitment };
    }
    // The document row is locked above, so no concurrent writer can slip between read and upsert.
    const ack = await tx.groupGoalAck.upsert({
      where: key,
      create: { documentId, templateId, hsCommitment: commitment },
      // acknowledgedAt keeps the first save: that is when the goal was acknowledged.
      update: { hsCommitment: commitment },
      select: { id: true, acknowledgedAt: true, hsCommitment: true },
    });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "group_goal_ack",
      entityId: ack.id,
      action: before ? "UPDATE_BHP_COMMITMENT" : "ACKNOWLEDGE",
      before: before ? { hsCommitment: before.hsCommitment } : undefined,
      after: {
        documentId,
        templateId,
        type: template.type,
        hsCommitment: ack.hsCommitment,
        acknowledgedAt: ack.acknowledgedAt,
      },
    });
    return { templateId, acknowledgedAt: ack.acknowledgedAt, commitment: ack.hsCommitment };
  });
}

/**
 * HR-07: HR corrects the text of a saved BHP commitment, in any document status and cycle. The
 * acknowledgement date stays (it records when the employee committed); the audit row keeps the
 * previous and the new text and the reason.
 */
export async function correctBhpCommitmentAsHr(
  db: GroupGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<AcknowledgedGoal> {
  const { documentId, templateId, commitment, reason } = parseInput(hrBhpCorrectionInputSchema, input);
  const parsedReason = parseHrCorrectionReason(reason);
  if (!parsedReason.ok) throw new GroupGoalError(parsedReason.code);

  return db.$transaction(async (tx) => {
    const document = await lockHrGoalDocument(tx, viewer, documentId);
    const template = await tx.groupGoalTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, type: true, cycleId: true },
    });
    if (!template || template.cycleId !== document.cycleId) throw new GroupGoalError("TEMPLATE_NOT_FOUND");
    if (template.type !== "BHP") throw new GroupGoalError("WRONG_GOAL_TYPE");

    const key = { documentId_templateId: { documentId, templateId } };
    const before = await tx.groupGoalAck.findUnique({
      where: key,
      select: { id: true, hsCommitment: true, acknowledgedAt: true },
    });
    if (!before || before.hsCommitment === null) throw new GroupGoalError("NOT_ACKNOWLEDGED");
    // Unchanged text: no write and no audit row.
    if (before.hsCommitment === commitment) return { templateId, acknowledgedAt: before.acknowledgedAt, commitment };

    const ack = await tx.groupGoalAck.update({
      where: key,
      data: { hsCommitment: commitment },
      select: { id: true, acknowledgedAt: true, hsCommitment: true },
    });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "group_goal_ack",
      entityId: ack.id,
      action: HR_CORRECTION_AUDIT_ACTION,
      before: { documentId, templateId, type: template.type, hsCommitment: before.hsCommitment },
      after: { documentId, templateId, type: template.type, hsCommitment: ack.hsCommitment, reason: parsedReason.reason },
    });
    return { templateId, acknowledgedAt: ack.acknowledgedAt, commitment: ack.hsCommitment };
  });
}
