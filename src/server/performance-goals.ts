import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { CycleStatus, DocumentStatus } from "@/generated/prisma/enums";
import {
  DEFAULT_TARGET_TYPE_CODE,
  GOAL_SAVE_MODES,
  goalIssues,
  performanceGoalCounters,
  performanceGoalSchema,
  progressFromPercent,
  progressToPercent,
  type GoalFieldIssue,
  type GoalInputErrorCode,
  type GoalProgress,
  type GoalSaveMode,
  type PerformanceGoalContext,
  type PerformanceGoalCounters,
  type PerformanceGoalData,
  type PerformanceGoalState,
  type TargetTypeOption,
} from "@/domain/performance-goal";
import { writeAudit } from "@/server/audit";
import { fromIsoDate, lockOwnGoalDocument, toIsoDate, type LockedGoalDocument } from "@/server/goal-document";
import { EDITABLE_DOCUMENT_STATUSES } from "@/server/group-goals";
import { ForbiddenError, NotFoundError, requireDocumentPermission, type Viewer } from "@/server/permissions";

// Goal Centre, Part 2: server operations on performance goals (G2-10..26).
//
// Every write: shared zod schema (src/domain/performance-goal.ts) -> transaction that locks the
// document row -> permission module (edit + owner only) -> cycle open and document not sent ->
// write -> audit row in the same transaction.
//
// - create / update: DRAFT keeps the goal SZKIC (partial data), PLAN validates every field and sets
//   W_PLANIE ("Dodaj do planu").
// - delete: only while the document has never been sent (G2-25). Once sent, N+1 has seen the plan,
//   so a goal can only be cancelled.
// - cancel ("Anuluj cel"): only after the document has been sent; the goal stays as ANULOWANY.
//
// Who: owner only, like Part 1. HR's general "edit" right does not extend to writing someone's
// goals; N+1 changes during validation (WF-04, "Zmienione przez N+1") belong to the validation flow.
// When: cycle OTWARTY and document SZKIC or ZWROCONY - so in practice cancel runs on a returned
// document. Both are re-asserted inside the transaction with the document row locked FOR UPDATE.

const MAX_INT4 = 2_147_483_647;
/** [ZAŁ] Upper bound per document (Q-03 asks HR for the real maximum); counts cancelled goals too. */
export const MAX_GOALS_PER_DOCUMENT = 50;
const dbIdSchema = z.number().int().min(1).max(MAX_INT4);
const saveModeSchema = z.enum(GOAL_SAVE_MODES);

export const createGoalInputSchema = z
  .object({ documentId: dbIdSchema, mode: saveModeSchema, goal: z.unknown() })
  .strict();
export const updateGoalInputSchema = z.object({ goalId: dbIdSchema, mode: saveModeSchema, goal: z.unknown() }).strict();
export const goalIdInputSchema = z.object({ goalId: dbIdSchema }).strict();

/** Rule violations that are not about the payload. */
export type GoalStateErrorCode =
  | "NOT_EDITABLE"
  | "GOAL_CANCELLED"
  | "DOCUMENT_ALREADY_SENT"
  | "DOCUMENT_NOT_SENT"
  | "TOO_MANY_GOALS"
  | "DEFAULT_TARGET_TYPE_MISSING";

export type PerformanceGoalErrorCode = GoalInputErrorCode | GoalStateErrorCode;

export const HTTP_BAD_REQUEST = 400;
export const HTTP_CONFLICT = 409;
const HTTP_SERVER_ERROR = 500;

const STATE_ERROR_CODES: ReadonlySet<PerformanceGoalErrorCode> = new Set<GoalStateErrorCode>([
  "NOT_EDITABLE",
  "GOAL_CANCELLED",
  "DOCUMENT_ALREADY_SENT",
  "DOCUMENT_NOT_SENT",
  "TOO_MANY_GOALS",
  "DEFAULT_TARGET_TYPE_MISSING",
]);

export class PerformanceGoalError extends Error {
  /** 400 for an invalid payload (G2-24); 409 when the goal or document does not allow the action. */
  readonly status: typeof HTTP_BAD_REQUEST | typeof HTTP_CONFLICT;

