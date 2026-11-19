import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CycleStatus, DocumentStatus } from "@/generated/prisma/enums";
import {
  availableActions,
  canValidatorEditGoals,
  DOCUMENT_STATUSES,
  findTransition,
  isCommentRequired,
  isDocumentStatus,
  isRevertAllowed,
  WORKFLOW_ACTIONS,
  workflowCommentSchema,
  type Transition,
  type WorkflowAction,
} from "@/domain/document-status";
import { checkClosingConditions, type ClosingDocument, type MissingCondition } from "@/domain/closing-conditions";
import { writeAudit } from "@/server/audit";
import { notifyWorkflowTransition, type MailRecipientReader, type NotifyOptions } from "@/server/mail/workflow-mail";
import {
  ForbiddenError,
  NotFoundError,
  requireActiveHrAdmin,
  requireDocumentPermission,
  validatableDocumentsWhere,
  type DocumentAccess,
  type Viewer,
} from "@/server/permissions";

// Document workflow on the server (WF-01..06, WF-08 HR revert). The rules - which transitions exist,
// who makes them, what needs a comment - live in src/domain/document-status.ts, the closing
// conditions in src/domain/closing-conditions.ts; this module enforces them.
//
// Every status change runs in ONE transaction:
//   lock the document FOR UPDATE and its cycle FOR SHARE (a concurrent goal write or second click
//   waits) -> permission module (view, then edit-as-owner or validate) -> transition table ->
//   cycle open -> closing conditions (send only) -> status update that re-asserts the "from"
//   status and the actor in its WHERE -> document_status_history row -> audit row.
// Who validates is decided by the permission module (live N+1 or validatorOverride, canValidate),
// never by gedp_document.validatorId, which only records who last validated.
// WF-07 e-mails go out only after that transaction committed (src/server/mail/workflow-mail.ts).

const MAX_INT4 = 2_147_483_647;
export const dbIdSchema = z.number().int().min(1).max(MAX_INT4);

export const transitionInputSchema = z
  .object({ documentId: dbIdSchema, action: z.enum(WORKFLOW_ACTIONS), comment: workflowCommentSchema })
  .strict();

export type WorkflowErrorCode =
  | "INVALID_INPUT"
  | "COMMENT_REQUIRED"
  | "COMMENT_TOO_LONG"
  | "ILLEGAL_TRANSITION"
  | "CYCLE_NOT_OPEN"
  | "CONDITIONS_NOT_MET"
  | "NOT_EDITABLE"
  | "GOAL_NOT_IN_PLAN"
  | "REASON_REQUIRED"
  | "STATUS_CHANGED";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const INPUT_ERROR_CODES: ReadonlySet<WorkflowErrorCode> = new Set<WorkflowErrorCode>([
  "INVALID_INPUT",
  "COMMENT_REQUIRED",
  "COMMENT_TOO_LONG",
  "REASON_REQUIRED",
]);

export class WorkflowError extends Error {
  /** 400 for a bad payload; 409 when the document's state does not allow the action. */
  readonly status: typeof HTTP_BAD_REQUEST | typeof HTTP_CONFLICT;

  constructor(
    readonly code: WorkflowErrorCode,
    /** CONDITIONS_NOT_MET only: what is still missing, for the list next to the send button. */
    readonly missing: readonly MissingCondition[] = [],
  ) {
    super(`Workflow: ${code}`);
    this.name = "WorkflowError";
    this.status = INPUT_ERROR_CODES.has(code) ? HTTP_BAD_REQUEST : HTTP_CONFLICT;
  }
}

/** Parses an untrusted payload; the comment schema's own messages become error codes. */
export function parseWorkflowInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues[0]?.message;
  throw new WorkflowError(message === "COMMENT_TOO_LONG" ? "COMMENT_TOO_LONG" : "INVALID_INPUT");
}

// ---------------------------------------------------------------------------
// Closing conditions (WF-C1..C5)
// ---------------------------------------------------------------------------

export type ClosingReader = Pick<
  Prisma.TransactionClient,
  "cycle" | "groupGoalTemplate" | "groupGoalAck" | "performanceGoal" | "developmentGoal"
>;

