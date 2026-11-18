// Closing conditions of a GEDP document (WF-C1..C5, slide 5): the ONE function that decides whether
// a document may be sent to validation. Pure and client-safe: the server send action re-checks it
// inside the transaction (src/server/workflow.ts) and the UI uses its result to block the
// "Wyślij do walidacji" button and list what is missing next to it.
//
//   WF-C1  Leadership goal acknowledged
//   WF-C2  Group Values acknowledged
//   WF-C3  BHP: own commitment written (non-empty)
//   WF-C4  >= cycle.minPerformanceGoals in the plan AND their weight sum = cycle.requiredWeightSum
//   WF-C5  >= cycle.minDevelopmentGoals in the plan
//
// Thresholds come from the cycle, never from this file: Q-03 is open, so HR can change them per
// cycle (database defaults 1 / 100 / 1).

export type ClosingGroupGoalType = "PRZYWODZTWO" | "WARTOSCI" | "BHP";
export type ClosingGoalState = "SZKIC" | "W_PLANIE" | "ANULOWANY";

/** Per-cycle thresholds (cycle.min_performance_goals, required_weight_sum, min_development_goals). */
export interface ClosingCycleConfig {
  minPerformanceGoals: number;
  requiredWeightSum: number;
  minDevelopmentGoals: number;
}

/** What the conditions look at in one document. */
export interface ClosingDocument {
  /** One entry per HR template of the cycle. */
  groupGoals: readonly { type: ClosingGroupGoalType; isAcknowledged: boolean; commitment: string | null }[];
  performanceGoals: readonly { state: ClosingGoalState; weight: number | null }[];
  developmentGoals: readonly { state: ClosingGoalState }[];
  cycle: ClosingCycleConfig;
}

type NoParams = Record<string, never>;

/**
 * One unmet condition: `key` is the message key (messages/*.json), `params` its ICU arguments, so
 * the UI renders e.g. "Brakuje: potwierdzenia Wartości firmy, sumy wag 100% – obecnie 80%".
 */
export type MissingCondition =
  | { condition: "WF-C1"; key: "workflow.conditions.leadershipAcknowledged"; params: NoParams }
  | { condition: "WF-C2"; key: "workflow.conditions.valuesAcknowledged"; params: NoParams }
  | { condition: "WF-C3"; key: "workflow.conditions.safetyCommitment"; params: NoParams }
  | { condition: "WF-C4"; key: "workflow.conditions.minPerformanceGoals"; params: { min: number; current: number } }
  | { condition: "WF-C4"; key: "workflow.conditions.weightSum"; params: { required: number; current: number } }
  | { condition: "WF-C5"; key: "workflow.conditions.minDevelopmentGoals"; params: { min: number; current: number } };

export type MissingConditionKey = MissingCondition["key"];

export interface ClosingConditionsResult {
  /** True when nothing is missing: the document may be sent. */
  ok: boolean;
  /** Every unmet condition, in slide order. */
  missing: MissingCondition[];
}

/** Everything checkClosingConditions can report: three Group goal checks, two for Part 2, one for Part 3. */
export const CLOSING_CONDITION_COUNT = 6;

const THRESHOLDS = ["minPerformanceGoals", "requiredWeightSum", "minDevelopmentGoals"] as const;

/**
 * A cycle row is data from the database; a negative or fractional threshold is a configuration
 * error and must fail loudly rather than let incomplete documents through. The database refuses
 * negative values too (CHECK cycle_closing_thresholds_non_negative), so this is a second guard.
 */
function assertCycleConfig(cycle: ClosingCycleConfig): void {
  // Named fields only: a full cycle row may be passed and carries other columns.
  for (const name of THRESHOLDS) {
    const value = cycle[name];
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`Closing conditions: cycle.${name} must be a non-negative integer, got ${String(value)}`);
    }
  }
}

/**
 * A type with no HR template cannot be confirmed, so it counts as missing: sending a document
 * whose Group goals were never configured would skip WF-C1..C3 silently.
 */
function isGroupTypeDone(document: ClosingDocument, type: ClosingGroupGoalType): boolean {
  const goals = document.groupGoals.filter((goal) => goal.type === type);
  if (goals.length === 0) return false;
  return type === "BHP"
    ? goals.every((goal) => goal.isAcknowledged && (goal.commitment?.trim() ?? "") !== "")
    : goals.every((goal) => goal.isAcknowledged);
}

/** WF-C1..C5 for one document. Drafts and cancelled goals neither count nor add weight. */
export function checkClosingConditions(document: ClosingDocument): ClosingConditionsResult {
  assertCycleConfig(document.cycle);
  const { minPerformanceGoals, requiredWeightSum, minDevelopmentGoals } = document.cycle;
  const missing: MissingCondition[] = [];

  if (!isGroupTypeDone(document, "PRZYWODZTWO")) {
    missing.push({ condition: "WF-C1", key: "workflow.conditions.leadershipAcknowledged", params: {} });
  }
  if (!isGroupTypeDone(document, "WARTOSCI")) {
    missing.push({ condition: "WF-C2", key: "workflow.conditions.valuesAcknowledged", params: {} });
  }
  if (!isGroupTypeDone(document, "BHP")) {
    missing.push({ condition: "WF-C3", key: "workflow.conditions.safetyCommitment", params: {} });
  }

  const performanceInPlan = document.performanceGoals.filter((goal) => goal.state === "W_PLANIE");
  if (performanceInPlan.length < minPerformanceGoals) {
    missing.push({
      condition: "WF-C4",
      key: "workflow.conditions.minPerformanceGoals",
      params: { min: minPerformanceGoals, current: performanceInPlan.length },
    });
  }
  // Reported whenever it is off, also with no goal in the plan ("obecnie 0%"), so the owner always
  // sees the current sum next to the button.
  const weightSum = performanceInPlan.reduce((sum, goal) => sum + (goal.weight ?? 0), 0);
  if (weightSum !== requiredWeightSum) {
    missing.push({
      condition: "WF-C4",
      key: "workflow.conditions.weightSum",
      params: { required: requiredWeightSum, current: weightSum },
    });
  }

  const developmentInPlan = document.developmentGoals.filter((goal) => goal.state === "W_PLANIE").length;
  if (developmentInPlan < minDevelopmentGoals) {
    missing.push({
      condition: "WF-C5",
      key: "workflow.conditions.minDevelopmentGoals",
      params: { min: minDevelopmentGoals, current: developmentInPlan },
    });
  }

  return { ok: missing.length === 0, missing };
}

export interface ClosingProgress {
  met: number;
  total: number;
}

/** WF-21 "% complete" in the team view: how many of the checks a document already meets. */
export function closingProgress(document: ClosingDocument): ClosingProgress {
  const { missing } = checkClosingConditions(document);
  return { met: CLOSING_CONDITION_COUNT - missing.length, total: CLOSING_CONDITION_COUNT };
}