  constructor(
    readonly code: PerformanceGoalErrorCode,
    /** Field-level issues of an invalid payload, shown next to the inputs. */
    readonly issues: readonly GoalFieldIssue[] = [],
  ) {
    super(`Performance goal: ${code}`);
    this.name = "PerformanceGoalError";
    this.status = STATE_ERROR_CODES.has(code) ? HTTP_CONFLICT : HTTP_BAD_REQUEST;
  }
}

/** HTTP status for anything a performance-goal operation throws (route handlers, actions). */
export function performanceGoalHttpStatus(error: unknown): number {
  if (error instanceof PerformanceGoalError || error instanceof NotFoundError || error instanceof ForbiddenError) {
    return error.status;
  }
  return HTTP_SERVER_ERROR;
}

function parseEnvelope<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PerformanceGoalError("INVALID_INPUT");
  return parsed.data;
}

function parseGoal(mode: GoalSaveMode, goal: unknown, context?: PerformanceGoalContext): PerformanceGoalData {
  const parsed = performanceGoalSchema(mode, context).safeParse(goal);
  if (parsed.success) return parsed.data;
  const issues = goalIssues(parsed.error);
  throw new PerformanceGoalError(issues[0]?.code ?? "INVALID_INPUT", issues);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface PerformanceGoalView {
  id: number;
  documentId: number;
  title: string;
  description: string | null;
  measures: string | null;
  /** ISO calendar date "YYYY-MM-DD". */
  dueDate: string | null;
  progress: GoalProgress;
  targetTypeId: number | null;
  targetTypeCode: string | null;
  target: string | null;
  weight: number | null;
  state: PerformanceGoalState;
  changedByManager: boolean;
}

const goalSelect = {
  id: true,
  documentId: true,
  title: true,
  description: true,
  measures: true,
  dueDate: true,
  progress: true,
  targetTypeId: true,
  targetValue: true,
  weight: true,
  state: true,
  changedByManager: true,
  targetType: { select: { code: true } },
} satisfies Prisma.PerformanceGoalSelect;

type GoalRow = Prisma.PerformanceGoalGetPayload<{ select: typeof goalSelect }>;

function toView(row: GoalRow): PerformanceGoalView {
  return {
    id: row.id,
    documentId: row.documentId,
    title: row.title,
    description: row.description,
    measures: row.measures,
    dueDate: toIsoDate(row.dueDate),
    progress: progressFromPercent(row.progress),
    targetTypeId: row.targetTypeId,
    targetTypeCode: row.targetType?.code ?? null,
    target: row.targetValue,
    weight: row.weight,
    state: row.state,
    changedByManager: row.changedByManager,
  };
}

interface GoalSnapshot {
  title: string;
  description: string | null;
  measures: string | null;
  dueDate: string | null;
  progress: GoalProgress;
  targetTypeId: number | null;
  target: string | null;
  weight: number | null;
  state: PerformanceGoalState;
}

/** Audited fields. Always built here, so two snapshots have the same key order and compare as JSON. */
function snapshot(goal: GoalSnapshot): GoalSnapshot {
  return {
    title: goal.title,
    description: goal.description,
    measures: goal.measures,
    dueDate: goal.dueDate,
    progress: goal.progress,
    targetTypeId: goal.targetTypeId,
    target: goal.target,
    weight: goal.weight,
    state: goal.state,
  };
}

/** before / after of an audit row: the same shape for every action. */
const auditRecord = (goal: PerformanceGoalView) => ({ documentId: goal.documentId, ...snapshot(goal) });

const stateFor = (mode: GoalSaveMode): PerformanceGoalState => (mode === "PLAN" ? "W_PLANIE" : "SZKIC");

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type PerformanceGoalReader = Pick<PrismaClient, "performanceGoal" | "employee" | "gedpDocument">;

export interface PerformanceGoalsForDocument {
  documentId: number;
  status: DocumentStatus;
  /** The viewer may add, edit, delete or cancel goals right now. */
  canChange: boolean;
  goals: PerformanceGoalView[];
  counters: PerformanceGoalCounters;
}

/** Performance goals of a document the viewer may see (NotFoundError otherwise). */
export async function loadPerformanceGoals(
  db: PerformanceGoalReader,
  viewer: Viewer,
  documentId: number,
  cycleStatus: CycleStatus,
): Promise<PerformanceGoalsForDocument> {
  const access = await requireDocumentPermission(db, viewer, documentId, "view");
  const rows = await db.performanceGoal.findMany({ where: { documentId }, select: goalSelect, orderBy: { id: "asc" } });
  const goals = rows.map(toView);
  return {
    documentId,
    status: access.status,
    canChange:
      access.employeeId === viewer.id &&
      cycleStatus === "OTWARTY" &&
      EDITABLE_DOCUMENT_STATUSES.includes(access.status),
    goals,
    counters: performanceGoalCounters(goals),
  };
}

/** Form context for a document: cycle year and selectable target types (same data the server uses). */
export async function loadGoalFormContext(
  db: Pick<PrismaClient, "targetType">,
  cycleYear: number,
): Promise<PerformanceGoalContext> {
  const targetTypes = await db.targetType.findMany({
    where: { isActive: true },
    select: { id: true, code: true, isNumeric: true },
    orderBy: { id: "asc" },
  });
  return { cycleYear, targetTypes };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;
export type PerformanceGoalWriter = Pick<PrismaClient, "$transaction">;

/** Lock + owner check (goal-document.ts), then an open cycle and a not-sent document. */
async function lockEditableDocument(tx: Tx, viewer: Viewer, documentId: number): Promise<LockedGoalDocument> {
  const document = await lockOwnGoalDocument(tx, viewer, documentId);
  if (!document.isEditable) throw new PerformanceGoalError("NOT_EDITABLE");
  return document;
}

/**
 * Locks the goal's document (lockEditableDocument), then re-reads the goal under that lock. A goal
 * that does not exist is reported exactly like an invisible one: NotFoundError.
 */
async function lockEditableGoal(tx: Tx, viewer: Viewer, goalId: number): Promise<{ document: LockedGoalDocument; row: GoalRow }> {
  const owner = await tx.performanceGoal.findUnique({ where: { id: goalId }, select: { documentId: true } });
  if (!owner) throw new NotFoundError(`performance goal ${goalId}`);
  const document = await lockEditableDocument(tx, viewer, owner.documentId);
  // Pinned to the locked document: a goal deleted (or ever moved) since the first read is not found.
  const row = await tx.performanceGoal.findFirst({
    where: { id: goalId, documentId: owner.documentId },
    select: goalSelect,
  });
  if (!row) throw new NotFoundError(`performance goal ${goalId}`);
  return { document, row };
}

/**
 * Active target types, plus the default "Tekst" and `keepTypeId` even if HR has deactivated them:
 * a goal keeps its type, and a goal without one can always fall back to the default.
 */
async function loadTargetTypes(tx: Tx, keepTypeId: number | null): Promise<TargetTypeOption[]> {
  const kept: Prisma.TargetTypeWhereInput[] = [{ isActive: true }, { code: DEFAULT_TARGET_TYPE_CODE }];
  if (keepTypeId !== null) kept.push({ id: keepTypeId });
  return tx.targetType.findMany({ where: { OR: kept }, select: { id: true, code: true, isNumeric: true } });
}

function parseWithTypes(mode: GoalSaveMode, goal: unknown, context: PerformanceGoalContext): PerformanceGoalData {
  const data = parseGoal(mode, goal, context);
  // The schema falls back to "Tekst"; no type here means the target_type seed is missing.
  if (data.targetTypeId === null) throw new PerformanceGoalError("DEFAULT_TARGET_TYPE_MISSING");
  return data;
}

function goalColumns(data: PerformanceGoalData, mode: GoalSaveMode, previousPercent?: number) {
  return {
    title: data.title,
    description: data.description,
    measures: data.measures,
    dueDate: fromIsoDate(data.dueDate),
    progress: progressToPercent(data.progress, previousPercent),
    targetTypeId: data.targetTypeId,
    targetValue: data.target,
    weight: data.weight,
    state: stateFor(mode),
  };
}

/** New goal: "Zapisz i zamknij" (DRAFT) or "Dodaj do planu" (PLAN). */
export async function createPerformanceGoal(
  db: PerformanceGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<PerformanceGoalView> {
  const { documentId, mode, goal } = parseEnvelope(createGoalInputSchema, input);
  // Payload errors (weight 0 or 12.5, malformed date...) are refused before any database call.
  parseGoal(mode, goal);

  return db.$transaction(async (tx) => {
    const { cycleYear } = await lockEditableDocument(tx, viewer, documentId);
    if ((await tx.performanceGoal.count({ where: { documentId } })) >= MAX_GOALS_PER_DOCUMENT) {
      throw new PerformanceGoalError("TOO_MANY_GOALS");
    }
    const data = parseWithTypes(mode, goal, { cycleYear, targetTypes: await loadTargetTypes(tx, null) });
    const row = await tx.performanceGoal.create({
      data: { documentId, ...goalColumns(data, mode) },
      select: goalSelect,
    });
    const created = toView(row);
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "performance_goal",
      entityId: created.id,
      action: "CREATE",
      after: auditRecord(created),
    });
    return created;
  });
}

/**
 * Edits a goal (full replace: the form always sends every field). The save mode sets the state
 * (DRAFT -> SZKIC, PLAN -> W_PLANIE), except that a goal already in the plan stays there: its
 * "Zapisz i zamknij" is validated like "Dodaj do planu", so it never silently drops out of the plan.
 */
export async function updatePerformanceGoal(
  db: PerformanceGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<PerformanceGoalView> {
  const { goalId, mode, goal } = parseEnvelope(updateGoalInputSchema, input);
  parseGoal(mode, goal);

  return db.$transaction(async (tx) => {
    const { document, row } = await lockEditableGoal(tx, viewer, goalId);
    const before = toView(row);
    if (before.state === "ANULOWANY") throw new PerformanceGoalError("GOAL_CANCELLED");

    const saveMode: GoalSaveMode = before.state === "W_PLANIE" ? "PLAN" : mode;
    const targetTypes = await loadTargetTypes(tx, before.targetTypeId);
    const data = parseWithTypes(saveMode, goal, { cycleYear: document.cycleYear, targetTypes });
    // Unchanged goal: no write and no audit row, so repeated saves cannot grow audit_log.
    const unchanged =
      JSON.stringify(snapshot({ ...data, state: stateFor(saveMode) })) === JSON.stringify(snapshot(before));
    if (unchanged) return before;

    const updated = toView(
      await tx.performanceGoal.update({
        where: { id: goalId },
        data: goalColumns(data, saveMode, row.progress),
        select: goalSelect,
      }),
    );
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "performance_goal",
      entityId: goalId,
      action: "UPDATE",
      before: auditRecord(before),
      after: auditRecord(updated),
    });
    return updated;
  });
}

