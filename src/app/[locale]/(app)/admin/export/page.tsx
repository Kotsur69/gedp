import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle, loadCycleOptions } from "@/server/cycles";
import { db } from "@/server/db";
import { loadEmployeeFilterOptions } from "@/server/employee-admin";
import { ExportForm } from "./export-form";

// HR panel, data export (HR-08 + HR-12): pick the data, the year and the people, see how many people
// and records that is, then download .xlsx or CSV. HR only: anyone else gets the 403 boundary
// (forbidden.tsx). The Server Actions check HR again and audit every download.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.export.title") }) };
}

export default async function ExportPage() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GuardedExport />
    </Suspense>
  );
}

async function GuardedExport() {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();

  const [cycles, selected, options, t] = await Promise.all([
    loadCycleOptions(true),
    getSelectedCycle(),
    loadEmployeeFilterOptions(db(), viewer),
    getTranslations("admin"),
  ]);
  const years = cycles.map((cycle) => cycle.year);
  const defaultYear = selected?.year ?? years[0];

  // The client part gets only the messages it renders.
  const { admin } = await getMessages();
  const clientMessages = { admin: { export: admin.export } };

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
      <h1 id="screen-title" className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">
        {t("export.title")}
      </h1>
      <p className="mt-2 max-w-prose text-ink-soft">{t("export.intro")}</p>

      {defaultYear === undefined ? (
        <p className="mt-6 text-ink-soft">{t("export.noCycle")}</p>
      ) : (
        <NextIntlClientProvider messages={clientMessages}>
          <ExportForm years={years} defaultYear={defaultYear} departments={options.departments} people={options.managers} />
        </NextIntlClientProvider>
      )}
    </section>
  );
}
