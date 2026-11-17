import { z } from "zod";

// Goal Centre, Part 2: performance goals (G2-10..17, G2-20..24).
//
// ONE schema for the goal form and the server (G2-24: validation repeated on the server). This
// module must stay client-safe: it imports nothing but zod, so the form can run it in the browser.
//
// Two save modes (G2-20):
// - DRAFT ("Zapisz i zamknij"): partial data allowed; only the title is required [ZAŁ: a card
//   without a title cannot be told apart in the list]. Every value that IS given must be valid.
// - PLAN ("Dodaj do planu"): every field required and valid; the goal becomes W_PLANIE.
//
// Context-dependent rules (due date inside the cycle year, numeric target for numeric target types)
// need the cycle and the target_type table. Without a context the schema checks everything else;
// the server uses that to refuse a bad payload before touching the database, then parses again
// with the context inside the write transaction. The form always passes the context.
//
// Issue messages are error codes (PerformanceGoalErrorCode); the form translates them and shows
// them under the field named by the issue path (G2-22).

export const GOAL_WEIGHT_MIN = 1;
export const GOAL_WEIGHT_MAX = 100;
export const GOAL_TITLE_MAX_LENGTH = 200;
export const GOAL_TEXT_MAX_LENGTH = 4000;
export const GOAL_TARGET_MAX_LENGTH = 500;

export const GOAL_SAVE_MODES = ["DRAFT", "PLAN"] as const;
export type GoalSaveMode = (typeof GOAL_SAVE_MODES)[number];

/** Mirrors the GoalState enum in prisma/schema.prisma (kept local so this module stays client-safe). */
export type PerformanceGoalState = "SZKIC" | "W_PLANIE" | "ANULOWANY";

/** G2-14, in list order. Default: DO_ROZPOCZECIA [ZAŁ]. */
export const GOAL_PROGRESS_VALUES = ["DO_ROZPOCZECIA", "W_TRAKCIE", "UKONCZONY"] as const;
export type GoalProgress = (typeof GOAL_PROGRESS_VALUES)[number];
export const DEFAULT_GOAL_PROGRESS: GoalProgress = "DO_ROZPOCZECIA";

/** target_type.code of the default type (G2-15: "Tekst"). */
export const DEFAULT_TARGET_TYPE_CODE = "TEKST";

export const GOAL_FIELDS = [
  "title",
  "description",
  "measures",
  "dueDate",
  "progress",
  "targetTypeId",
  "target",
  "weight",
] as const;
export type GoalField = (typeof GOAL_FIELDS)[number];

export const PERFORMANCE_GOAL_ERROR_CODES = [
  "INVALID_INPUT",
  "TITLE_REQUIRED",
  "DESCRIPTION_REQUIRED",
  "MEASURES_REQUIRED",
  "TEXT_TOO_LONG",
  "DATE_REQUIRED",
  "DATE_INVALID",
  "DATE_OUTSIDE_CYCLE",
  "PROGRESS_INVALID",
  "TARGET_TYPE_REQUIRED",
  "TARGET_TYPE_INVALID",
  "TARGET_REQUIRED",
  "TARGET_NOT_NUMBER",
  "WEIGHT_REQUIRED",
  "WEIGHT_INVALID",
] as const;
export type GoalInputErrorCode = (typeof PERFORMANCE_GOAL_ERROR_CODES)[number];

/** One target_type row as the form and the server need it. */
export interface TargetTypeOption {
  id: number;
  code: string;
  isNumeric: boolean;
}

export interface PerformanceGoalContext {
  cycleYear: number;
  /** Selectable target types (active ones, plus the goal's current type when editing). */
  targetTypes: readonly TargetTypeOption[];
}

/** Validated goal fields, ready to store. Null = not filled in (drafts only). */
export interface PerformanceGoalData {
  title: string;
  description: string | null;
  measures: string | null;
  /** ISO calendar date "YYYY-MM-DD". */
  dueDate: string | null;
  progress: GoalProgress;
  targetTypeId: number | null;
  /** Stored as text (performance_goal.target_value); numeric targets are normalised ("1.5"). */
  target: string | null;
  weight: number | null;
}

const MAX_INT4 = 2_147_483_647;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Numeric targets: optional minus, up to 15 integer digits (exact in a float8, e.g. for BI views),
// optional decimal part ("," or ".") of up to 6 digits. Exponents ("1e+21") are refused.
const DECIMAL_TEXT = /^-?\d{1,15}(?:[.,]\d{1,6})?$/;

// Postgres text cannot store NUL, and a lone UTF-16 surrogate would fail the jsonb audit snapshot.
const isStorableText = (value: string): boolean => !value.includes("\u0000") && value.isWellFormed();
const blankToNull = (value: string | null | undefined): string | null => (value ? value : null);

/** Year of a valid ISO calendar date, or null for malformed / impossible dates (2027-02-30). */
export function isoDateYear(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isReal ? year : null;
}

