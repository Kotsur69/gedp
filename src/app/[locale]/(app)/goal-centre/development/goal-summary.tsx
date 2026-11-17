"use client";

import { useTranslations } from "next-intl";
import { CheckIcon } from "@/components/shell/icons";
import type { Locale } from "@/i18n/config";
import { displayPeriod, PROGRESS_LABEL_KEY, type DevelopmentGoalItem } from "./goal-format";

// Read-only pieces of a Part 3 goal: the summary in the goal window (IMG17 "Step 3 - Summary"
// layout: focus area and competency, the action, period and progress) and the state badges.

type SummaryProps = { goal: DevelopmentGoalItem; competency: string | null; area: string | null; locale: Locale };

export function GoalSummary({ goal, competency, area, locale }: SummaryProps) {
  const t = useTranslations("developmentGoals");
  const tGlossary = useTranslations("glossary");
  const descriptionTone = goal.actionDescription ? "" : "text-ink-soft italic";
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <SummaryItem label={t("fields.developmentArea")} value={area} />
        <SummaryItem label={t("fields.competency")} value={competency} />
      </dl>
      <section aria-labelledby="development-goal-action" className="rounded-2xl border border-line-strong px-5 py-4">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">{t("fields.actionTitle")}</p>
        <h3 id="development-goal-action" className="mt-1 text-lg leading-snug font-semibold text-ink">
          {goal.actionTitle}
        </h3>
        <p className={`mt-2 leading-relaxed whitespace-pre-line ${descriptionTone}`}>
          {goal.actionDescription ?? t("notFilled")}
        </p>
      </section>
      <dl className="grid gap-4 rounded-2xl bg-canvas px-5 py-4 sm:grid-cols-2">
        <SummaryItem label={t("fields.period")} value={displayPeriod(goal, locale)} isNumeric />
        <SummaryItem
          label={t("fields.progress")}
          value={tGlossary(`goalProgress.${PROGRESS_LABEL_KEY[goal.progress]}`)}
        />
      </dl>
    </div>
  );
}

type SummaryItemProps = { label: string; value: string | null; isNumeric?: boolean };

function SummaryItem({ label, value, isNumeric = false }: SummaryItemProps) {
  const t = useTranslations("developmentGoals");
  const tone = value ? "text-ink" : "text-ink-soft italic";
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wider text-ink-soft uppercase">{label}</dt>
      <dd className={`mt-1 ${tone} ${isNumeric ? "tabular-nums" : ""}`}>{value ?? t("notFilled")}</dd>
    </div>
  );
}

const STATE_TONES = {
  SZKIC: "bg-notice-surface text-notice",
  W_PLANIE: "bg-accent/10 text-accent",
  ANULOWANY: "bg-line text-ink-soft",
} as const;

/** Goal state and the N+1 marker, shown on the card and in the window header. */
export function StateBadges({ goal }: { goal: Pick<DevelopmentGoalItem, "state" | "changedByManager"> }) {
  const tGlossary = useTranslations("glossary");
  return (
    <span className="mt-2 flex flex-wrap gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_TONES[goal.state]}`}
      >
        {goal.state === "W_PLANIE" && <CheckIcon className="size-3.5" />}
        {tGlossary(`goalState.${goal.state}`)}
      </span>
      {goal.changedByManager && (
        <span className="inline-flex items-center rounded-full bg-notice-surface px-2.5 py-1 text-xs font-semibold text-notice">
          {tGlossary("changedByManager")}
        </span>
      )}
    </span>
  );
}
