import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DOCUMENT_STATUSES } from "@/domain/document-status";
import type { DocumentListFilters } from "@/server/document-admin";

// Search + status filter of the HR document list. A plain GET form: the filters become the URL,
// which the page parses and validates, so it works without JavaScript and can be bookmarked.

const LABEL = "block text-sm font-semibold text-ink";
const CONTROL =
  "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink transition duration-200 hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent/40 motion-reduce:transition-none";

export async function DocumentFilters({ filters }: { filters: DocumentListFilters }) {
  const t = await getTranslations("admin.documents");
  const tStatus = await getTranslations("glossary.documentStatus");
  return (
    <form
      method="get"
      role="search"
      aria-labelledby="document-filters-title"
      className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id="document-filters-title" className="text-base font-semibold text-ink">
        {t("filtersTitle")}
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="document-search" className={LABEL}>
            {t("search")}
          </label>
          <input
            id="document-search"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={100}
            aria-describedby="document-search-hint"
            autoComplete="off"
            className={CONTROL}
          />
          <p id="document-search-hint" className="mt-1 text-sm text-ink-soft">
            {t("searchHint")}
          </p>
        </div>
        <div>
          <label htmlFor="document-status" className={LABEL}>
            {t("status")}
          </label>
          <select id="document-status" name="status" defaultValue={filters.status ?? ""} className={CONTROL}>
            <option value="">{t("anyStatus")}</option>
            {DOCUMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {tStatus(status)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          {t("apply")}
        </button>
        <Link
          href="/admin/documents"
          className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("clear")}
        </Link>
      </div>
    </form>
  );
}