/** Optional trimmed text; blank becomes null. Shared with Part 3 (development-goal.ts). */
export function textField(maxLength: number) {
  return z
    .string({ error: "INVALID_INPUT" })
    .trim()
    .max(maxLength, { error: "TEXT_TOO_LONG" })
    .refine(isStorableText, { error: "INVALID_INPUT" })
    .nullish()
    .transform(blankToNull);
}

const dueDateField = z
  .string({ error: "DATE_INVALID" })
  .trim()
  .refine((value) => value === "" || isoDateYear(value) !== null, { error: "DATE_INVALID" })
  .nullish()
  .transform(blankToNull);

// Whole number 1-100 (G2-23). A string ("30") is refused too: the form sends numbers.
const weightField = z
  .number({ error: "WEIGHT_INVALID" })
  .int({ error: "WEIGHT_INVALID" })
  .min(GOAL_WEIGHT_MIN, { error: "WEIGHT_INVALID" })
  .max(GOAL_WEIGHT_MAX, { error: "WEIGHT_INVALID" })
  .nullish()
  .transform((value) => value ?? null);

const targetTypeIdField = z
  .number({ error: "TARGET_TYPE_INVALID" })
  .int({ error: "TARGET_TYPE_INVALID" })
  .min(1, { error: "TARGET_TYPE_INVALID" })
  .max(MAX_INT4, { error: "TARGET_TYPE_INVALID" })
  .nullish()
  .transform((value) => value ?? null);

// A number for numeric types, text for "Tekst"; which one applies is checked against the context.
const targetField = z
  .union(
    [
      z.string().trim().max(GOAL_TARGET_MAX_LENGTH, { error: "TEXT_TOO_LONG" }).refine(isStorableText),
      // z.number() already refuses NaN and Infinity.
      z.number(),
    ],
    { error: "INVALID_INPUT" },
  )
  .nullish()
  .transform((value) => (value === "" || value === undefined ? null : value));

const goalShape = z
  .object({
    title: textField(GOAL_TITLE_MAX_LENGTH),
    description: textField(GOAL_TEXT_MAX_LENGTH),
    measures: textField(GOAL_TEXT_MAX_LENGTH),
    dueDate: dueDateField,
    progress: z.enum(GOAL_PROGRESS_VALUES, { error: "PROGRESS_INVALID" }).default(DEFAULT_GOAL_PROGRESS),
    targetTypeId: targetTypeIdField,
    target: targetField,
    weight: weightField,
  })
  // Unknown keys (state, documentId, changedByManager...) mean a hand-crafted request: refuse them.
  .strict();

type GoalShape = z.output<typeof goalShape>;
type IssueSink = (field: GoalField, code: GoalInputErrorCode) => void;

const REQUIRED_IN_PLAN: readonly (readonly [GoalField, GoalInputErrorCode])[] = [
  ["description", "DESCRIPTION_REQUIRED"],
  ["measures", "MEASURES_REQUIRED"],
  ["dueDate", "DATE_REQUIRED"],
  ["target", "TARGET_REQUIRED"],
  ["weight", "WEIGHT_REQUIRED"],
];

/** The type the goal is saved with: the chosen one, else "Tekst" (G2-15). */
function effectiveTargetType(goal: GoalShape, context: PerformanceGoalContext): TargetTypeOption | undefined {
  if (goal.targetTypeId === null) return context.targetTypes.find((t) => t.code === DEFAULT_TARGET_TYPE_CODE);
  return context.targetTypes.find((t) => t.id === goal.targetTypeId);
}

function checkRequired(goal: GoalShape, mode: GoalSaveMode, report: IssueSink): void {
  if (goal.title === null) report("title", "TITLE_REQUIRED");
  if (mode === "DRAFT") return;
  for (const [field, code] of REQUIRED_IN_PLAN) {
    if (goal[field] === null) report(field, code);
  }
}

function checkAgainstContext(goal: GoalShape, context: PerformanceGoalContext, report: IssueSink): void {
  // A malformed date already carries DATE_INVALID; only a real date can be outside the cycle.
  const dueYear = goal.dueDate === null ? null : isoDateYear(goal.dueDate);
  if (dueYear !== null && dueYear !== context.cycleYear) report("dueDate", "DATE_OUTSIDE_CYCLE");

  const type = effectiveTargetType(goal, context);
  if (!type) {
    report("targetTypeId", goal.targetTypeId === null ? "TARGET_TYPE_REQUIRED" : "TARGET_TYPE_INVALID");
    return;
  }
  if (!type.isNumeric || goal.target === null) return;
  // A JS number goes through its string form too, so 1e21 ("1e+21") is refused like typed text.
  if (!DECIMAL_TEXT.test(String(goal.target))) report("target", "TARGET_NOT_NUMBER");
}

function storedTarget(target: string | number | null, type: TargetTypeOption | undefined): string | null {
  if (target === null) return null;
  if (typeof target === "number") return String(target);
  // Numeric text typed with a decimal comma is stored with a dot; free text is kept as typed.
  return type?.isNumeric ? target.replace(",", ".") : target;
}

/**
 * The shared goal schema; parse output is PerformanceGoalData. `context` adds the cycle-year and
 * target-type rules - omit it only for the server's pre-transaction check.
 */
