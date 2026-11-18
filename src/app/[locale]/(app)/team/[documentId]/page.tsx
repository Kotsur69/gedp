import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import { DocumentStatusPanel } from "@/components/workflow/document-status-panel";
import type { Locale } from "@/i18n/config";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { loadDevelopmentGoalContext, loadDevelopmentGoals } from "@/server/development-goals";
import { loadGroupGoals } from "@/server/group-goals";
import { requireTab } from "@/server/navigation";
import { loadPerformanceGoals } from "@/server/performance-goals";
import { isAccessError, requireDocumentPermission } from "@/server/permissions";
import { loadDocumentWorkflow } from "@/server/workflow";
import { Panel } from "../../goal-centre/goal-centre-ui";
import { DevelopmentGoalsReview, GroupGoalsReview, PerformanceGoalsReview } from "./document-review";

// Validator's view of an employee's document (WF-03, WF-22): every part read-only, then
// "Zatwierdź" / "Zwróć do poprawy" and the status history. Anyone who may view the document
// (N+2 and above) sees it without buttons; anyone else gets 404, never "forbidden".

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

  try {
    await requireDocumentPermission(db(), viewer, documentId, "view");
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

  return (
    <div className="flex flex-col gap-6">
      <Panel labelledBy="team-document-title">
        <Link
          href="/team"
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
      </Panel>

      <DocumentStatusPanel workflow={workflow} titleId="team-document-status" />

      <GroupGoalsReview goals={part1.goals} locale={displayLocale} />
      <PerformanceGoalsReview goals={part2.goals} totalWeight={part2.counters.totalWeightInPlan} locale={displayLocale} />
      <DevelopmentGoalsReview goals={part3.goals} context={developmentContext} locale={displayLocale} />
    </div>
  );
}
