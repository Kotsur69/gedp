import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/shell/icons";
import { MAX_CYCLE_YEAR } from "@/domain/cycle-config";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { requireEmployee } from "@/server/current-employee";
import { listCyclesForAdmin, type CycleListItem } from "@/server/cycle-admin";
import { db } from "@/server/db";
import { CycleStatusBadge } from "./cycle-status-badge";
import { NewCycleForm } from "./new-cycle-form";

// HR panel, cycles (HR-05): every cycle with its status and goal-setting dates, and "Nowy cykl"
// (by default next year as a copy of the newest cycle). HR only: anyone else gets the 403
// boundary (forbidden.tsx); every Server Action checks HR again.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.cycles.title") }) };
}

export default async function CyclesPage() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GuardedCycles />
    </Suspense>
  );
}

const showDate = (iso: string | null, locale: Locale, fallback: string): string =>
  iso ? formatDate(new Date(`${iso}T12:00:00.000Z`), locale) : fallback;

const HEADER_CELL = "px-4 py-3 font-semibold";

async function GuardedCycles() {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();

  const [cycles, t, tGlossary, locale] = await Promise.all([
    listCyclesForAdmin(db(), viewer),
    getTranslations("admin"),
    getTranslations("glossary"),
    getLocale(),
  ]);
  const newest = cycles[0]?.year ?? new Date().getUTCFullYear() - 1;
  const defaultYear = Math.min(newest + 1, MAX_CYCLE_YEAR);

  // The client form gets only the messages it renders.
  const { admin } = await getMessages();
  const clientMessages = { admin: { cycles: admin.cycles } };
  const dates = (cycle: CycleListItem) =>
    t("cycles.dateRange", {
      from: showDate(cycle.goalSettingOpensAt, locale as Locale, t("cycles.noDate")),
      to: showDate(cycle.goalSettingClosesAt, locale as Locale, t("cycles.noDate")),
    });

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
        {t("cycles.title")}
      </h1>
      <p className="mt-2 max-w-prose text-ink-soft">{t("cycles.intro")}</p>

      <section
        aria-labelledby="new-cycle-title"
        className="mt-8 rounded-2xl border border-line bg-surface p-5 shadow-panel sm:p-6"
      >
        <h2 id="new-cycle-title" className="text-lg font-semibold text-ink">
          {t("cycles.new.title")}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">{t("cycles.new.intro")}</p>
        <NextIntlClientProvider messages={clientMessages}>
          <NewCycleForm cycles={cycles.map(({ id, year }) => ({ id, year }))} defaultYear={defaultYear} />
        </NextIntlClientProvider>
      </section>

      <h2 className="mt-10 text-lg font-semibold text-ink">{t("cycles.listTitle")}</h2>
      {cycles.length === 0 ? (
        <p className="mt-3 text-ink-soft">{t("cycles.empty")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-left">
            <caption className="sr-only">{t("cycles.listCaption")}</caption>
            <thead className="border-b border-line text-sm text-ink-soft">
              <tr>
                <th scope="col" className={HEADER_CELL}>
                  {t("cycles.year")}
                </th>
                <th scope="col" className={HEADER_CELL}>
                  {t("cycles.statusColumn")}
                </th>
                <th scope="col" className={HEADER_CELL}>
                  {t("cycles.goalSetting")}
                </th>
                <th scope="col" className={`${HEADER_CELL} text-right`}>
                  {t("cycles.documents")}
                </th>
                <th scope="col" className={HEADER_CELL}>
                  <span className="sr-only">{t("cycles.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cycles.map((cycle) => (
                <tr key={cycle.id} className="transition-colors duration-200 hover:bg-canvas motion-reduce:transition-none">
                  <th scope="row" className="px-4 py-3 text-lg font-semibold text-ink tabular-nums">
                    {cycle.year}
                  </th>
                  <td className="px-4 py-3">
                    <CycleStatusBadge status={cycle.status} label={tGlossary(`cycleStatus.${cycle.status}`)} />
                  </td>
                  <td className="px-4 py-3 text-ink tabular-nums">{dates(cycle)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{cycle.documentCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/cycles/${cycle.year}`}
                      aria-label={t("cycles.configure", { year: cycle.year })}
                      className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line-strong px-4 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                    >
                      {tGlossary("cycleYear", { year: cycle.year })}
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