export function performanceGoalSchema(mode: GoalSaveMode, context?: PerformanceGoalContext) {
  return goalShape
    .superRefine((goal, ctx) => {
      const report: IssueSink = (field, code) => ctx.addIssue({ code: "custom", path: [field], message: code });
      checkRequired(goal, mode, report);
      if (context) checkAgainstContext(goal, context, report);
    })
    .transform((goal): PerformanceGoalData => {
      const type = context ? effectiveTargetType(goal, context) : undefined;
      return {
        // checkRequired guarantees a title once parsing succeeds.
        title: goal.title ?? "",
        description: goal.description,
        measures: goal.measures,
        dueDate: goal.dueDate,
        progress: goal.progress,
        targetTypeId: type?.id ?? goal.targetTypeId,
        target: storedTarget(goal.target, type),
        weight: goal.weight,
      };
    });
}

const KNOWN_CODES: ReadonlySet<string> = new Set(PERFORMANCE_GOAL_ERROR_CODES);
const isGoalField = (key: unknown): key is GoalField => (GOAL_FIELDS as readonly unknown[]).includes(key);

export interface GoalFieldIssue {
  /** Null for issues not tied to one field (payload is not an object, unknown keys). */
  field: GoalField | null;
  code: GoalInputErrorCode;
}

/** Zod issues as {field, code}; anything without one of our codes becomes INVALID_INPUT. */
export function goalIssues(error: z.ZodError): GoalFieldIssue[] {
  return error.issues.map((issue) => {
    const key = issue.path[0];
    return {
      field: issue.path.length > 0 && isGoalField(key) ? key : null,
      code: KNOWN_CODES.has(issue.message) ? (issue.message as GoalInputErrorCode) : "INVALID_INPUT",
    };
  });
}

/** First error per field, shown under the inputs in place of the hint (G2-22). */
export function goalFieldErrors(error: z.ZodError): Partial<Record<GoalField, GoalInputErrorCode>> {
  const errors: Partial<Record<GoalField, GoalInputErrorCode>> = {};
  for (const { field, code } of goalIssues(error)) {
    if (field !== null && errors[field] === undefined) errors[field] = code;
  }
  return errors;
}

/** G2-21: "Dodaj do planu" is enabled only when the full PLAN validation passes. */
export function canAddToPlan(values: unknown, context: PerformanceGoalContext): boolean {
  return performanceGoalSchema("PLAN", context).safeParse(values).success;
}

// ---------------------------------------------------------------------------
// Progress <-> performance_goal.progress (int percent, kept for the BI views and seed data)
// ---------------------------------------------------------------------------

const PROGRESS_PERCENT: Readonly<Record<GoalProgress, number>> = {
  DO_ROZPOCZECIA: 0,
  W_TRAKCIE: 50,
  UKONCZONY: 100,
};

/** 0 = not started, 100 = completed, anything between = in progress (G2-08). */
export function progressFromPercent(percent: number): GoalProgress {
  if (percent <= 0) return "DO_ROZPOCZECIA";
  return percent >= 100 ? "UKONCZONY" : "W_TRAKCIE";
}

/** Percent to store; an unchanged status keeps the stored value (e.g. 75 from an import). */
export function progressToPercent(progress: GoalProgress, previousPercent?: number): number {
  if (previousPercent !== undefined && progressFromPercent(previousPercent) === progress) return previousPercent;
  return PROGRESS_PERCENT[progress];
}

// ---------------------------------------------------------------------------
// Counters (G2-04, G2-05)
// ---------------------------------------------------------------------------

export interface PerformanceGoalCounters {
  notInPlan: number;
  inPlan: number;
  changedByManager: number;
  cancelled: number;
  progress: Record<GoalProgress, number>;
  /** "Łączna waga celów dodanych do planu" - checked against the cycle's sum when sending (G2-26). */
  totalWeightInPlan: number;
}

export interface CountableGoal {
  state: PerformanceGoalState;
  progress: GoalProgress;
  weight: number | null;
  changedByManager: boolean;
}

/** Cancelled goals count only in "Anulowane": they are left out of every other counter. */
export function performanceGoalCounters(goals: readonly CountableGoal[]): PerformanceGoalCounters {
  const live = goals.filter((goal) => goal.state !== "ANULOWANY");
  const inPlan = live.filter((goal) => goal.state === "W_PLANIE");
  const countProgress = (value: GoalProgress) => live.filter((goal) => goal.progress === value).length;
  return {
    notInPlan: live.length - inPlan.length,
    inPlan: inPlan.length,
    changedByManager: live.filter((goal) => goal.changedByManager).length,
    cancelled: goals.length - live.length,
    progress: {
      DO_ROZPOCZECIA: countProgress("DO_ROZPOCZECIA"),
      W_TRAKCIE: countProgress("W_TRAKCIE"),
      UKONCZONY: countProgress("UKONCZONY"),
    },
    totalWeightInPlan: inPlan.reduce((sum, goal) => sum + (goal.weight ?? 0), 0),
  };
}
