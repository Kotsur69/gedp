import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { EmployeeListFilters, TriState } from "@/server/employee-admin";
import { MANAGER_OPTIONS_ID } from "./option-lists";

// Search + filters of the HR employee list (HR-04). A plain GET form: the filters become the URL,
// which the page parses and validates, so it works without JavaScript and can be bookmarked.
// Submitting drops `page`, so a new search always starts on page 1.

const LABEL = "block text-sm font-semibold text-ink";
const CONTROL =
  "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink transition duration-200 hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent/40 motion-reduce:transition-none";
const TRI_STATES = ["all", "yes", "no"] as const satisfies readonly TriState[];

type EmployeeFiltersProps = { filters: EmployeeListFilters; departments: readonly string[] };

export async function EmployeeFilters({ filters, departments }: EmployeeFiltersProps) {
  const t = await getTranslations("admin");
  const tCommon = await getTranslations("common");
  // A department that no longer exists (old bookmark) stays selected, so the form shows the truth.
  const departmentOptions =
    filters.department && !departments.includes(filters.department) ? [filters.department, ...departments] : departments;
  const flags = [
    { name: "active", label: t("employeeFields.active"), value: filters.active },
    { name: "whiteCollar", label: t("employeeFields.whiteCollar"), value: filters.whiteCollar },
    { name: "hrAdmin", label: t("employeeFields.hrAdmin"), value: filters.hrAdmin },
  ] as const;
  const triStateLabel: Record<TriState, string> = { all: t("employees.all"), yes: tCommon("yes"), no: tCommon("no") };

  return (
    <form
      method="get"
      role="search"
      aria-labelledby="employee-filters-title"
      className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id="employee-filters-title" className="text-base font-semibold text-ink">
        {t("employees.filtersTitle")}
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor="employee-search" className={LABEL}>
            {t("employees.search")}
          </label>
          <input
            id="employee-search"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={100}
            aria-describedby="employee-search-hint"
            autoComplete="off"
            className={CONTROL}
          />
          <p id="employee-search-hint" className="mt-1 text-sm text-ink-soft">
            {t("employees.searchHint")}
          </p>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="employee-department" className={LABEL}>
            {t("employeeFields.department")}
          </label>
          <select id="employee-department" name="department" defaultValue={filters.department} className={CONTROL}>
            <option value="">{t("employees.anyDepartment")}</option>
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor="employee-manager-filter" className={LABEL}>
            {t("employees.managerFilter")}
          </label>
          <input
            id="employee-manager-filter"
            name="manager"
            defaultValue={filters.manager}
            maxLength={20}
            list={MANAGER_OPTIONS_ID}
            autoComplete="off"
            spellCheck={false}
            className={`${CONTROL} uppercase`}
          />
        </div>
        {flags.map((flag) => (
          <div key={flag.name}>
            <label htmlFor={`employee-filter-${flag.name}`} className={LABEL}>
              {flag.label}
            </label>
            <select id={`employee-filter-${flag.name}`} name={flag.name} defaultValue={flag.value} className={CONTROL}>
              {TRI_STATES.map((value) => (
                <option key={value} value={value}>
                  {triStateLabel[value]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          {t("employees.apply")}
        </button>
        <Link
          href="/admin/employees"
          className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("employees.clear")}
        </Link>
      </div>
    </form>
  );
}
