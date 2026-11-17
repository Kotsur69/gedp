import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ChevronRightIcon } from "@/components/shell/icons";
import { developmentGoalCounters } from "@/domain/development-goal";
import { performanceGoalCounters } from "@/domain/performance-goal";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import { loadDevelopmentGoals } from "@/server/development-goals";
import { loadPerformanceGoals } from "@/server/performance-goals";
import {
  aggregateCounters,
  BHP_COMMITMENT_MAX_LENGTH,
  ensureOwnDocument,
  groupGoalCounters,
  loadGroupGoals,
  loadGroupGoalTemplates,
  type GroupGoalView,
  type SectionCounters,
} from "@/server/group-goals";
import { CounterRings, Notice, Panel, SectionChips, type SectionChip } from "./goal-centre-ui";
import { GroupGoalCards, type GroupGoalCardData } from "./group-goal-cards";

// Goal Centre ("Centrum celów", G1-01..12, WF-23) for the cycle year picked in the header.
// The person's own document is created as SZKIC on first open of an open cycle. Part 1 (Group
// goals) lives here; Parts 2 and 3 (performance and development goals) have their own screens,
// /goal-centre/performance and /goal-centre/development, linked from their summaries below.
// Every part passes its counters to the top bar.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("glossary.goalCentre") }) };
}

export default async function GoalCentrePage() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GoalCentre />
    </Suspense>
  );
}

// The N+1 counter keeps the warm tint the author circled on S06.
const TOTAL_TONES = {
  drafts: "border-line-strong",
  addedToPlan: "border-accent/50",
  changedByManager: "border-brand-orange/60 bg-notice-surface",
} as const;

