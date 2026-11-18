import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import { listDocumentsForHr, parseDocumentListFilters } from "@/server/document-admin";
import { DocumentFilters } from "./document-filters";
import { DocumentTable } from "./document-table";

// HR panel, documents (WF-08, WF-09, HR-07): every document of the cycle picked in the header (any
// cycle, searchable by name, AMEI, department and status), with its status and who validates it,
// "Otwórz" to correct it ([documentId]/page.tsx) and "Cofnij status" per row. HR only: anyone else gets the 403
// boundary (forbidden.tsx). The Server Action checks HR again on every revert.

type SearchParams = Record<string, string | string[] | undefined>;
type DocumentsPageProps = { searchParams: Promise<SearchParams> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.documents.title") }) };
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GuardedDocuments searchParams={searchParams} />
    </Suspense>
  );
}

async function GuardedDocuments({ searchParams }: DocumentsPageProps) {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();

  const [selected, t, tGlossary, params] = await Promise.all([
    getSelectedCycle(),
    getTranslations("admin"),
    getTranslations("glossary"),
    searchParams,
  ]);
  const cycle = selected ? await db().cycle.findUnique({ where: { year: selected.year }, select: { id: true } }) : null;
  const filters = parseDocumentListFilters(params);
  const list = cycle ? await listDocumentsForHr(db(), viewer, cycle.id, filters) : null;
  const canRevert = selected !== null && !selected.isReadOnly;

  // The client part gets only the messages it renders.
  const { admin, glossary, workflow, common } = await getMessages();
  const clientMessages = {
    admin: {
      documents: admin.documents,
      employees: { noValidator: admin.employees.noValidator, overrideLabel: admin.employees.overrideLabel },
    },
    glossary: { documentStatus: glossary.documentStatus },
    workflow: { revertReason: workflow.revertReason, errors: workflow.errors },
    common: { cancel: common.cancel },
  };

  return (
    <section
      aria-labelledby="screen-title"
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronLeftIcon className="size-4" />
        {t("title")}
      </Link>
      {selected && (
        <p className="mt-2 text-xs font-semibold tracking-wider text-accent uppercase">
          {tGlossary("cycleYear", { year: selected.year })}
        </p>
      )}
      <h1 id="screen-title" className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">
        {t("documents.title")}
      </h1>
      <p className="mt-2 max-w-prose text-ink-soft">{t("documents.intro")}</p>

      {!cycle || !list || !selected ? (
        <p className="mt-6 text-ink-soft">{t("documents.noCycle")}</p>
      ) : (
        <>
          {!canRevert && (
            <p className="mt-4 max-w-3xl rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
              {t("documents.readOnly")}
            </p>
          )}
          <DocumentFilters filters={filters} />
          <p role="status" className="mt-6 text-sm font-semibold text-ink-soft tabular-nums">
            {list.total > list.items.length
              ? t("documents.shownOf", { shown: list.items.length, total: list.total })
              : t("documents.results", { count: list.total })}
          </p>
          <NextIntlClientProvider messages={clientMessages}>
            <DocumentTable items={list.items} year={selected.year} canRevert={canRevert} />
          </NextIntlClientProvider>
        </>
      )}
    </section>
  );
}