/** Everything checkClosingConditions needs, read from the database (pass `tx` inside a write). */
export async function loadClosingDocument(
  db: ClosingReader,
  documentId: number,
  cycleId: number,
): Promise<ClosingDocument> {
  const [cycle, templates, acks, performanceGoals, developmentGoals] = await Promise.all([
    db.cycle.findUniqueOrThrow({
      where: { id: cycleId },
      select: { minPerformanceGoals: true, requiredWeightSum: true, minDevelopmentGoals: true },
    }),
    db.groupGoalTemplate.findMany({ where: { cycleId }, select: { id: true, type: true } }),
    db.groupGoalAck.findMany({ where: { documentId }, select: { templateId: true, hsCommitment: true } }),
    db.performanceGoal.findMany({ where: { documentId }, select: { state: true, weight: true } }),
    db.developmentGoal.findMany({ where: { documentId }, select: { state: true } }),
  ]);
  const ackByTemplate = new Map(acks.map((ack) => [ack.templateId, ack]));
  return {
    groupGoals: templates.map((template) => {
      const ack = ackByTemplate.get(template.id);
      return { type: template.type, isAcknowledged: ack !== undefined, commitment: ack?.hsCommitment ?? null };
    }),
    performanceGoals,
    developmentGoals,
    cycle,
  };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;
export type WorkflowWriter = Pick<PrismaClient, "$transaction">;

interface LockedRow {
  documentStatus: string;
  cycleStatus: string;
  cycleId: number;
  cycleYear: number;
}

async function lockDocument(tx: Tx, documentId: number): Promise<LockedRow | undefined> {
  // documentId is a validated int4; $queryRaw binds it as a parameter.
  const [locked] = await tx.$queryRaw<LockedRow[]>`
    SELECT d.status::text AS "documentStatus", c.status::text AS "cycleStatus", c.id AS "cycleId",
           c.year AS "cycleYear"
    FROM gedp_document d JOIN cycle c ON c.id = d.cycle_id
    WHERE d.id = ${documentId}
    FOR UPDATE OF d FOR SHARE OF c`;
  return locked;
}

/** OWNER: the document's own employee (HR's general edit right does not send someone's plan). */
function assertActor(transition: Transition, viewer: Viewer, access: DocumentAccess): void {
  if (transition.actor === "OWNER") {
    if (access.employeeId !== viewer.id || !access.permissions.edit) {
      throw new ForbiddenError("edit", `document ${access.documentId}: owner only`);
    }
    return;
  }
  if (!access.permissions.validate) throw new ForbiddenError("validate", `document ${access.documentId}`);
}

/** The same actor rule as assertActor, as a WHERE, so the update re-asserts it under the lock. */
function actorWhere(transition: Transition, viewer: Viewer): Prisma.GedpDocumentWhereInput {
  return transition.actor === "OWNER" ? { employeeId: viewer.id } : validatableDocumentsWhere(viewer);
}

export interface TransitionResult {
  documentId: number;
  from: DocumentStatus;
  to: DocumentStatus;
  historyId: number;
  changedAt: Date;
}

/**
 * "Wyślij do walidacji" / "Zatwierdź" / "Zwróć do poprawy". Throws WorkflowError (400 / 409),
 * NotFoundError (missing or invisible document) or ForbiddenError (wrong actor).
 * After the transaction commits, sends the WF-07 e-mail; a mail failure is logged, never thrown,
 * so it cannot undo or hide a committed status change.
 */
export async function transitionDocument(
  db: WorkflowWriter & MailRecipientReader,
  viewer: Viewer,
  input: unknown,
  mail: NotifyOptions = {},
): Promise<TransitionResult> {
  const committed = await commitTransition(db, viewer, input);
  await notifyWorkflowTransition(db, committed.mail, mail);
  return committed.result;
}

async function commitTransition(db: WorkflowWriter, viewer: Viewer, input: unknown) {
  const { documentId, action, comment } = parseWorkflowInput(transitionInputSchema, input);
  // Refused before any database call: a return without a reason, and a comment on an action that
  // takes none (it would land in the history the other side reads).
  if (isCommentRequired(action) && comment === null) throw new WorkflowError("COMMENT_REQUIRED");
  if (!isCommentRequired(action) && comment !== null) throw new WorkflowError("INVALID_INPUT");

  return db.$transaction(async (tx) => {
    const locked = await lockDocument(tx, documentId);
    // Missing documents fall through to the permission check, which reports them as not found.
    const access = await requireDocumentPermission(tx, viewer, documentId, "view");
    if (!locked || !isDocumentStatus(locked.documentStatus)) throw new NotFoundError(`document ${documentId}`);

    const transition = findTransition(action, locked.documentStatus);
    if (!transition) throw new WorkflowError("ILLEGAL_TRANSITION");
    assertActor(transition, viewer, access);
    if (locked.cycleStatus !== "OTWARTY") throw new WorkflowError("CYCLE_NOT_OPEN");

    if (transition.requiresClosingConditions) {
      const closing = checkClosingConditions(await loadClosingDocument(tx, documentId, locked.cycleId));
      if (!closing.ok) throw new WorkflowError("CONDITIONS_NOT_MET", closing.missing);
    }

    const isValidatorAction = transition.actor === "VALIDATOR";
    const updated = await tx.gedpDocument.updateMany({
      where: { AND: [{ id: documentId, status: transition.from }, actorWhere(transition, viewer)] },
      data: { status: transition.to, ...(isValidatorAction ? { validatorId: viewer.id } : {}) },
    });
    // Under the row lock this only happens if the structure changed after the permission read.
    if (updated.count !== 1) {
      throw new ForbiddenError(isValidatorAction ? "validate" : "edit", `document ${documentId}`);
    }

    const entry = await tx.documentStatusHistory.create({
      data: { documentId, fromStatus: transition.from, toStatus: transition.to, authorId: viewer.id, comment },
      select: { id: true, createdAt: true },
    });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "gedp_document",
      entityId: documentId,
      action: `STATUS_${action}`,
      before: { status: transition.from },
      after: { status: transition.to, comment, historyId: entry.id },
    });
    const result: TransitionResult = {
      documentId,
      from: transition.from,
      to: transition.to,
      historyId: entry.id,
      changedAt: entry.createdAt,
    };
    const mail = { documentId, employeeId: access.employeeId, to: transition.to, cycleYear: locked.cycleYear, comment };
    return { result, mail };
  });
}

