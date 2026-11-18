import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import { developmentGoalCounters, type DevelopmentGoalCounters } from "@/domain/development-goal";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import { loadDevelopmentGoalContext, loadDevelopmentGoals, type DevelopmentGoalView } from "@/server/development-goals";
import { ensureOwnDocument } from "@/server/group-goals";
import { CounterRings, Notice, Panel, SectionChips, type CounterItem } from "../goal-centre-ui";
import { DevelopmentGoalList } from "./development-goal-list";
import type { DevelopmentGoalItem } from "./goal-format";

// Goal Centre, Part 3: development goals (G3-01..05, G3-20, G3-21) for the cycle year picked in the
// header. Only the fields common to both candidate models are built until HR answers Q-04.

type ProgressLabels = Record<"toStart" | "ongoing" | "completed" | "cancelled", string>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("header.screen", { app: t("common.appName"), screen: t("developmentGoals.sectionTitle") }),
  };
}

export default async function DevelopmentGoalsPage() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <DevelopmentGoals />
    </Suspense>
  );
}

async function DevelopmentGoals() {
  const [viewer, selected, t] = await Promise.all([requireEmployee(), getSelectedCycle(), getTranslations()]);
  const cycle = selected
    ? await db().cycle.findUnique({ where: { year: selected.year }, select: { id: true, year: true, status: true } })
    : null;
  if (!cycle) {
    return (
      <Panel labelledBy="development-goals-title">
        <BackLink label={t("goalCentre.backToGoalCentre")} />
        <h1 id="development-goals-title" className="mt-4 text-3xl font-semibold text-ink">
          {t("developmentGoals.sectionTitle")}
        </h1>
        <p className="mt-3 text-ink-soft">{t("goalCentre.noCycle")}</p>
      </Panel>
    );
  }

  const document = await ensureOwnDocument(db(), viewer, cycle);
  const [part3, context] = await Promise.all([
    document ? loadDevelopmentGoals(db(), viewer, document.id, cycle.status) : null,
    loadDevelopmentGoalContext(db(), cycle),
  ]);
  const counters = part3?.counters ?? developmentGoalCounters([]);
  const isReadOnly = cycle.status !== "OTWARTY";
  const isSent = part3 !== null && !isReadOnly && !part3.canChange;

  // The client part gets only the messages it renders.
  const { developmentGoals, goalCentre, glossary, common, workflow } = await getMessages();
  const clientMessages = { developmentGoals, goalCentre, glossary, common, workflow };

  return (
    <Panel labelledBy="development-goals-title">
      <BackLink label={t("goalCentre.backToGoalCentre")} />
      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">
            {t("glossary.part", { number: 3 })} · {t("glossary.cycleYear", { year: cycle.year })}
          </p>
          <h1 id="development-goals-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
            {t("developmentGoals.sectionTitle")}
          </h1>
          <SectionChips
            label={t("goalCentre.sectionCounters")}
            chips={[
              { key: "drafts", text: t("goalCentre.counters.drafts", { count: counters.drafts }) },
              { key: "addedToPlan", text: t("goalCentre.counters.addedToPlan", { count: counters.inPlan }) },
              {
                key: "changedByManager",
                text: t("goalCentre.counters.changedByManager", { count: counters.changedByManager }),
              },
              {
                key: "cancelled",
                text: t("goalCentre.counters.cancelled", { count: counters.cancelled }),
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
            cancelled: t("goalCentre.progressTotals.cancelled"),
          })}
        />
      </div>

      {/* G3-03: draft wording; the final PL/EN text waits for HR (Q-07). */}
      <div className="mt-6 max-w-3xl space-y-3 leading-relaxed text-ink-soft">
        <p>{t("developmentGoals.intro.purpose")}</p>
        <p>{t("developmentGoals.intro.instructions")}</p>
        <p>
          {t.rich("developmentGoals.intro.resources", {
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
      {isSent && <Notice>{t("developmentGoals.documentSent")}</Notice>}
      {part3?.canChange && part3.wasSent && <Notice>{t("developmentGoals.sentNotice")}</Notice>}

      <div className="mt-6">
        <NextIntlClientProvider messages={clientMessages}>
          <DevelopmentGoalList
            goals={(part3?.goals ?? []).map(toItem)}
            context={context}
            documentId={part3?.documentId ?? null}
            canChange={part3?.canChange ?? false}
            wasSent={part3?.wasSent ?? false}
            canUpdateProgress={part3?.canUpdateProgress ?? false}
          />
        </NextIntlClientProvider>
      </div>
    </Panel>
  );
}

/** G3-04 progress counters; [ZAŁ] eGEDP's orange / yellow / green / grey mapped onto the brand palette. */
function progressItems(counters: DevelopmentGoalCounters, label: ProgressLabels): CounterItem[] {
  return [
    { key: "toStart", label: label.toStart, value: counters.progress.DO_ROZPOCZECIA, tone: "border-brand-orange/70" },
    { key: "ongoing", label: label.ongoing, value: counters.progress.W_TRAKCIE, tone: "border-brand-magenta/60" },
    { key: "completed", label: label.completed, value: counters.progress.UKONCZONY, tone: "border-accent" },
    { key: "cancelled", label: label.cancelled, value: counters.cancelled },
  ];
}

/** The client never needs the document id of a goal: the list gets it once. */
function toItem(goal: DevelopmentGoalView): DevelopmentGoalItem {
  return {
    id: goal.id,
    competencyId: goal.competencyId,
    developmentAreaId: goal.developmentAreaId,
    actionTitle: goal.actionTitle,
    actionDescription: goal.actionDescription,
    startDate: goal.startDate,
    endDate: goal.endDate,
    progress: goal.progress,
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
