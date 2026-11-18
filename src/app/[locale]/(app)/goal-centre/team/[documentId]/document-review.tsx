import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { DevelopmentGoalContext } from "@/domain/development-goal";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { DevelopmentGoalView } from "@/server/development-goals";
import type { GroupGoalView } from "@/server/group-goals";
import type { PerformanceGoalView } from "@/server/performance-goals";
import { catalogName, displayDate, PROGRESS_LABEL_KEY } from "../../development/goal-format";
import { Panel } from "../../goal-centre-ui";
import { isUnitCode } from "../../performance/goal-format";

// Read-only summary of the three parts for the validator (WF-03, WF-22). Server-rendered, no
// handlers: the validator decides in the status panel; goal changes by N+1 (WF-04) come later.

const ROW = "rounded-2xl border border-line bg-surface p-4 sm:p-5";

function Facts({ children }: { children: ReactNode }) {
  return <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-4">{children}</dl>;
}

function Fact({ label, isWide = false, children }: { label: string; isWide?: boolean; children: ReactNode }) {
  return (
    <div className={`flex gap-1.5 ${isWide ? "sm:col-span-2" : ""}`}>
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function StateChip({ text, isMuted }: { text: string; isMuted: boolean }) {
  const tone = isMuted ? "border-line text-ink-soft" : "border-accent/50 text-accent";
  return <span className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>;
}

export async function GroupGoalsReview({ goals, locale }: { goals: readonly GroupGoalView[]; locale: Locale }) {
  const t = await getTranslations();
  return (
    <Panel labelledBy="review-part1">
      <h2 id="review-part1" className="text-2xl font-semibold text-ink">
        {t("groupGoals.sectionTitle")}
      </h2>
      {goals.length === 0 ? (
        <p className="mt-3 text-ink-soft">{t("team.noGoals")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {goals.map((goal) => (
            <li key={goal.templateId} className={ROW}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-ink">{t(`glossary.groupGoalTypes.${goal.type}`)}</h3>
                <StateChip
                  isMuted={goal.acknowledgedAt === null}
                  text={
                    goal.acknowledgedAt
                      ? t("team.acknowledgedOn", { date: formatDate(goal.acknowledgedAt, locale) })
                      : t("team.notAcknowledged")
                  }
                />
              </div>
              {goal.commitment && (
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">
                  {t("team.commitment", { text: goal.commitment })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

type PerformanceProps = { goals: readonly PerformanceGoalView[]; totalWeight: number; locale: Locale };

export async function PerformanceGoalsReview({ goals, totalWeight, locale }: PerformanceProps) {
  const t = await getTranslations();
  const notSet = t("performanceGoals.notSet");
  return (
    <Panel labelledBy="review-part2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="review-part2" className="text-2xl font-semibold text-ink">
          {t("performanceGoals.sectionTitle")}
        </h2>
        <p className="text-sm font-semibold text-ink tabular-nums">
          {t("goalCentre.counters.totalWeight", { weight: totalWeight })}
        </p>
      </div>
      {goals.length === 0 ? (
        <p className="mt-3 text-ink-soft">{t("team.noGoals")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {goals.map((goal) => {
            const code = goal.targetTypeCode;
            const unit = isUnitCode(code) ? ` ${t(`performanceGoals.targetUnits.${code}`)}` : "";
            return (
              <li key={goal.id} className={`${ROW} ${goal.state === "ANULOWANY" ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 font-semibold break-words text-ink">{goal.title}</h3>
                  <StateChip isMuted={goal.state !== "W_PLANIE"} text={t(`glossary.goalState.${goal.state}`)} />
                </div>
                {goal.description && (
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed whitespace-pre-line text-ink-soft">
                    {goal.description}
                  </p>
                )}
                <Facts>
                  <Fact label={t("performanceGoals.card.target")}>{goal.target ? `${goal.target}${unit}` : notSet}</Fact>
                  <Fact label={t("performanceGoals.card.dueDate")}>
                    <span className="tabular-nums">{goal.dueDate ? displayDate(goal.dueDate, locale) : notSet}</span>
                  </Fact>
                  <Fact label={t("performanceGoals.card.weight")}>
                    <span className="font-semibold tabular-nums">{goal.weight === null ? notSet : `${goal.weight}%`}</span>
                  </Fact>
                  <Fact label={`${t("goalCentre.progressLabel")}:`}>
                    {t(`glossary.goalProgress.${PROGRESS_LABEL_KEY[goal.progress]}`)}
                  </Fact>
                </Facts>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

type DevelopmentProps = { goals: readonly DevelopmentGoalView[]; context: DevelopmentGoalContext; locale: Locale };

export async function DevelopmentGoalsReview({ goals, context, locale }: DevelopmentProps) {
  const t = await getTranslations();
  const notSet = t("performanceGoals.notSet");
  return (
    <Panel labelledBy="review-part3">
      <h2 id="review-part3" className="text-2xl font-semibold text-ink">
        {t("developmentGoals.sectionTitle")}
      </h2>
      {goals.length === 0 ? (
        <p className="mt-3 text-ink-soft">{t("team.noGoals")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {goals.map((goal) => {
            const competency =
              catalogName(context.competencies, goal.competencyId, locale) ?? t("developmentGoals.noCompetency");
            const area = catalogName(context.developmentAreas, goal.developmentAreaId, locale) ?? t("developmentGoals.noArea");
            const start = goal.startDate ? displayDate(goal.startDate, locale) : notSet;
            const end = goal.endDate ? displayDate(goal.endDate, locale) : notSet;
            return (
              <li key={goal.id} className={`${ROW} ${goal.state === "ANULOWANY" ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 font-semibold break-words text-ink">{competency}</h3>
                  <StateChip isMuted={goal.state !== "W_PLANIE"} text={t(`glossary.goalState.${goal.state}`)} />
                </div>
                <p className="mt-1 text-sm text-ink-soft">{area}</p>
                <Facts>
                  <Fact label={`${t("developmentGoals.fields.actionTitle")}:`} isWide>
                    {goal.actionTitle}
                  </Fact>
                  <Fact label={`${t("developmentGoals.fields.period")}:`}>
                    <span className="tabular-nums">{t("team.dates", { start, end })}</span>
                  </Fact>
                  <Fact label={`${t("goalCentre.progressLabel")}:`}>
                    {t(`glossary.goalProgress.${PROGRESS_LABEL_KEY[goal.progress]}`)}
                  </Fact>
                </Facts>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