async function GoalCentre() {
  const [viewer, selected, locale, t] = await Promise.all([
    requireEmployee(),
    getSelectedCycle(),
    getLocale(),
    getTranslations(),
  ]);
  const cycle = selected
    ? await db().cycle.findUnique({ where: { year: selected.year }, select: { id: true, year: true, status: true } })
    : null;
  if (!cycle) {
    return (
      <Panel labelledBy="goal-centre-title">
        <h1 id="goal-centre-title" className="text-3xl font-semibold text-ink">
          {t("glossary.goalCentre")}
        </h1>
        <p className="mt-3 text-ink-soft">{t("goalCentre.noCycle")}</p>
      </Panel>
    );
  }

  const document = await ensureOwnDocument(db(), viewer, cycle);
  const [part1, part2, part3] = await Promise.all([
    document
      ? loadGroupGoals(db(), viewer, document.id, cycle.status)
      : loadGroupGoalTemplates(db(), cycle.id).then((goals) => ({
          documentId: null,
          status: null,
          canChange: false,
          goals,
        })),
    document ? loadPerformanceGoals(db(), viewer, document.id, cycle.status) : null,
    document ? loadDevelopmentGoals(db(), viewer, document.id, cycle.status) : null,
  ]);

  const groupCounters = groupGoalCounters(part1.goals);
  const performanceCounters = part2?.counters ?? performanceGoalCounters([]);
  const developmentCounters = part3?.counters ?? developmentGoalCounters([]);
  // Parts 2 and 3: "Nie dodane do planu" counts as a draft, "Dodane do planu" feeds the top bar's
  // "done" (see SectionCounters).
  const performanceSection: SectionCounters = {
    drafts: performanceCounters.notInPlan,
    done: performanceCounters.inPlan,
    changedByManager: performanceCounters.changedByManager,
  };
  const developmentSection: SectionCounters = {
    drafts: developmentCounters.drafts,
    done: developmentCounters.inPlan,
    changedByManager: developmentCounters.changedByManager,
  };
  const totals = aggregateCounters([groupCounters, performanceSection, developmentSection]);
  const isReadOnly = cycle.status !== "OTWARTY";
  const isSent = part1.status !== null && !isReadOnly && !part1.canChange;

  // The client part gets only the messages it renders.
  const { groupGoals, common } = await getMessages();
  const clientMessages = {
    groupGoals,
    common: { close: common.close, edit: common.edit, save: common.save, cancel: common.cancel },
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel labelledBy="goal-centre-title">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wider text-accent uppercase">
              {t("glossary.cycleYear", { year: cycle.year })}
            </p>
            <h1 id="goal-centre-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
              {t("glossary.goalCentre")}
            </h1>
            <p className="mt-1 text-sm font-semibold text-ink-soft">{t("goalCentre.myGoals")}</p>
          </div>
          <CounterRings
            label={t("goalCentre.allParts")}
            items={[
              { key: "drafts", label: t("goalCentre.totals.drafts"), value: totals.drafts, tone: TOTAL_TONES.drafts },
              {
                key: "addedToPlan",
                label: t("goalCentre.totals.addedToPlan"),
                value: totals.done,
                tone: TOTAL_TONES.addedToPlan,
              },
              {
                key: "changedByManager",
                label: t("goalCentre.totals.changedByManager"),
                value: totals.changedByManager,
                tone: TOTAL_TONES.changedByManager,
              },
            ]}
          />
        </div>
      </Panel>

      <Panel labelledBy="group-goals-title">
        <h2 id="group-goals-title" className="text-2xl font-semibold text-ink">
          {t("groupGoals.sectionTitle")}
        </h2>
        <SectionChips
          label={t("goalCentre.sectionCounters")}
          chips={[
            { key: "drafts", text: t("goalCentre.counters.drafts", { count: groupCounters.drafts }) },
            { key: "acknowledged", text: t("goalCentre.counters.acknowledged", { count: groupCounters.done }) },
            {
              key: "changedByManager",
              text: t("goalCentre.counters.changedByManager", { count: groupCounters.changedByManager }),
            },
          ]}
        />
        <p className="mt-4 max-w-3xl leading-relaxed text-ink-soft">{t("groupGoals.sectionDescription")}</p>
        {isReadOnly && <Notice>{t("goalCentre.viewOnlyNotice")}</Notice>}
        {isSent && <Notice>{t("groupGoals.documentSent")}</Notice>}
        <div className="mt-6">
          {part1.goals.length === 0 ? (
            <p className="text-ink-soft">{t("groupGoals.noTemplates")}</p>
          ) : (
            <NextIntlClientProvider messages={clientMessages}>
              <GroupGoalCards
                goals={part1.goals.map((goal) => toCardData(goal, t(`glossary.groupGoalTypes.${goal.type}`), locale))}
                documentId={part1.documentId}
                canChange={part1.canChange}
                commitmentMaxLength={BHP_COMMITMENT_MAX_LENGTH}
              />
            </NextIntlClientProvider>
          )}
        </div>
      </Panel>

      <PartSummary
        titleId="performance-goals-title"
        title={t("performanceGoals.sectionTitle")}
        href="/goal-centre/performance"
        linkLabel={t("goalCentre.openPart")}
        intro={t("performanceGoals.intro.purpose")}
        chipsLabel={t("goalCentre.sectionCounters")}
        chips={[
          { key: "notInPlan", text: t("goalCentre.counters.notInPlan", { count: performanceCounters.notInPlan }) },
          { key: "addedToPlan", text: t("goalCentre.counters.addedToPlan", { count: performanceCounters.inPlan }) },
          {
            key: "changedByManager",
            text: t("goalCentre.counters.changedByManager", { count: performanceCounters.changedByManager }),
          },
          {
            key: "totalWeight",
            text: t("goalCentre.counters.totalWeight", { weight: performanceCounters.totalWeightInPlan }),
            hasCheck: false,
          },
        ]}
      />

      <PartSummary
        titleId="development-goals-title"
        title={t("developmentGoals.sectionTitle")}
        href="/goal-centre/development"
        linkLabel={t("goalCentre.openPart")}
        intro={t("developmentGoals.intro.purpose")}
        chipsLabel={t("goalCentre.sectionCounters")}
        chips={[
          { key: "drafts", text: t("goalCentre.counters.drafts", { count: developmentCounters.drafts }) },
          { key: "addedToPlan", text: t("goalCentre.counters.addedToPlan", { count: developmentCounters.inPlan }) },
          {
            key: "changedByManager",
            text: t("goalCentre.counters.changedByManager", { count: developmentCounters.changedByManager }),
          },
          {
            key: "cancelled",
            text: t("goalCentre.counters.cancelled", { count: developmentCounters.cancelled }),
            hasCheck: false,
          },
        ]}
      />
    </div>
  );
}

type PartSummaryProps = {
  titleId: string;
  title: string;
  href: string;
  linkLabel: string;
  intro: string;
  chipsLabel: string;
  chips: readonly SectionChip[];
};

/** A part with its own screen: title, counters, first intro sentence and the link to the screen. */
function PartSummary({ titleId, title, href, linkLabel, intro, chipsLabel, chips }: PartSummaryProps) {
  return (
    <Panel labelledBy={titleId}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={titleId} className="text-2xl font-semibold text-ink">
            {title}
          </h2>
          <SectionChips label={chipsLabel} chips={chips} />
          <p className="mt-4 max-w-3xl leading-relaxed text-ink-soft">{intro}</p>
        </div>
        <Link
          href={href}
          aria-describedby={titleId}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition-opacity duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none sm:self-end"
        >
          {linkLabel}
          <ChevronRightIcon className="size-4" />
        </Link>
      </div>
    </Panel>
  );
}

function toCardData(goal: GroupGoalView, title: string, locale: Locale): GroupGoalCardData {
  return {
    templateId: goal.templateId,
    type: goal.type,
    title,
    content: locale === "en" ? goal.contentEn : goal.contentPl,
    acknowledgedOn: goal.acknowledgedAt ? formatDate(goal.acknowledgedAt, locale) : null,
    commitment: goal.commitment,
  };
}
