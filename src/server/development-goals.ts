import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CycleStatus, DocumentStatus } from "@/generated/prisma/enums";
import {
  developmentGoalCounters,
  developmentGoalIssues,
  developmentGoalSchema,
  GOAL_SAVE_MODES,
  type DevelopmentGoalContext,
  type DevelopmentGoalCounters,
  type DevelopmentGoalData,
  type DevelopmentGoalFieldIssue,
  type DevelopmentGoalInputErrorCode,
  type DevelopmentGoalState,
  type GoalSaveMode,
} from "@/domain/development-goal";
import { progressFromPercent, progressToPercent } from "@/domain/performance-goal";
import {
  HR_CORRECTION_AUDIT_ACTION,
  parseHrCorrectionReason,
  type HrCorrectionReasonErrorCode,
} from "@/domain/hr-correction";
import { writeAudit } from "@/server/audit";
import {
  fromIsoDate,
  lockHrGoalDocument,
  lockOwnGoalDocument,
  lockValidatorGoalDocument,
  MANAGER_UPDATE_AUDIT_ACTION,
  toIsoDate,
  wasDocumentSent,
  type LockedGoalDocument,
  type ValidatorLockedGoalDocument,
} from "@/server/goal-document";
import { EDITABLE_DOCUMENT_STATUSES, goalEditScope } from "@/domain/document-status";
import { ForbiddenError, NotFoundError, requireDocumentPermission, type Viewer } from "@/server/permissions";

// Goal Centre, Part 3: server operations on development goals (G3-01..05, G3-10..16, G3-20, G3-21).
// Only the fields common to both candidate models (Q-04) - see src/domain/development-goal.ts.
//
// Same pattern as Part 2 (performance-goals.ts): shared zod schema -> transaction that locks the
// document row -> permission module (edit + owner only) -> cycle open and document not sent ->
// write -> audit row in the same transaction.
//
// - create / update: DRAFT keeps the goal SZKIC, PLAN validates every field and sets W_PLANIE.
// - delete: only while the document has never been sent; afterwards "Anuluj cel" (ANULOWANY).
// - the catalogue (competency, development area) is read from the document's own cycle inside the
//   transaction; only active entries are accepted (G3-20).
// - WF-04 (updateDevelopmentGoalAsValidator): as in Part 2, the validator may change a goal while
//   the document is DO_WALIDACJI; the goal keeps its state, gets changedByManager = true and the
//   audit row keeps the previous and the new values.
// - HR-07 (correctDevelopmentGoalAsHr): an active HR admin corrects any goal of any document (any
//   status, any cycle) with a required reason; same content-only path, without the N+1 flag.

const MAX_INT4 = 2_147_483_647;
/** [ZAŁ] Upper bound per document (Q-03); counts cancelled goals too. Same as Part 2. */
export const MAX_DEVELOPMENT_GOALS_PER_DOCUMENT = 50;
const dbIdSchema = z.number().int().min(1).max(MAX_INT4);
const saveModeSchema = z.enum(GOAL_SAVE_MODES);

export const createDevelopmentGoalInputSchema = z
  .object({ documentId: dbIdSchema, mode: saveModeSchema, goal: z.unknown() })
  .strict();
export const updateDevelopmentGoalInputSchema = z
  .object({ goalId: dbIdSchema, mode: saveModeSchema, goal: z.unknown() })
  .strict();
export const developmentGoalIdInputSchema = z.object({ goalId: dbIdSchema }).strict();
/** WF-04: no save mode - the validator changes a goal's content, never its state. */
export const validatorUpdateDevelopmentGoalInputSchema = z.object({ goalId: dbIdSchema, goal: z.unknown() }).strict();
/** HR-07: content only, like WF-04, plus the required reason (checked by parseHrCorrectionReason). */
export const hrCorrectDevelopmentGoalInputSchema = z
  .object({ goalId: dbIdSchema, goal: z.unknown(), reason: z.unknown() })
  .strict();

/** Rule violations that are not about the payload. */
export type DevelopmentGoalStateErrorCode =
  | "NOT_EDITABLE"
  | "GOAL_CANCELLED"
  | "DOCUMENT_ALREADY_SENT"
  | "DOCUMENT_NOT_SENT"
  | "TOO_MANY_GOALS";