// ---------------------------------------------------------------------------
// HR status revert (WF-08)
// ---------------------------------------------------------------------------

export const AUDIT_ACTION_REVERT = "STATUS_REVERT";

/** `from` is the status HR saw: a document that moved since is refused (STATUS_CHANGED), not reverted blind. */
export const revertInputSchema = z
  .object({
    documentId: dbIdSchema,
    from: z.enum(DOCUMENT_STATUSES),
    to: z.enum(DOCUMENT_STATUSES),
    reason: workflowCommentSchema,
  })
  .strict();

/**
 * "Cofnij status" (WF-08): HR moves a document back to an earlier status with a required reason.
 * HR only, re-checked against the live row inside the transaction. Same transaction shape as
 * transitionDocument: lock -> HR -> visibility -> status still `from` -> cycle open -> update that
 * re-asserts `from` -> history row (reason as its comment) -> audit row. Goals are not touched, and
 * validatorId keeps recording who last validated.
 * [ZAŁ] Only in an open cycle, like every other status change (a closed year stays as it was).
 */
export async function revertDocumentStatus(db: WorkflowWriter, viewer: Viewer, input: unknown): Promise<TransitionResult> {
  // Refused before reading the payload or the database: the session already says this is not HR.
  if (!viewer.isHrAdmin) throw new ForbiddenError("edit", "status revert: HR only");
  const { documentId, from, to, reason } = parseWorkflowInput(revertInputSchema, input);
  if (reason === null) throw new WorkflowError("REASON_REQUIRED");
  if (!isRevertAllowed(from, to)) throw new WorkflowError("ILLEGAL_TRANSITION");

  return db.$transaction(async (tx) => {
    const locked = await lockDocument(tx, documentId);
    await requireActiveHrAdmin(tx, viewer);
    await requireDocumentPermission(tx, viewer, documentId, "view");
    if (!locked || !isDocumentStatus(locked.documentStatus)) throw new NotFoundError(`document ${documentId}`);
    if (locked.documentStatus !== from) throw new WorkflowError("STATUS_CHANGED");
    if (locked.cycleStatus !== "OTWARTY") throw new WorkflowError("CYCLE_NOT_OPEN");

    const updated = await tx.gedpDocument.updateMany({ where: { id: documentId, status: from }, data: { status: to } });
    // Cannot happen under the row lock; kept so a lost update can never pass silently.
    if (updated.count !== 1) throw new WorkflowError("STATUS_CHANGED");

    const entry = await tx.documentStatusHistory.create({
      data: { documentId, fromStatus: from, toStatus: to, authorId: viewer.id, comment: reason },
      select: { id: true, createdAt: true },
    });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "gedp_document",
      entityId: documentId,
      action: AUDIT_ACTION_REVERT,
      before: { status: from },
      after: { status: to, reason, historyId: entry.id },
    });
    return { documentId, from, to, historyId: entry.id, changedAt: entry.createdAt };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type WorkflowReader = Pick<PrismaClient, "employee" | "gedpDocument" | "documentStatusHistory"> & ClosingReader;

export interface StatusHistoryEntry {
  id: number;
  fromStatus: DocumentStatus | null;
  toStatus: DocumentStatus;
  authorName: string;
  comment: string | null;
  createdAt: Date;
}

export interface DocumentWorkflowView {
  documentId: number;
  status: DocumentStatus;
  isOwner: boolean;
  /** Buttons for this viewer right now (empty in a read-only cycle). */
  actions: WorkflowAction[];
  /** Only when the viewer can send: unmet closing conditions, in slide order. */
  missing: MissingCondition[];
  /** WF-04: the viewer validates this document and may change its goals right now. */
  canValidatorEditGoals: boolean;
  /** Oldest first. */
  history: StatusHistoryEntry[];
}

/** Status, buttons, missing conditions and history of a document the viewer may see. */
export async function loadDocumentWorkflow(
  db: WorkflowReader,
  viewer: Viewer,
  documentId: number,
  cycleStatus: CycleStatus,
): Promise<DocumentWorkflowView> {
  const access = await requireDocumentPermission(db, viewer, documentId, "view");
  const isOwner = access.employeeId === viewer.id;
  const actions =
    cycleStatus === "OTWARTY"
      ? availableActions(access.status, { isOwner, isValidator: access.permissions.validate })
      : [];
  const [rows, missing] = await Promise.all([
    db.documentStatusHistory.findMany({
      where: { documentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        comment: true,
        createdAt: true,
        author: { select: { firstName: true, lastName: true } },
      },
    }),
    actions.includes("SEND")
      ? loadClosingDocument(db, documentId, access.cycleId).then((document) => checkClosingConditions(document).missing)
      : Promise.resolve([]),
  ]);
  return {
    documentId,
    status: access.status,
    isOwner,
    actions,
    missing,
    canValidatorEditGoals:
      access.permissions.validate && canValidatorEditGoals(access.status, cycleStatus === "OTWARTY"),
    history: rows.map(({ author, ...row }) => ({ ...row, authorName: `${author.firstName} ${author.lastName}` })),
  };
}

export interface DocumentToValidate {
  documentId: number;
  employeeName: string;
  position: string | null;
  department: string | null;
  /** Last change of the document (the send, unless it was touched since). */
  updatedAt: Date;
}

/** Upper bound for one validator's inbox; N+1 teams are far smaller. */
const INBOX_LIMIT = 500;

/** "Dokumenty do walidacji": documents of the cycle waiting for this viewer, oldest first. */
export async function listDocumentsToValidate(
  db: Pick<PrismaClient, "gedpDocument">,
  viewer: Viewer,
  cycleId: number,
): Promise<DocumentToValidate[]> {
  const rows = await db.gedpDocument.findMany({
    where: validatableDocumentsWhere(viewer, { cycleId, status: "DO_WALIDACJI" }),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: INBOX_LIMIT,
    select: {
      id: true,
      updatedAt: true,
      employee: { select: { firstName: true, lastName: true, position: true, department: true } },
    },
  });
  return rows.map(({ id, updatedAt, employee }) => ({
    documentId: id,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    position: employee.position,
    department: employee.department,
    updatedAt,
  }));
}

export interface ValidationInboxSummary {
  count: number;
  /** Most recent change among the waiting documents; null when there are none. */
  lastUpdatedAt: Date | null;
}

/** Count for the "Dokumenty do walidacji" home task, for the cycle year picked in the header. */
export async function summarizeDocumentsToValidate(
  db: Pick<PrismaClient, "gedpDocument">,
  viewer: Viewer,
  cycleYear: number,
): Promise<ValidationInboxSummary> {
  const result = await db.gedpDocument.aggregate({
    where: validatableDocumentsWhere(viewer, { cycle: { year: cycleYear }, status: "DO_WALIDACJI" }),
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  return { count: result._count._all, lastUpdatedAt: result._max.updatedAt };
}
