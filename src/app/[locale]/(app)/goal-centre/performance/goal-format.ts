import type {
  PerformanceGoalData,
  PerformanceGoalState,
  TargetTypeOption,
} from "@/domain/performance-goal";
import type { Locale } from "@/i18n/config";

// Client-safe helpers shared by the Part 2 cards, goal summary and form. The progress label keys,
// bar fill and date display are the same as in Part 3, so they are re-used from there.
export { displayDate, PROGRESS_FILL_PERCENT, PROGRESS_LABEL_KEY } from "../development/goal-format";

/** One goal as the client renders it (PerformanceGoalView without the document id). */
export type PerformanceGoalItem = PerformanceGoalData & {
  id: number;
  state: PerformanceGoalState;
  changedByManager: boolean;
  targetTypeCode: string | null;
};

/** Target types with a glossary label (glossary.targetTypes); a type HR adds later shows its code. */
export const NAMED_TARGET_TYPE_CODES = ["LICZBA", "TEKST", "PROCENT", "TONY", "EURO", "USD"] as const;
export type NamedTargetTypeCode = (typeof NAMED_TARGET_TYPE_CODES)[number];
export const isNamedTargetType = (code: string | null): code is NamedTargetTypeCode =>
  code !== null && (NAMED_TARGET_TYPE_CODES as readonly string[]).includes(code);

/** Units shown after a numeric target (messages: performanceGoals.targetUnits). */
export const TARGET_UNIT_CODES = ["PROCENT", "TONY", "EURO", "USD"] as const;
export type TargetUnitCode = (typeof TARGET_UNIT_CODES)[number];
export const isUnitCode = (code: string | null): code is TargetUnitCode =>
  code !== null && (TARGET_UNIT_CODES as readonly string[]).includes(code);

export function findTargetType(
  types: readonly TargetTypeOption[],
  id: number | null,
): TargetTypeOption | undefined {
  return id === null ? undefined : types.find((type) => type.id === id);
}

/** "12.5" -> "12,5" in Polish; free text ("Tekst") is shown as typed. */
export function displayTarget(target: string, isNumeric: boolean, locale: Locale): string {
  return isNumeric && locale === "pl" ? target.replace(".", ",") : target;
}
