import { z } from "zod";
import {
  DEFAULT_GOAL_PROGRESS,
  GOAL_PROGRESS_VALUES,
  GOAL_TEXT_MAX_LENGTH,
  GOAL_TITLE_MAX_LENGTH,
  isoDateYear,
  textField,
  type GoalProgress,
  type GoalSaveMode,
  type PerformanceGoalState,
} from "@/domain/performance-goal";

// Goal Centre, Part 3: development goals (G3-10, G3-12, G3-13, G3-16, G3-20).
//
// The model is still open (Q-04: slide 12 "like performance goals" vs the eGEDP 3-step wizard).
// This schema holds ONLY the fields both models share: competency + development area from the
// per-cycle catalogue, action title / description, a start-end date range and progress. Measure,
// target type and weight (G3-11, G3-14, G3-15) are deliberately absent until HR decides.
//
// Same contract as Part 2 (performance-goal.ts): ONE schema for the form and the server, client-safe
// (zod only), two save modes, issue messages are error codes, and catalogue rules need a context
// (the server parses once without it before the transaction, then again inside it with the cycle's
// catalogue).
//
// - DRAFT ("Zapisz i zamknij"): competency and action title are required [ZAŁ: the card is titled
//   by the competency, and action_title is NOT NULL]; anything else may be missing but must be valid.
// - PLAN ("Dodaj do planu"): every field is required [ZAŁ, as in Part 2 until Q-16].

export { GOAL_PROGRESS_VALUES, GOAL_SAVE_MODES, type GoalProgress, type GoalSaveMode } from "@/domain/performance-goal";

/** Mirrors the GoalState enum in prisma/schema.prisma (shared by Parts 2 and 3). */
export type DevelopmentGoalState = PerformanceGoalState;

export const DEVELOPMENT_GOAL_FIELDS = [
  "competencyId",
  "developmentAreaId",
  "actionTitle",
  "actionDescription",
  "startDate",
  "endDate",
  "progress",
] as const;
export type DevelopmentGoalField = (typeof DEVELOPMENT_GOAL_FIELDS)[number];

export const DEVELOPMENT_GOAL_ERROR_CODES = [
  "INVALID_INPUT",
  "COMPETENCY_REQUIRED",
  "COMPETENCY_INVALID",
  "COMPETENCY_INACTIVE",
  "AREA_REQUIRED",
  "AREA_INVALID",
  "AREA_INACTIVE",
  "ACTION_TITLE_REQUIRED",
  "ACTION_DESCRIPTION_REQUIRED",
  "TEXT_TOO_LONG",
  "DATE_REQUIRED",
  "DATE_INVALID",
  "DATE_OUTSIDE_CYCLE",
  "END_BEFORE_START",
  "PROGRESS_INVALID",
] as const;
export type DevelopmentGoalInputErrorCode = (typeof DEVELOPMENT_GOAL_ERROR_CODES)[number];

/** One competency or development-area row of the cycle's catalogue (G3-20). */
export interface CatalogOption {
  id: number;
  namePl: string;
  nameEn: string;
  isActive: boolean;
}

export interface DevelopmentGoalContext {
  cycleYear: number;
  /** Every competency of the document's cycle; only active ones may be chosen. */
  competencies: readonly CatalogOption[];
  /** Every development area of the document's cycle; only active ones may be chosen. */
  developmentAreas: readonly CatalogOption[];
}

/** Validated goal fields, ready to store. Null = not filled in (drafts only). */
export interface DevelopmentGoalData {
  competencyId: number | null;
  developmentAreaId: number | null;
  actionTitle: string;
  actionDescription: string | null;
  /** ISO calendar dates "YYYY-MM-DD"; the form shows them as one range field. */
  startDate: string | null;
  endDate: string | null;
  progress: GoalProgress;
}

const MAX_INT4 = 2_147_483_647;

const catalogIdField = (code: "COMPETENCY_INVALID" | "AREA_INVALID") =>
  z
    .number({ error: code })
    .int({ error: code })
    .min(1, { error: code })
    .max(MAX_INT4, { error: code })
    .nullish()
    .transform((value) => value ?? null);

const dateField = z
  .string({ error: "DATE_INVALID" })
  .trim()
  .refine((value) => value === "" || isoDateYear(value) !== null, { error: "DATE_INVALID" })
  .nullish()
  .transform((value) => (value ? value : null));

const goalShape = z
  .object({
    competencyId: catalogIdField("COMPETENCY_INVALID"),
    developmentAreaId: catalogIdField("AREA_INVALID"),
    actionTitle: textField(GOAL_TITLE_MAX_LENGTH),
    actionDescription: textField(GOAL_TEXT_MAX_LENGTH),
    startDate: dateField,
    endDate: dateField,
    progress: z.enum(GOAL_PROGRESS_VALUES, { error: "PROGRESS_INVALID" }).default(DEFAULT_GOAL_PROGRESS),
  })
  // Unknown keys (state, documentId, weight, targetTypeId...) mean a hand-crafted request: refuse them.
  .strict();

type GoalShape = z.output<typeof goalShape>;
type IssueSink = (field: DevelopmentGoalField, code: DevelopmentGoalInputErrorCode) => void;

const REQUIRED_IN_PLAN: readonly (readonly [DevelopmentGoalField, DevelopmentGoalInputErrorCode])[] = [
  ["developmentAreaId", "AREA_REQUIRED"],
  ["actionDescription", "ACTION_DESCRIPTION_REQUIRED"],
  ["startDate", "DATE_REQUIRED"],
  ["endDate", "DATE_REQUIRED"],
];