export type DevelopmentGoalErrorCode =
  | DevelopmentGoalInputErrorCode
  | DevelopmentGoalStateErrorCode
  | HrCorrectionReasonErrorCode;

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_SERVER_ERROR = 500;

const STATE_ERROR_CODES: ReadonlySet<DevelopmentGoalErrorCode> = new Set<DevelopmentGoalStateErrorCode>([
  "NOT_EDITABLE",
  "GOAL_CANCELLED",
  "DOCUMENT_ALREADY_SENT",
  "DOCUMENT_NOT_SENT",
  "TOO_MANY_GOALS",
]);

export class DevelopmentGoalError extends Error {
  /** 400 for an invalid payload; 409 when the goal or document does not allow the action. */
  readonly status: typeof HTTP_BAD_REQUEST | typeof HTTP_CONFLICT;

  constructor(
    readonly code: DevelopmentGoalErrorCode,
    /** Field-level issues of an invalid payload, shown next to the inputs. */
    readonly issues: readonly DevelopmentGoalFieldIssue[] = [],
  ) {
    super(`Development goal: ${code}`);
    this.name = "DevelopmentGoalError";
    this.status = STATE_ERROR_CODES.has(code) ? HTTP_CONFLICT : HTTP_BAD_REQUEST;
  }
}

/** HTTP status for anything a development-goal operation throws (route handlers, actions). */
export function developmentGoalHttpStatus(error: unknown): number {
  if (error instanceof DevelopmentGoalError || error instanceof NotFoundError || error instanceof ForbiddenError) {
    return error.status;
  }
  return HTTP_SERVER_ERROR;
}

function parseEnvelope<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DevelopmentGoalError("INVALID_INPUT");
  return parsed.data;
}

