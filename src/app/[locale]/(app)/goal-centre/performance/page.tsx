import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import { performanceGoalCounters, type PerformanceGoalCounters } from "@/domain/performance-goal";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import { wasDocumentSent } from "@/server/goal-document";
import { ensureOwnDocument } from "@/server/group-goals";
import { countCopyableGoals } from "@/server/performance-goal-copy";
import { loadGoalFormContext, loadPerformanceGoals, type PerformanceGoalView } from "@/server/performance-goals";
import { CounterRings, Notice, Panel, SectionChips, type CounterItem } from "../goal-centre-ui";
import type { PerformanceGoalItem } from "./goal-format";
import { PerformanceGoalList } from "./performance-goal-list";

// Goal Centre, Part 2: performance goals (G2-01..09, G2-20..22, G2-27) for the cycle year picked
// in the header.

type ProgressLabels = Record<"toStart" | "ongoing" | "completed", string>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("header.screen", { app: t("common.appName"), screen: t("performanceGoals.sectionTitle") }),
  };
}

export default async function PerformanceGoalsPage() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <PerformanceGoals />
    </Suspense>
  );
}

async function PerformanceGoals() {
  const [viewer, selected, t] = await Promise.all([requireEmployee(), getSelectedCycle(), getTranslations()]);
  const cycle = selected
    ? await db().cycle.findUnique({ where: { year: selected.year }, select: { id: true, year: true, status: true } })
    : null;
  if (!cycle) {
    return (
      <Panel labelledBy="performance-goals-title">
        <BackLink label={t("goalCentre.backToGoalCentre")} />
        <h1 id="performance-goals-title" className="mt-4 text-3xl font-semibold text-ink">
          {t("performanceGoals.sectionTitle")}
        </h1>
        <p className="mt-3 text-ink-soft">{t("goalCentre.noCycle")}</p>
      </Panel>
    );
  }

  const document = await ensureOwnDocument(db(), viewer, cycle);
  const [part2, wasSent, copyable] = await Promise.all([
    document ? loadPerformanceGoals(db(), viewer, document.id, cycle.status) : null,
    document ? wasDocumentSent(db(), document.id) : false,
    countCopyableGoals(db(), viewer, cycle.year),
  ]);
  const goals = part2?.goals ?? [];
  // Types the goals already use stay selectable even if HR has deactivated them.
  const usedTypeIds = goals.flatMap((goal) => (goal.targetTypeId === null ? [] : [goal.targetTypeId]));
  const context = await loadGoalFormContext(db(), cycle.year, usedTypeIds);
  const counters = part2?.counters ?? performanceGoalCounters([]);
  const isReadOnly = cycle.status !== "OTWARTY";
  const isSent = part2 !== null && !isReadOnly && !part2.canChange;

  // The client part gets only the messages it renders.
  const { performanceGoals, goalControls, goalCentre, glossary, common } = await getMessages();
  const clientMessages = { performanceGoals, goalControls, goalCentre, glossary, common };

  return (
    <Panel labelledBy="performance-goals-title">
      <BackLink label={t("goalCentre.backToGoalCentre")} />
      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">
            {t("glossary.part", { number: 2 })} · {t("glossary.cycleYear", { year: cycle.year })}
          </p>
          <h1 id="performance-goals-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
            {t("performanceGoals.sectionTitle")}
          </h1>
          <SectionChips
            label={t("goalCentre.sectionCounters")}
            chips={[
              { key: "notInPlan", text: t("goalCentre.counters.notInPlan", { count: counters.notInPlan }) },
              { key: "addedToPlan", text: t("goalCentre.counters.addedToPlan", { count: counters.inPlan }) },
              {
                key: "changedByManager",
                text: t("goalCentre.counters.changedByManager", { count: counters.changedByManager }),
              },
              { key: "cancelled", text: t("goalCentre.counters.cancelled", { count: counters.cancelled }), hasCheck: false },
              {
                key: "totalWeight",
                text: t("goalCentre.counters.totalWeight", { weight: counters.totalWeightInPlan }),
                hasCheck: false,
              },
            ]}
          />
        </div>
        <CounterRings
          label={t("goalCentre.progressCounters")}
          items={progressItems(counters, {
            toStart: t("goalCentre.progressTotals.toStart"),
            ongoing: t("goalCentre.progressTotals.ongoing"),
            completed: t("goalCentre.progressTotals.completed"),
          })}
        />
      </div>

      {/* G2-03: draft wording of the eGEDP section text; the final PL/EN text waits for HR approval. */}
      <div className="mt-6 max-w-3xl space-y-3 leading-relaxed text-ink-soft">
        <p>{t("performanceGoals.intro.purpose")}</p>
        <p>{t("performanceGoals.intro.instructions")}</p>
        <p>
          {t.rich("performanceGoals.intro.resources", {
            link: (chunks) => (
              <Link
                href="/help"
                className="font-semibold text-accent underline underline-offset-4 hover:no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>

      {isReadOnly && <Notice>{t("goalCentre.viewOnlyNotice")}</Notice>}
      {isSent && <Notice>{t("performanceGoals.documentSent")}</Notice>}
      {part2?.canChange && wasSent && <Notice>{t("performanceGoals.sentNotice")}</Notice>}

      <div className="mt-8">
        <NextIntlClientProvider messages={clientMessages}>
          <PerformanceGoalList
            goals={goals.map(toItem)}
            context={context}
            documentId={part2?.documentId ?? null}
            canChange={part2?.canChange ?? false}
            wasSent={wasSent}
            copyable={copyable}
          />
        </NextIntlClientProvider>
      </div>
    </Panel>
  );
}

/** G2-05 progress counters; [ZAŁ] eGEDP's orange / yellow / green mapped onto the brand palette. */
function progressItems(counters: PerformanceGoalCounters, label: ProgressLabels): CounterItem[] {
  return [
    { key: "toStart", label: label.toStart, value: counters.progress.DO_ROZPOCZECIA, tone: "border-brand-orange/70" },
    { key: "ongoing", label: label.ongoing, value: counters.progress.W_TRAKCIE, tone: "border-brand-magenta/60" },
    { key: "completed", label: label.completed, value: counters.progress.UKONCZONY, tone: "border-accent" },
  ];
}

/** The client never needs the document id of a goal: the list gets it once. */
function toItem(goal: PerformanceGoalView): PerformanceGoalItem {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    measures: goal.measures,
    dueDate: goal.dueDate,
    progress: goal.progress,
    targetTypeId: goal.targetTypeId,
    targetTypeCode: goal.targetTypeCode,
    target: goal.target,
    weight: goal.weight,
    state: goal.state,
    changedByManager: goal.changedByManager,
  };
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/goal-centre"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-sm font-semibold text-ink-soft transition-colors duration-200 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
    >
      <ChevronLeftIcon className="size-4" />
      {label}
    </Link>
  );
}
