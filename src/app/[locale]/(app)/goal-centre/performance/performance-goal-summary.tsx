"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TargetTypeIcon } from "@/components/goals/target-type-icon";
import type { PerformanceGoalContext } from "@/domain/performance-goal";
import type { Locale } from "@/i18n/config";
import {
  displayDate,
  displayTarget,
  findTargetType,
  isNamedTargetType,
  isUnitCode,
  PROGRESS_LABEL_KEY,
  type PerformanceGoalItem,
} from "./goal-format";

// Read-only view of a Part 2 goal in the goal window: everything the card cuts short (G2-27).

type SummaryProps = { goal: PerformanceGoalItem; context: PerformanceGoalContext };

export function PerformanceGoalSummary({ goal, context }: SummaryProps) {
  const t = useTranslations("performanceGoals");
  const tGlossary = useTranslations("glossary");
  const locale = useLocale() as Locale;
  const code = goal.targetTypeCode;
  const isNumeric = findTargetType(context.targetTypes, goal.targetTypeId)?.isNumeric ?? false;
  const unit = isUnitCode(code) ? ` ${t(`targetUnits.${code}`)}` : "";
  const typeLabel = isNamedTargetType(code) ? tGlossary(`targetTypes.${code}`) : code;

  return (
    <div className="flex flex-col gap-6">
      <TextBlock label={t("fields.description")} value={goal.description} />
      <TextBlock label={t("fields.measures")} value={goal.measures} />
      <dl className="grid gap-4 rounded-2xl bg-canvas px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <Item label={t("fields.targetType")}>
          {code && (
            <span className="inline-flex items-center gap-2">
              <TargetTypeIcon code={code} className="size-5 text-accent" />
              {typeLabel}
            </span>
          )}
        </Item>
        <Item label={t("fields.target")}>{goal.target && `${displayTarget(goal.target, isNumeric, locale)}${unit}`}</Item>
        <Item label={t("fields.dueDate")} isNumeric>
          {goal.dueDate && displayDate(goal.dueDate, locale)}
        </Item>
        <Item label={t("fields.progress")}>{tGlossary(`goalProgress.${PROGRESS_LABEL_KEY[goal.progress]}`)}</Item>
        <Item label={t("fields.weight")} isNumeric>
          {goal.weight !== null && `${goal.weight}%`}
        </Item>
      </dl>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations("performanceGoals");
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wider text-accent uppercase">{label}</h3>
      <p className={`mt-1.5 leading-relaxed whitespace-pre-line ${value ? "text-ink" : "text-ink-soft italic"}`}>
        {value ?? t("notFilled")}
      </p>
    </section>
  );
}

type ItemProps = { label: string; isNumeric?: boolean; children: ReactNode };

function Item({ label, isNumeric = false, children }: ItemProps) {
  const t = useTranslations("performanceGoals");
  const isEmpty = children === null || children === undefined || children === false || children === "";
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wider text-ink-soft uppercase">{label}</dt>
      <dd className={`mt-1 break-words ${isEmpty ? "text-ink-soft italic" : "text-ink"} ${isNumeric ? "tabular-nums" : ""}`}>
        {isEmpty ? t("notFilled") : children}
      </dd>
    </div>
  );
}