function parseGoal(mode: GoalSaveMode, goal: unknown, context?: DevelopmentGoalContext): DevelopmentGoalData {
  const parsed = developmentGoalSchema(mode, context).safeParse(goal);
  if (parsed.success) return parsed.data;
  const issues = developmentGoalIssues(parsed.error);
  throw new DevelopmentGoalError(issues[0]?.code ?? "INVALID_INPUT", issues);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface DevelopmentGoalView extends DevelopmentGoalData {
  id: number;
  documentId: number;
  state: DevelopmentGoalState;
  changedByManager: boolean;
}

const goalSelect = {
  id: true,
  documentId: true,
  competencyId: true,
  developmentAreaId: true,
  actionTitle: true,
  actionDescription: true,
  startDate: true,
  endDate: true,
  progress: true,
  state: true,
  changedByManager: true,
} satisfies Prisma.DevelopmentGoalSelect;

type GoalRow = Prisma.DevelopmentGoalGetPayload<{ select: typeof goalSelect }>;

function toView(row: GoalRow): DevelopmentGoalView {
  return {
    ...row,
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    progress: progressFromPercent(row.progress),
  };
}

/** Audited fields. Always built here, so two snapshots have the same key order and compare as JSON. */
function snapshot(goal: DevelopmentGoalData & { state: DevelopmentGoalState }) {
  return {
    competencyId: goal.competencyId,
    developmentAreaId: goal.developmentAreaId,
    actionTitle: goal.actionTitle,
    actionDescription: goal.actionDescription,
    startDate: goal.startDate,
    endDate: goal.endDate,
    progress: goal.progress,
    state: goal.state,
  };
}

const auditRecord = (goal: DevelopmentGoalView) => ({ documentId: goal.documentId, ...snapshot(goal) });
const stateFor = (mode: GoalSaveMode): DevelopmentGoalState => (mode === "PLAN" ? "W_PLANIE" : "SZKIC");

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type CatalogReader = Pick<PrismaClient, "competency" | "developmentArea">;

const catalogSelect = { id: true, namePl: true, nameEn: true, isActive: true } as const;

/**
 * Competencies and development areas of one cycle (G3-20), active and inactive: the form offers
 * only the active ones, and an inactive one still names the competency of an older goal.
 */
export async function loadDevelopmentGoalContext(
  db: CatalogReader,
  cycle: { id: number; year: number },
): Promise<DevelopmentGoalContext> {
  const [competencies, developmentAreas] = await Promise.all([
    db.competency.findMany({ where: { cycleId: cycle.id }, select: catalogSelect, orderBy: { id: "asc" } }),
    db.developmentArea.findMany({ where: { cycleId: cycle.id }, select: catalogSelect, orderBy: { id: "asc" } }),
  ]);
  return { cycleYear: cycle.year, competencies, developmentAreas };
}

export type DevelopmentGoalReader = Pick<
  PrismaClient,
  "developmentGoal" | "employee" | "gedpDocument" | "documentStatusHistory"
>;

export interface DevelopmentGoalsForDocument {
  documentId: number;
  status: DocumentStatus;
  /** The viewer may add, edit, delete or cancel goals right now. */
  canChange: boolean;
  /** WF-05: approved document, open cycle, owner - only the progress of goals in the plan may change. */
  canUpdateProgress: boolean;
  /** Sent at least once: goals can be cancelled, no longer deleted. */
  wasSent: boolean;
  goals: DevelopmentGoalView[];
  counters: DevelopmentGoalCounters;
}

/** Development goals of a document the viewer may see (NotFoundError otherwise). */
export async function loadDevelopmentGoals(
  db: DevelopmentGoalReader,
  viewer: Viewer,
  documentId: number,
  cycleStatus: CycleStatus,
): Promise<DevelopmentGoalsForDocument> {
  const access = await requireDocumentPermission(db, viewer, documentId, "view");
  const [rows, wasSent] = await Promise.all([
    db.developmentGoal.findMany({ where: { documentId }, select: goalSelect, orderBy: { id: "asc" } }),
    wasDocumentSent(db, documentId),
  ]);
  const goals = rows.map(toView);
  return {
    documentId,
    status: access.status,
    canChange:
      access.employeeId === viewer.id &&
      cycleStatus === "OTWARTY" &&
      EDITABLE_DOCUMENT_STATUSES.includes(access.status),
    canUpdateProgress: access.employeeId === viewer.id && goalEditScope(access.status, cycleStatus === "OTWARTY") === "PROGRESS_ONLY",
    wasSent,
    goals,
    counters: developmentGoalCounters(goals),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;
export type DevelopmentGoalWriter = Pick<PrismaClient, "$transaction">;

async function lockEditableDocument(tx: Tx, viewer: Viewer, documentId: number): Promise<LockedGoalDocument> {
  const document = await lockOwnGoalDocument(tx, viewer, documentId);
  if (!document.isEditable) throw new DevelopmentGoalError("NOT_EDITABLE");
  return document;
}

/** WF-04: validator lock + permission (goal-document.ts), then an open cycle and DO_WALIDACJI. */
async function lockValidatedDocument(tx: Tx, viewer: Viewer, documentId: number): Promise<ValidatorLockedGoalDocument> {
  const document = await lockValidatorGoalDocument(tx, viewer, documentId);
  if (!document.isEditable) throw new DevelopmentGoalError("NOT_EDITABLE");
  return document;
}

type DocumentLocker<D> = (tx: Tx, viewer: Viewer, documentId: number) => Promise<D>;

/**
 * Locks the goal's document (owner or WF-04 validator locker), then re-reads the goal under that
 * lock (missing = not found).
 */
async function lockGoal<D>(
  tx: Tx,
  viewer: Viewer,
  goalId: number,
  lockDocument: DocumentLocker<D>,
): Promise<{ document: D; row: GoalRow }> {
  const owner = await tx.developmentGoal.findUnique({ where: { id: goalId }, select: { documentId: true } });
  if (!owner) throw new NotFoundError(`development goal ${goalId}`);
  const document = await lockDocument(tx, viewer, owner.documentId);
  // Pinned to the locked document: a goal deleted since the first read is not found.
  const row = await tx.developmentGoal.findFirst({
    where: { id: goalId, documentId: owner.documentId },
    select: goalSelect,
  });
  if (!row) throw new NotFoundError(`development goal ${goalId}`);
  return { document, row };
}

const lockEditableGoal = (tx: Tx, viewer: Viewer, goalId: number) => lockGoal(tx, viewer, goalId, lockEditableDocument);

function contextFor(
  tx: Tx,
  document: Pick<LockedGoalDocument, "cycleId" | "cycleYear">,
): Promise<DevelopmentGoalContext> {
  return loadDevelopmentGoalContext(tx, { id: document.cycleId, year: document.cycleYear });
}

function goalColumns(data: DevelopmentGoalData, state: DevelopmentGoalState, previousPercent?: number) {
  return {
    competencyId: data.competencyId,
    developmentAreaId: data.developmentAreaId,
    actionTitle: data.actionTitle,
    actionDescription: data.actionDescription,
    startDate: fromIsoDate(data.startDate),
    endDate: fromIsoDate(data.endDate),
    progress: progressToPercent(data.progress, previousPercent),
    state,
  };
}

/** New goal: "Zapisz i zamknij" (DRAFT) or "Dodaj do planu" (PLAN). */
export async function createDevelopmentGoal(
  db: DevelopmentGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<DevelopmentGoalView> {
  const { documentId, mode, goal } = parseEnvelope(createDevelopmentGoalInputSchema, input);
  // Payload errors (malformed date, end before start, unknown keys) are refused before any database call.
  parseGoal(mode, goal);

  return db.$transaction(async (tx) => {
    const document = await lockEditableDocument(tx, viewer, documentId);
    if ((await tx.developmentGoal.count({ where: { documentId } })) >= MAX_DEVELOPMENT_GOALS_PER_DOCUMENT) {
      throw new DevelopmentGoalError("TOO_MANY_GOALS");
    }
    const data = parseGoal(mode, goal, await contextFor(tx, document));
    const created = toView(
      await tx.developmentGoal.create({
        data: { documentId, ...goalColumns(data, stateFor(mode)) },
        select: goalSelect,
      }),
    );
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "development_goal",
      entityId: created.id,
      action: "CREATE",
      after: auditRecord(created),
    });
    return created;
  });
}

/**
 * Edits a goal (full replace: the form always sends every field). A goal already in the plan stays
 * there: its "Zapisz i zamknij" is validated like "Dodaj do planu".
 */
export async function updateDevelopmentGoal(
  db: DevelopmentGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<DevelopmentGoalView> {
  const { goalId, mode, goal } = parseEnvelope(updateDevelopmentGoalInputSchema, input);
  parseGoal(mode, goal);

  return db.$transaction(async (tx) => {
    const { document, row } = await lockEditableGoal(tx, viewer, goalId);
    const before = toView(row);
    if (before.state === "ANULOWANY") throw new DevelopmentGoalError("GOAL_CANCELLED");

    const saveMode: GoalSaveMode = before.state === "W_PLANIE" ? "PLAN" : mode;
    const data = parseGoal(saveMode, goal, await contextFor(tx, document));
    const state = stateFor(saveMode);
    // Unchanged goal: no write and no audit row, so repeated saves cannot grow audit_log.
    if (JSON.stringify(snapshot({ ...data, state })) === JSON.stringify(snapshot(before))) return before;

    const updated = toView(
      await tx.developmentGoal.update({
        where: { id: goalId },
        data: goalColumns(data, state, row.progress),
        select: goalSelect,
      }),
    );
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "development_goal",
      entityId: goalId,
      action: "UPDATE",
      before: auditRecord(before),
      after: auditRecord(updated),
    });
    return updated;
  });
}

/**
 * WF-04: the validator changes a goal while the document is DO_WALIDACJI (full replace). The state
 * never changes: a goal in the plan is validated like "Dodaj do planu", a draft like "Zapisz i
 * zamknij". Marks the goal "Zmieniony przez N+1" and audits before / after.
 */
export async function updateDevelopmentGoalAsValidator(
  db: DevelopmentGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<DevelopmentGoalView> {
  const { goalId, goal } = parseEnvelope(validatorUpdateDevelopmentGoalInputSchema, input);
  return updateGoalContent(db, viewer, goalId, goal, {
    lockDocument: lockValidatedDocument,
    auditAction: MANAGER_UPDATE_AUDIT_ACTION,
    marksChangedByManager: true,
  });
}

/**
 * HR-07: HR corrects a goal of any document, whatever its status or cycle, with a required reason.
 * Content only, like WF-04; "Zmieniony przez N+1" is left as it is. The audit row keeps
 * before / after and the reason.
 */
export async function correctDevelopmentGoalAsHr(
  db: DevelopmentGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<DevelopmentGoalView> {
  const { goalId, goal, reason } = parseEnvelope(hrCorrectDevelopmentGoalInputSchema, input);
  const parsedReason = parseHrCorrectionReason(reason);
  if (!parsedReason.ok) throw new DevelopmentGoalError(parsedReason.code);
  return updateGoalContent(db, viewer, goalId, goal, {
    lockDocument: lockHrGoalDocument,
    auditAction: HR_CORRECTION_AUDIT_ACTION,
    marksChangedByManager: false,
    reason: parsedReason.reason,
  });
}

interface ContentEditor {
  lockDocument: DocumentLocker<Pick<LockedGoalDocument, "cycleId" | "cycleYear">>;
  auditAction: string;
  /** WF-04 sets "Zmieniony przez N+1"; HR-07 leaves the flag as it is. */
  marksChangedByManager: boolean;
  /** HR-07: stored in the audit row's `after`. */
  reason?: string;
}

/** Content-only full replace shared by WF-04 and HR-07: the goal's state never changes. */
async function updateGoalContent(
  db: DevelopmentGoalWriter,
  viewer: Viewer,
  goalId: number,
  goal: unknown,
  editor: ContentEditor,
): Promise<DevelopmentGoalView> {
  // The lenient mode refuses malformed payloads before any database call; PLAN rules follow below.
  parseGoal("DRAFT", goal);

  return db.$transaction(async (tx) => {
    const { document, row } = await lockGoal(tx, viewer, goalId, editor.lockDocument);
    const before = toView(row);
    if (before.state === "ANULOWANY") throw new DevelopmentGoalError("GOAL_CANCELLED");

    const saveMode: GoalSaveMode = before.state === "W_PLANIE" ? "PLAN" : "DRAFT";
    const data = parseGoal(saveMode, goal, await contextFor(tx, document));
    // Unchanged goal: no write, no flag and no audit row.
    if (JSON.stringify(snapshot({ ...data, state: before.state })) === JSON.stringify(snapshot(before))) return before;

    const updated = toView(
      await tx.developmentGoal.update({
        where: { id: goalId },
        data: {
          ...goalColumns(data, before.state, row.progress),
          ...(editor.marksChangedByManager ? { changedByManager: true } : {}),
        },
        select: goalSelect,
      }),
    );
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "development_goal",
      entityId: goalId,
      action: editor.auditAction,
      before: { ...auditRecord(before), changedByManager: before.changedByManager },
      after: {
        ...auditRecord(updated),
        changedByManager: updated.changedByManager,
        ...(editor.reason === undefined ? {} : { reason: editor.reason }),
      },
    });
    return updated;
  });
}

/** Deletes a goal - only while the document has never been sent (as G2-25). */
export async function deleteDevelopmentGoal(db: DevelopmentGoalWriter, viewer: Viewer, input: unknown): Promise<void> {
  const { goalId } = parseEnvelope(developmentGoalIdInputSchema, input);
  await db.$transaction(async (tx) => {
    const { document, row } = await lockEditableGoal(tx, viewer, goalId);
    if (document.wasSent) throw new DevelopmentGoalError("DOCUMENT_ALREADY_SENT");

    await tx.developmentGoal.delete({ where: { id: goalId } });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "development_goal",
      entityId: goalId,
      action: "DELETE",
      before: auditRecord(toView(row)),
    });
  });
}

/** "Anuluj cel" (G3-21): after the document has been sent the goal stays, as ANULOWANY. */
export async function cancelDevelopmentGoal(
  db: DevelopmentGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<DevelopmentGoalView> {
  const { goalId } = parseEnvelope(developmentGoalIdInputSchema, input);
  return db.$transaction(async (tx) => {
    const { document, row } = await lockEditableGoal(tx, viewer, goalId);
    if (!document.wasSent) throw new DevelopmentGoalError("DOCUMENT_NOT_SENT");
    if (row.state === "ANULOWANY") throw new DevelopmentGoalError("GOAL_CANCELLED");

    const cancelled = toView(
      await tx.developmentGoal.update({ where: { id: goalId }, data: { state: "ANULOWANY" }, select: goalSelect }),
    );
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "development_goal",
      entityId: goalId,
      action: "CANCEL",
      before: auditRecord(toView(row)),
      after: auditRecord(cancelled),
    });
    return cancelled;
  });
}