/** Deletes a goal - only while the document has never been sent (G2-25). */
export async function deletePerformanceGoal(db: PerformanceGoalWriter, viewer: Viewer, input: unknown): Promise<void> {
  const { goalId } = parseEnvelope(goalIdInputSchema, input);
  await db.$transaction(async (tx) => {
    const { document, row } = await lockEditableGoal(tx, viewer, goalId);
    if (document.wasSent) throw new PerformanceGoalError("DOCUMENT_ALREADY_SENT");

    await tx.performanceGoal.delete({ where: { id: goalId } });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "performance_goal",
      entityId: goalId,
      action: "DELETE",
      before: auditRecord(toView(row)),
    });
  });
}

/** "Anuluj cel": after the document has been sent the goal stays, as ANULOWANY (G2-25). */
export async function cancelPerformanceGoal(
  db: PerformanceGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<PerformanceGoalView> {
  const { goalId } = parseEnvelope(goalIdInputSchema, input);
  return db.$transaction(async (tx) => {
    const { document, row } = await lockEditableGoal(tx, viewer, goalId);
    if (!document.wasSent) throw new PerformanceGoalError("DOCUMENT_NOT_SENT");
    if (row.state === "ANULOWANY") throw new PerformanceGoalError("GOAL_CANCELLED");

    const cancelled = toView(
      await tx.performanceGoal.update({ where: { id: goalId }, data: { state: "ANULOWANY" }, select: goalSelect }),
    );
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "performance_goal",
      entityId: goalId,
      action: "CANCEL",
      before: auditRecord(toView(row)),
      after: auditRecord(cancelled),
    });
    return cancelled;
  });
}
