import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/shell/icons";
import type { EmployeeListFilters } from "@/server/employee-admin";

// Previous / next page links of the HR employee list. Keeps the current filters in the URL and
// leaves out values that equal the defaults, so the links stay short and readable.

const DEFAULT_FILTER_VALUES: Readonly<Record<string, string>> = {
  q: "",
  department: "",
  manager: "",
  active: "all",
  whiteCollar: "all",
  hrAdmin: "all",
};

export function employeeListHref(filters: EmployeeListFilters, page: number): string {
  const params = new URLSearchParams();
  for (const [key, defaultValue] of Object.entries(DEFAULT_FILTER_VALUES)) {
    const value = String(filters[key as keyof EmployeeListFilters]);
    if (value !== defaultValue) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/employees?${query}` : "/admin/employees";
}

const LINK =
  "inline-flex min-h-11 items-center gap-1 rounded-xl border border-line-strong bg-surface px-4 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none";

type EmployeePaginationProps = { filters: EmployeeListFilters; page: number; pageCount: number };

export async function EmployeePagination({ filters, page, pageCount }: EmployeePaginationProps) {
  if (pageCount <= 1) return null;
  const t = await getTranslations();
  return (
    <nav aria-label={t("admin.employees.pagination")} className="mt-6 flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={employeeListHref(filters, page - 1)} className={LINK}>
          <ChevronLeftIcon className="size-4" />
          {t("common.previous")}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <p className="text-sm font-semibold text-ink-soft tabular-nums">
        {t("admin.employees.page", { page, pages: pageCount })}
      </p>
      {page < pageCount ? (
        <Link href={employeeListHref(filters, page + 1)} className={LINK}>
          {t("common.next")}
          <ChevronRightIcon className="size-4" />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
