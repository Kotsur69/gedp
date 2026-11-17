import type {
  CatalogOption,
  DevelopmentGoalData,
  DevelopmentGoalState,
  GoalProgress,
} from "@/domain/development-goal";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";

// Client-safe helpers shared by the Part 3 cards, detail and form.

/** One goal as the client renders it (DevelopmentGoalView without the document id). */
export type DevelopmentGoalItem = DevelopmentGoalData & {
  id: number;
  state: DevelopmentGoalState;
  changedByManager: boolean;
};

/** glossary.goalProgress keys for the stored progress values. */
export const PROGRESS_LABEL_KEY: Readonly<Record<GoalProgress, "TO_START" | "ONGOING" | "COMPLETED">> = {
  DO_ROZPOCZECIA: "TO_START",
  W_TRAKCIE: "ONGOING",
  UKONCZONY: "COMPLETED",
};

/** Fill of the card's progress bar (the bar is decorative; the text label carries the value). */
export const PROGRESS_FILL_PERCENT: Readonly<Record<GoalProgress, number>> = {
  DO_ROZPOCZECIA: 0,
  W_TRAKCIE: 50,
  UKONCZONY: 100,
};

export function catalogName(options: readonly CatalogOption[], id: number | null, locale: Locale): string | null {
  const option = id === null ? undefined : options.find((candidate) => candidate.id === id);
  if (!option) return null;
  return locale === "en" ? option.nameEn : option.namePl;
}

/** "2027-01-02" -> "02.01.2027" / "2 Jan 2027" (NFR-06). Noon UTC is the same day in company time. */
export function displayDate(isoDate: string, locale: Locale): string {
  return formatDate(new Date(`${isoDate}T12:00:00.000Z`), locale);
}

/** "02.01.2027 – 31.12.2027"; a missing end shows as "…". Null when no date is set. */
export function displayPeriod(goal: Pick<DevelopmentGoalData, "startDate" | "endDate">, locale: Locale): string | null {
  if (goal.startDate === null && goal.endDate === null) return null;
  const start = goal.startDate ? displayDate(goal.startDate, locale) : "…";
  const end = goal.endDate ? displayDate(goal.endDate, locale) : "…";
  return `${start} – ${end}`;
}
