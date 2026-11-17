import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { CheckIcon } from "@/components/shell/icons";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import {
  aggregateCounters,
  BHP_COMMITMENT_MAX_LENGTH,
  ensureOwnDocument,
  groupGoalCounters,
  loadGroupGoals,
  loadGroupGoalTemplates,
  type GroupGoalView,
} from "@/server/group-goals";
import { GroupGoalCards, type GroupGoalCardData } from "./group-goal-cards";

// Goal Centre ("Centrum celów", G1-01..12, WF-23) for the cycle year picked in the header.
// The person's own document is created as SZKIC on first open of an open cycle. Part 1 (Group
// goals) lives here; Parts 2 and 3 add their own section and pass their counters to the top bar.

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
  const part1 = document
    ? await loadGroupGoals(db(), viewer, document.id, cycle.status)
    : { documentId: null, status: null, canChange: false, goals: await loadGroupGoalTemplates(db(), cycle.id) };

  const groupCounters = groupGoalCounters(part1.goals);
  // Parts 2 and 3 append their SectionCounters here.
  const totals = aggregateCounters([groupCounters]);
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
          <TotalsBar
            label={t("goalCentre.allParts")}
            items={[
              { key: "drafts", label: t("goalCentre.totals.drafts"), value: totals.drafts },
              { key: "addedToPlan", label: t("goalCentre.totals.addedToPlan"), value: totals.done },
              { key: "changedByManager", label: t("goalCentre.totals.changedByManager"), value: totals.changedByManager },
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
    </div>
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

function Panel({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      {children}
    </section>
  );
}

type CounterItem = { key: string; label: string; value: number };

// The N+1 counter keeps the warm tint the author circled on S06.
const TOTAL_TONES: Readonly<Record<string, string>> = {
  drafts: "border-line-strong",
  addedToPlan: "border-accent/50",
  changedByManager: "border-brand-orange/60 bg-notice-surface",
};

/** WF-23: totals across all parts. */
function TotalsBar({ label, items }: { label: string; items: readonly CounterItem[] }) {
  return (
    <dl aria-label={label} className="flex gap-3 sm:gap-5">
      {items.map((item) => (
        <div key={item.key} className="flex w-24 flex-col-reverse items-center gap-2 text-center">
          <dt className="text-xs leading-tight font-semibold text-ink-soft">{item.label}</dt>
          <dd
            className={`flex size-14 items-center justify-center rounded-full border-2 bg-surface text-xl font-semibold text-ink tabular-nums ${TOTAL_TONES[item.key] ?? "border-line-strong"}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** G1-10: display only until Q-16 decides whether the chips filter the cards. */
function SectionChips({ label, chips }: { label: string; chips: readonly { key: string; text: string }[] }) {
  return (
    <ul aria-label={label} className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink tabular-nums"
        >
          <CheckIcon className="size-3.5 text-accent" />
          {chip.text}
        </li>
      ))}
    </ul>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-4 rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
      {children}
    </p>
  );
}
