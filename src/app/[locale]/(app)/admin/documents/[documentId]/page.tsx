import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, PencilIcon } from "@/components/shell/icons";
import { DocumentStatusPanel } from "@/components/workflow/document-status-panel";
import type { Locale } from "@/i18n/config";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { loadDevelopmentGoalContext, loadDevelopmentGoals } from "@/server/development-goals";
import { BHP_COMMITMENT_MAX_LENGTH, loadGroupGoals } from "@/server/group-goals";
import { loadGoalFormContext, loadPerformanceGoals } from "@/server/performance-goals";
import { isAccessError, requireActiveHrAdmin, requireDocumentPermission } from "@/server/permissions";
import { loadDocumentWorkflow } from "@/server/workflow";
import { Panel } from "../../../goal-centre/goal-centre-ui";
import { DevelopmentGoalsReview, GroupGoalsReview, PerformanceGoalsReview } from "../../../goal-centre/team/[documentId]/document-review";
import { DevelopmentGoalEditor, PerformanceGoalEditor } from "../../../goal-centre/team/[documentId]/validator-goal-editor";
import { StatusBadge } from "../revert-status-dialog";
import { BhpCorrection } from "./bhp-correction";

// HR panel, one document (HR-07): any employee's document of any cycle, every part, with HR
// correction in every status. Each goal opens its Part 2 / Part 3 window in HR mode (content only
// plus the required reason); the BHP commitment has its own correction window. The status does
// not change here ("Cofnij status" is on the list). HR only: anyone else gets the 403 boundary of
// /admin/documents; a missing document is 404. Every Server Action re-checks HR on the live row.

type Props = { params: Promise<{ documentId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.documents.title") }) };
}

export default async function HrDocumentPage({ params }: Props) {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <HrDocument params={params} />
    </Suspense>
  );
}

/** Route segment -> document id; anything that is not a plain positive integer is not found. */
function parseDocumentId(raw: string): number | null {
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}

/** HR check against the live row, then the document; an invisible or missing one is 404. */
async function guard(documentId: number) {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();
  try {
    await requireActiveHrAdmin(db(), viewer);
    await requireDocumentPermission(db(), viewer, documentId, "view");
  } catch (error: unknown) {
    if (!isAccessError(error)) throw error;
    if (error.code === "FORBIDDEN") forbidden();
    notFound();
  }
  return viewer;
}

async function HrDocument({ params }: Props) {
  const documentId = parseDocumentId((await params).documentId);
  if (documentId === null) notFound();
  const viewer = await guard(documentId);

  const { cycle, employee } = await db().gedpDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: {
      cycle: { select: { id: true, year: true, status: true } },
      employee: { select: { firstName: true, lastName: true, amei: true, department: true, position: true } },
    },
  });
  const [workflow, part1, part2, part3, developmentContext, locale, t] = await Promise.all([
    loadDocumentWorkflow(db(), viewer, documentId, cycle.status),
    loadGroupGoals(db(), viewer, documentId, cycle.status),
    loadPerformanceGoals(db(), viewer, documentId, cycle.status),
    loadDevelopmentGoals(db(), viewer, documentId, cycle.status),
    loadDevelopmentGoalContext(db(), cycle),
    getLocale(),
    getTranslations(),
  ]);
  // Types the goals already use stay selectable even if HR has deactivated them.
  const usedTypeIds = part2.goals.flatMap((goal) => (goal.targetTypeId === null ? [] : [goal.targetTypeId]));
  const [performanceContext, messages] = await Promise.all([
    loadGoalFormContext(db(), cycle.year, usedTypeIds),
    getMessages(),
  ]);
  const displayLocale = locale as Locale;
  const employeeName = `${employee.firstName} ${employee.lastName}`;
  const facts = [employee.amei, employee.department, employee.position].filter(Boolean).join(" · ");

  // The client part gets only the messages it renders.
  const { performanceGoals, developmentGoals, goalControls, goalCentre, glossary, common, team, hrCorrection } = messages;
  const clientMessages = {
    performanceGoals,
    developmentGoals,
    goalControls,
    goalCentre,
    glossary,
    common,
    workflow: messages.workflow,
    team: { editGoal: team.editGoal },
    hrCorrection,
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel labelledBy="hr-document-title">
        <Link
          href="/admin/documents"
          className="inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-sm font-semibold text-ink-soft transition-colors duration-200 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <ChevronLeftIcon className="size-4" />
          {t("admin.documents.backToList")}
        </Link>
        <p className="mt-4 text-xs font-semibold tracking-wider text-accent uppercase">
          {t("glossary.cycleYear", { year: cycle.year })}
        </p>
        <h1 id="hr-document-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
          {t("admin.documents.documentOf", { name: employeeName })}
        </h1>
        <p className="mt-1 text-ink-soft tabular-nums">{facts}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge status={workflow.status} label={t(`glossary.documentStatus.${workflow.status}`)} />
          <p className="inline-flex items-center gap-1.5 rounded-lg border border-brand-orange/60 bg-notice-surface px-2.5 py-0.5 text-sm font-semibold text-notice">
            <PencilIcon className="size-4" />
            {t("hrCorrection.modeBadge")}
          </p>
        </div>
        <p className="mt-5 max-w-3xl rounded-2xl border border-brand-orange/60 bg-notice-surface px-5 py-4 text-sm leading-relaxed font-semibold text-notice">
          {t("hrCorrection.notice")}
        </p>
      </Panel>

      <DocumentStatusPanel workflow={workflow} titleId="hr-document-status" />

      <NextIntlClientProvider messages={clientMessages}>
        <GroupGoalsReview
          goals={part1.goals}
          locale={displayLocale}
          commitmentAction={(goal) => (
            <BhpCorrection
              documentId={documentId}
              templateId={goal.templateId}
              commitment={goal.commitment}
              maxLength={BHP_COMMITMENT_MAX_LENGTH}
            />
          )}
        />
        <PerformanceGoalEditor documentId={documentId} goals={part2.goals} context={performanceContext} editor="hr">
          <PerformanceGoalsReview
            goals={part2.goals}
            totalWeight={part2.counters.totalWeightInPlan}
            changedCount={part2.counters.changedByManager}
            canEdit
            locale={displayLocale}
          />
        </PerformanceGoalEditor>
        <DevelopmentGoalEditor documentId={documentId} goals={part3.goals} context={developmentContext} editor="hr">
          <DevelopmentGoalsReview
            goals={part3.goals}
            context={developmentContext}
            changedCount={part3.counters.changedByManager}
            canEdit
            locale={displayLocale}
          />
        </DevelopmentGoalEditor>
      </NextIntlClientProvider>
    </div>
  );
}
