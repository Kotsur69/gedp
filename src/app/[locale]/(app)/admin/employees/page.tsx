import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { listEmployees, loadEmployeeFilterOptions, parseEmployeeListFilters } from "@/server/employee-admin";
import { EmployeeFilters } from "./employee-filters";
import { EmployeePagination } from "./employee-pagination";
import { EmployeeTable } from "./employee-table";
import { OptionLists } from "./option-lists";

// HR panel, employees (HR-04): searchable, filterable list + edit window. HR only: anyone else gets
// the 403 boundary (forbidden.tsx). The filters live in the URL (GET form), so a filtered list can
// be bookmarked and works without JavaScript. The Server Action checks HR again on every save.

type SearchParams = Record<string, string | string[] | undefined>;
type EmployeesPageProps = { searchParams: Promise<SearchParams> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.employees.title") }) };
}

export default async function EmployeesPage({ searchParams }: EmployeesPageProps) {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GuardedEmployees searchParams={searchParams} />
    </Suspense>
  );
}

async function GuardedEmployees({ searchParams }: EmployeesPageProps) {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();

  const filters = parseEmployeeListFilters(await searchParams);
  const [list, options, t] = await Promise.all([
    listEmployees(db(), viewer, filters),
    loadEmployeeFilterOptions(db(), viewer),
    getTranslations("admin"),
  ]);

  // The client part gets only the messages it renders.
  const { admin, common } = await getMessages();
  const clientMessages = {
    admin: { employees: admin.employees, employeeFields: admin.employeeFields },
    common: { yes: common.yes, no: common.no, edit: common.edit, cancel: common.cancel, save: common.save },
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
      <h1 id="screen-title" className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">
        {t("employees.title")}
      </h1>
      <p className="mt-2 max-w-prose text-ink-soft">{t("employees.intro")}</p>

      <OptionLists managers={options.managers} departments={options.departments} />
      <EmployeeFilters filters={filters} departments={options.departments} />

      <p role="status" className="mt-6 text-sm font-semibold text-ink-soft tabular-nums">
        {t("employees.results", { count: list.total })}
      </p>

      <NextIntlClientProvider messages={clientMessages}>
        <EmployeeTable items={list.items} />
      </NextIntlClientProvider>

      <EmployeePagination filters={filters} page={list.page} pageCount={list.pageCount} />
    </section>
  );
}