function checkRequired(goal: GoalShape, mode: GoalSaveMode, report: IssueSink): void {
  if (goal.competencyId === null) report("competencyId", "COMPETENCY_REQUIRED");
  if (goal.actionTitle === null) report("actionTitle", "ACTION_TITLE_REQUIRED");
  if (mode === "DRAFT") return;
  for (const [field, code] of REQUIRED_IN_PLAN) {
    if (goal[field] === null) report(field, code);
  }
}

function checkDateRange(goal: GoalShape, report: IssueSink): void {
  // Valid ISO dates compare correctly as strings.
  if (goal.startDate === null || goal.endDate === null) return;
  if (isoDateYear(goal.startDate) === null || isoDateYear(goal.endDate) === null) return;
  if (goal.endDate < goal.startDate) report("endDate", "END_BEFORE_START");
}

function checkCatalog(
  id: number | null,
  options: readonly CatalogOption[],
  field: "competencyId" | "developmentAreaId",
  report: IssueSink,
): void {
  if (id === null) return;
  const option = options.find((candidate) => candidate.id === id);
  const isCompetency = field === "competencyId";
  if (!option) report(field, isCompetency ? "COMPETENCY_INVALID" : "AREA_INVALID");
  else if (!option.isActive) report(field, isCompetency ? "COMPETENCY_INACTIVE" : "AREA_INACTIVE");
}

function checkAgainstContext(goal: GoalShape, context: DevelopmentGoalContext, report: IssueSink): void {
  checkCatalog(goal.competencyId, context.competencies, "competencyId", report);
  checkCatalog(goal.developmentAreaId, context.developmentAreas, "developmentAreaId", report);
  // [ZAŁ] Like G2-13: the range lies inside the cycle year (eGEDP example: 02/01/2026 - 31/12/2026).
  for (const field of ["startDate", "endDate"] as const) {
    const value = goal[field];
    const year = value === null ? null : isoDateYear(value);
    if (year !== null && year !== context.cycleYear) report(field, "DATE_OUTSIDE_CYCLE");
  }
}

/**
 * The shared development-goal schema; parse output is DevelopmentGoalData. `context` adds the
 * catalogue and cycle-year rules - omit it only for the server's pre-transaction check.
 */
export function developmentGoalSchema(mode: GoalSaveMode, context?: DevelopmentGoalContext) {
  return goalShape
    .superRefine((goal, ctx) => {
      const report: IssueSink = (field, code) => ctx.addIssue({ code: "custom", path: [field], message: code });
      checkRequired(goal, mode, report);
      checkDateRange(goal, report);
      if (context) checkAgainstContext(goal, context, report);
    })
    .transform(
      (goal): DevelopmentGoalData => ({
        ...goal,
        // checkRequired guarantees an action title once parsing succeeds.
        actionTitle: goal.actionTitle ?? "",
      }),
    );
}

const KNOWN_CODES: ReadonlySet<string> = new Set(DEVELOPMENT_GOAL_ERROR_CODES);
const isGoalField = (key: unknown): key is DevelopmentGoalField =>
  (DEVELOPMENT_GOAL_FIELDS as readonly unknown[]).includes(key);

export interface DevelopmentGoalFieldIssue {
  /** Null for issues not tied to one field (payload is not an object, unknown keys). */
  field: DevelopmentGoalField | null;
  code: DevelopmentGoalInputErrorCode;
}

/** Zod issues as {field, code}; anything without one of our codes becomes INVALID_INPUT. */
export function developmentGoalIssues(error: z.ZodError): DevelopmentGoalFieldIssue[] {
  return error.issues.map((issue) => {
    const key = issue.path[0];
    return {
      field: issue.path.length > 0 && isGoalField(key) ? key : null,
      code: KNOWN_CODES.has(issue.message) ? (issue.message as DevelopmentGoalInputErrorCode) : "INVALID_INPUT",
    };
  });
}

/** First error per field, shown under the inputs. */
export function developmentGoalFieldErrors(
  error: z.ZodError,
): Partial<Record<DevelopmentGoalField, DevelopmentGoalInputErrorCode>> {
  const errors: Partial<Record<DevelopmentGoalField, DevelopmentGoalInputErrorCode>> = {};
  for (const { field, code } of developmentGoalIssues(error)) {
    if (field !== null && errors[field] === undefined) errors[field] = code;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Counters (G3-04)
// ---------------------------------------------------------------------------

export interface DevelopmentGoalCounters {
  drafts: number;
  inPlan: number;
  changedByManager: number;
  cancelled: number;
  progress: Record<GoalProgress, number>;
}

export interface CountableDevelopmentGoal {
  state: DevelopmentGoalState;
  progress: GoalProgress;
  changedByManager: boolean;
}

/** Cancelled goals count only in "Anulowane": they are left out of every other counter. */
export function developmentGoalCounters(goals: readonly CountableDevelopmentGoal[]): DevelopmentGoalCounters {
  const live = goals.filter((goal) => goal.state !== "ANULOWANY");
  const inPlan = live.filter((goal) => goal.state === "W_PLANIE").length;
  const countProgress = (value: GoalProgress) => live.filter((goal) => goal.progress === value).length;
  return {
    drafts: live.length - inPlan,
    inPlan,
    changedByManager: live.filter((goal) => goal.changedByManager).length,
    cancelled: goals.length - live.length,
    progress: {
      DO_ROZPOCZECIA: countProgress("DO_ROZPOCZECIA"),
      W_TRAKCIE: countProgress("W_TRAKCIE"),
      UKONCZONY: countProgress("UKONCZONY"),
    },
  };
}
