import { z } from "zod";

// GEDP document workflow (WF-01..03, WF-05, WF-06): the ONE place that says which status changes
// exist, who may make them and what each status still lets the owner edit. Pure and client-safe:
// the server (src/server/workflow.ts) enforces it, the UI only mirrors it.
//
//   SZKIC ──(owner: SEND)──> DO_WALIDACJI ──(validator: APPROVE)──> ZATWIERDZONY
//   ZWROCONY ──(owner: SEND)──┘     └──(validator: RETURN + comment)──> ZWROCONY
//
// [ZAŁ] One-step N+1 validation until Q-02 answers. A second step (e.g. N+2) is one more status
// plus rows in TRANSITIONS; nothing else in this file has to change.
// [ZAŁ] Q-13: after approval only goal progress may change, no new goals.

/** Mirrors the Prisma enum DocumentStatus (kept literal so client bundles never import Prisma). */
export const DOCUMENT_STATUSES = ["SZKIC", "DO_WALIDACJI", "ZWROCONY", "ZATWIERDZONY"] as const;
export type DocumentStatusValue = (typeof DOCUMENT_STATUSES)[number];

/** Narrows text read from the database (e.g. `status::text` in a raw query). */
export function isDocumentStatus(value: string): value is DocumentStatusValue {
  return (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

export const WORKFLOW_ACTIONS = ["SEND", "APPROVE", "RETURN"] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/** OWNER = the employee whose document it is; VALIDATOR = N+1 or the HR-set override (canValidate). */
export type WorkflowActor = "OWNER" | "VALIDATOR";

export interface Transition {
  readonly action: WorkflowAction;
  readonly from: DocumentStatusValue;
  readonly to: DocumentStatusValue;
  readonly actor: WorkflowActor;
  /** WF-03: a return must say why. */
  readonly isCommentRequired: boolean;
  /** WF-C1..C5 must all pass, re-checked on the server inside the transaction. */
  readonly requiresClosingConditions: boolean;
}

export const TRANSITIONS: readonly Transition[] = Object.freeze([
  { action: "SEND", from: "SZKIC", to: "DO_WALIDACJI", actor: "OWNER", isCommentRequired: false, requiresClosingConditions: true },
  { action: "SEND", from: "ZWROCONY", to: "DO_WALIDACJI", actor: "OWNER", isCommentRequired: false, requiresClosingConditions: true },
  { action: "APPROVE", from: "DO_WALIDACJI", to: "ZATWIERDZONY", actor: "VALIDATOR", isCommentRequired: false, requiresClosingConditions: false },
  { action: "RETURN", from: "DO_WALIDACJI", to: "ZWROCONY", actor: "VALIDATOR", isCommentRequired: true, requiresClosingConditions: false },
]);

/** The transition `action` triggers from `from`, or null when it is not allowed from there. */
export function findTransition(action: WorkflowAction, from: DocumentStatusValue): Transition | null {
  return TRANSITIONS.find((t) => t.action === action && t.from === from) ?? null;
}

export function isCommentRequired(action: WorkflowAction): boolean {
  return TRANSITIONS.some((t) => t.action === action && t.isCommentRequired);
}

export interface WorkflowRoles {
  isOwner: boolean;
  isValidator: boolean;
}

/** Actions the viewer could take on a document in `status` (buttons). The server re-checks all. */
export function availableActions(status: DocumentStatusValue, roles: WorkflowRoles): WorkflowAction[] {
  return TRANSITIONS.filter(
    (t) => t.from === status && (t.actor === "OWNER" ? roles.isOwner : roles.isValidator),
  ).map((t) => t.action);
}

// ---------------------------------------------------------------------------
// Edit locks (WF-02, WF-05)
// ---------------------------------------------------------------------------

/** FULL: goals can be added and changed. PROGRESS_ONLY: only a goal's progress. NONE: view only. */
export type GoalEditScope = "FULL" | "PROGRESS_ONLY" | "NONE";

const EDIT_SCOPE: Readonly<Record<DocumentStatusValue, GoalEditScope>> = {
  SZKIC: "FULL",
  // [ZAŁ] A returned document counts as not sent: the owner corrects it.
  ZWROCONY: "FULL",
  DO_WALIDACJI: "NONE",
  ZATWIERDZONY: "PROGRESS_ONLY",
};

/** What the owner may edit; anything but an open cycle is view only. */
export function goalEditScope(status: DocumentStatusValue, isCycleOpen: boolean): GoalEditScope {
  return isCycleOpen ? EDIT_SCOPE[status] : "NONE";
}

/** Statuses in which the owner may still add and change goals. */
export const EDITABLE_DOCUMENT_STATUSES: readonly DocumentStatusValue[] = Object.freeze(
  DOCUMENT_STATUSES.filter((status) => EDIT_SCOPE[status] === "FULL"),
);

// ---------------------------------------------------------------------------
// Comment (WF-03, WF-06)
// ---------------------------------------------------------------------------

export const WORKFLOW_COMMENT_MAX_LENGTH = 2000;

/** Trimmed; blank or missing becomes null. NUL is refused (Postgres text cannot store it). */
export const workflowCommentSchema = z
  .string()
  .trim()
  .max(WORKFLOW_COMMENT_MAX_LENGTH, "COMMENT_TOO_LONG")
  .refine((value) => !value.includes("\u0000"), "INVALID_INPUT")
  .nullish()
  .transform((value) => (value ? value : null));

// ---------------------------------------------------------------------------
// Closing conditions (WF-C1..C5, slide 5)
// ---------------------------------------------------------------------------

export type ClosingGroupGoalType = "PRZYWODZTWO" | "WARTOSCI" | "BHP";
export type ClosingGoalState = "SZKIC" | "W_PLANIE" | "ANULOWANY";

export interface ClosingInput {
  /** One entry per HR template of the cycle. */
  groupGoals: readonly { type: ClosingGroupGoalType; isAcknowledged: boolean; commitment: string | null }[];
  performanceGoals: readonly { state: ClosingGoalState; weight: number | null }[];
  developmentGoals: readonly { state: ClosingGoalState }[];
  /** Per-cycle rules (Q-03 open, so HR can change them). */
  rules: { minPerformanceGoals: number; requiredWeightSum: number; minDevelopmentGoals: number };
}

/** Codes match the `workflow.conditions.*` message keys. */
export type MissingCondition =
  | { code: "leadershipAcknowledged" }
  | { code: "valuesAcknowledged" }
  | { code: "safetyCommitment" }
  | { code: "minPerformanceGoals"; min: number; current: number }
  | { code: "weightSum"; required: number; current: number }
  | { code: "minDevelopmentGoals"; min: number; current: number };

/**
 * A type with no HR template cannot be confirmed, so it counts as missing: sending a document
 * whose Group goals were never configured would skip WF-C1..C3 silently.
 */
function isGroupTypeDone(input: ClosingInput, type: ClosingGroupGoalType): boolean {
  const goals = input.groupGoals.filter((goal) => goal.type === type);
  if (goals.length === 0) return false;
  return type === "BHP"
    ? goals.every((goal) => goal.isAcknowledged && (goal.commitment?.trim() ?? "") !== "")
    : goals.every((goal) => goal.isAcknowledged);
}

/** Every unmet condition, in slide order. Empty = the document may be sent. */
export function missingClosingConditions(input: ClosingInput): MissingCondition[] {
  const missing: MissingCondition[] = [];
  if (!isGroupTypeDone(input, "PRZYWODZTWO")) missing.push({ code: "leadershipAcknowledged" });
  if (!isGroupTypeDone(input, "WARTOSCI")) missing.push({ code: "valuesAcknowledged" });
  if (!isGroupTypeDone(input, "BHP")) missing.push({ code: "safetyCommitment" });

  const { minPerformanceGoals, requiredWeightSum, minDevelopmentGoals } = input.rules;
  const performanceInPlan = input.performanceGoals.filter((goal) => goal.state === "W_PLANIE");
  if (performanceInPlan.length < minPerformanceGoals) {
    missing.push({ code: "minPerformanceGoals", min: minPerformanceGoals, current: performanceInPlan.length });
  }
  const weightSum = performanceInPlan.reduce((sum, goal) => sum + (goal.weight ?? 0), 0);
  // With no goal in the plan the weight is implied by the missing goals; one message is enough.
  if (performanceInPlan.length > 0 && weightSum !== requiredWeightSum) {
    missing.push({ code: "weightSum", required: requiredWeightSum, current: weightSum });
  }
  const developmentInPlan = input.developmentGoals.filter((goal) => goal.state === "W_PLANIE").length;
  if (developmentInPlan < minDevelopmentGoals) {
    missing.push({ code: "minDevelopmentGoals", min: minDevelopmentGoals, current: developmentInPlan });
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Completion (WF-21: "% complete" in the team view)
// ---------------------------------------------------------------------------

/** WF-C1..C5 as six checks: three Group goal types, min performance goals, weight sum, min development goals. */
export const CLOSING_CONDITION_COUNT = 6;

export interface ClosingProgress {
  met: number;
  total: number;
}

/** How many closing conditions a document already meets. */
export function closingProgress(input: ClosingInput): ClosingProgress {
  const missing = missingClosingConditions(input).length;
  // missingClosingConditions folds the weight sum into "no goal in the plan" (one message is
  // enough for the owner); for a completion count the weight sum is still unmet then.
  const hasPerformanceInPlan = input.performanceGoals.some((goal) => goal.state === "W_PLANIE");
  const isWeightFolded = !hasPerformanceInPlan && input.rules.requiredWeightSum !== 0;
  const unmet = missing + (isWeightFolded ? 1 : 0);
  return { met: CLOSING_CONDITION_COUNT - unmet, total: CLOSING_CONDITION_COUNT };
}
