import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, EyeIcon, PencilIcon } from "@/components/shell/icons";
import { DocumentStatusPanel } from "@/components/workflow/document-status-panel";
import type { Locale } from "@/i18n/config";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import type { DevelopmentGoalContext } from "@/domain/development-goal";
import { loadDevelopmentGoalContext, loadDevelopmentGoals, type DevelopmentGoalView } from "@/server/development-goals";
import { loadGroupGoals } from "@/server/group-goals";
import { requireTab } from "@/server/navigation";
import { loadGoalFormContext, loadPerformanceGoals, type PerformanceGoalView } from "@/server/performance-goals";
import { isAccessError, requireDocumentPermission } from "@/server/permissions";
import { loadDocumentWorkflow } from "@/server/workflow";
import { Panel } from "../../goal-centre-ui";
import { DevelopmentGoalsReview, GroupGoalsReview, PerformanceGoalsReview } from "./document-review";
import { DevelopmentGoalEditor, PerformanceGoalEditor } from "./validator-goal-editor";

// A report's document from "Mój zespół" (WF-03, WF-22): the parts, then the status panel.
// Validate mode ("Zatwierdź" / "Zwróć do poprawy") only when the permission module says
// canValidate (live N+1 or WF-09 override); anyone else who may view it (N+2 and above) gets the
// read-only preview; anyone who may not gets 404, never "forbidden". WF-04: while the document is
// in validation the validator may also change performance and development goals.

type Props = { params: Promise<{ documentId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("team.title") }) };
}

export default function TeamDocumentPage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <TeamDocument params={params} />
    </Suspense>
  );
}

/** Route segment -> document id; anything that is not a plain positive integer is not found. */
function parseDocumentId(raw: string): number | null {
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}

async function TeamDocument({ params }: Props) {
  await requireTab("myTeam");
  const documentId = parseDocumentId((await params).documentId);
  if (documentId === null) notFound();
  const [viewer, locale, t] = await Promise.all([requireEmployee(), getLocale(), getTranslations()]);

  let canValidate: boolean;
  try {
    canValidate = (await requireDocumentPermission(db(), viewer, documentId, "view")).permissions.validate;
  } catch (error: unknown) {
    if (isAccessError(error)) notFound();
    throw error;
  }
  const { cycle, employee } = await db().gedpDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: {
      cycle: { select: { id: true, year: true, status: true } },
      employee: { select: { firstName: true, lastName: true, position: true } },
    },
  });
  const [workflow, part1, part2, part3, developmentContext] = await Promise.all([
    loadDocumentWorkflow(db(), viewer, documentId, cycle.status),
    loadGroupGoals(db(), viewer, documentId, cycle.status),
    loadPerformanceGoals(db(), viewer, documentId, cycle.status),
    loadDevelopmentGoals(db(), viewer, documentId, cycle.status),
    loadDevelopmentGoalContext(db(), cycle),
  ]);
  const employeeName = `${employee.firstName} ${employee.lastName}`;
  const displayLocale = locale as Locale;
  const canEditGoals = workflow.canValidatorEditGoals;
  const performanceReview = (
    <PerformanceGoalsReview
      goals={part2.goals}
      totalWeight={part2.counters.totalWeightInPlan}
      changedCount={part2.counters.changedByManager}
      canEdit={canEditGoals}
      locale={displayLocale}
    />
  );
  const developmentReview = (
    <DevelopmentGoalsReview
      goals={part3.goals}
      context={developmentContext}
      changedCount={part3.counters.changedByManager}
      canEdit={canEditGoals}
      locale={displayLocale}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <Panel labelledBy="team-document-title">
        <Link
          href="/goal-centre/team"
          className="inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-sm font-semibold text-ink-soft transition-colors duration-200 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <ChevronLeftIcon className="size-4" />
          {t("team.backToTeam")}
        </Link>
        <p className="mt-4 text-xs font-semibold tracking-wider text-accent uppercase">
          {t("glossary.cycleYear", { year: cycle.year })}
        </p>
        <h1 id="team-document-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
          {t("team.documentOf", { name: employeeName })}
        </h1>
        {employee.position && <p className="mt-1 text-ink-soft">{employee.position}</p>}
        <p
          className={`mt-4 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold ${
            canValidate ? "border-accent/50 text-accent" : "border-line-strong text-ink-soft"
          }`}
        >
          {canValidate ? <PencilIcon className="size-4" /> : <EyeIcon className="size-4" />}
          {canValidate ? t("team.modeValidate") : t("team.modeReadOnly")}
        </p>
      </Panel>

      <DocumentStatusPanel workflow={workflow} titleId="team-document-status" />

      <GroupGoalsReview goals={part1.goals} locale={displayLocale} />
      {canEditGoals ? (
        <ValidatorEditing
          documentId={documentId}
          cycleYear={cycle.year}
          part2={part2.goals}
          part3={part3.goals}
          developmentContext={developmentContext}
          performanceReview={performanceReview}
          developmentReview={developmentReview}
        />
      ) : (
        <>
          {performanceReview}
          {developmentReview}
        </>
      )}
    </div>
  );
}

type EditingProps = {
  documentId: number;
  cycleYear: number;
  part2: readonly PerformanceGoalView[];
  part3: readonly DevelopmentGoalView[];
  developmentContext: DevelopmentGoalContext;
  performanceReview: ReactNode;
  developmentReview: ReactNode;
};

/** WF-04: the two goal parts inside their editors, with the messages the goal windows render. */
async function ValidatorEditing(props: EditingProps) {
  const { documentId, cycleYear, part2, part3, developmentContext, performanceReview, developmentReview } = props;
  // Types the goals already use stay selectable even if HR has deactivated them.
  const usedTypeIds = part2.flatMap((goal) => (goal.targetTypeId === null ? [] : [goal.targetTypeId]));
  const [performanceContext, messages, t] = await Promise.all([
    loadGoalFormContext(db(), cycleYear, usedTypeIds),
    getMessages(),
    getTranslations("team"),
  ]);
  // The client part gets only the messages it renders.
  const { performanceGoals, developmentGoals, goalControls, goalCentre, glossary, common, workflow, team } = messages;
  const clientMessages = {
    performanceGoals,
    developmentGoals,
    goalControls,
    goalCentre,
    glossary,
    common,
    workflow,
    team: { editGoal: team.editGoal },
  };
  return (
    <NextIntlClientProvider messages={clientMessages}>
      <p className="rounded-2xl border border-brand-orange/60 bg-notice-surface px-5 py-4 text-sm leading-relaxed font-semibold text-notice">
        {t("validatorEditNotice")}
      </p>
      <PerformanceGoalEditor documentId={documentId} goals={part2} context={performanceContext}>
        {performanceReview}
      </PerformanceGoalEditor>
      <DevelopmentGoalEditor documentId={documentId} goals={part3} context={developmentContext}>
        {developmentReview}
      </DevelopmentGoalEditor>
    </NextIntlClientProvider>
  );
}
