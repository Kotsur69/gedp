import { Suspense } from "react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { screenMetadata } from "@/components/shell/empty-tab";
import { ChevronRightIcon } from "@/components/shell/icons";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import { requireTab } from "@/server/navigation";
import { listDocumentsToValidate } from "@/server/workflow";
import { Panel } from "../goal-centre/goal-centre-ui";

export function generateMetadata() {
  return screenMetadata("myTeam");
}

// "Mój zespół" (HOME-12): managers and override validators only; anyone else gets 404.
// For now it holds the validation inbox (WF-03, "Dokumenty do walidacji"); the full team list with
// statuses and completion (WF-20..22) comes with the team view.
export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <GuardedTeam />
    </Suspense>
  );
}

async function GuardedTeam() {
  await requireTab("myTeam");
  const [viewer, selected, locale, t] = await Promise.all([
    requireEmployee(),
    getSelectedCycle(),
    getLocale(),
    getTranslations(),
  ]);
  const cycle = selected
    ? await db().cycle.findUnique({ where: { year: selected.year }, select: { id: true } })
    : null;
  const inbox = cycle ? await listDocumentsToValidate(db(), viewer, cycle.id) : [];

  return (
    <Panel labelledBy="team-title">
      {selected && (
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">
          {t("glossary.cycleYear", { year: selected.year })}
        </p>
      )}
      <h1 id="team-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
        {t("team.title")}
      </h1>

      <section aria-labelledby="to-validate-title" className="mt-8">
        <h2 id="to-validate-title" className="flex items-center gap-2 text-2xl font-semibold text-ink">
          {t("team.toValidateTitle")}
          {inbox.length > 0 && (
            <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-accent px-2 text-base text-on-brand tabular-nums">
              {inbox.length}
            </span>
          )}
        </h2>
        {inbox.length === 0 ? (
          <p className="mt-3 text-ink-soft">{t("team.toValidateEmpty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {inbox.map((item) => (
              <li key={item.documentId}>
                <Link
                  href={`/team/${item.documentId}`}
                  aria-label={`${t("team.validateDocument")}: ${item.employeeName}`}
                  className="group flex min-h-16 items-center gap-4 px-5 py-3 transition-colors duration-200 hover:bg-canvas focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-accent motion-reduce:transition-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{item.employeeName}</span>
                    {(item.position || item.department) && (
                      <span className="block truncate text-sm text-ink-soft">
                        {[item.position, item.department].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="hidden text-sm text-ink-soft tabular-nums sm:block">
                    {t("team.lastUpdate")}: {formatDate(item.updatedAt, locale as Locale)}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent">
                    <span className="hidden sm:inline">{t("team.validateDocument")}</span>
                    <ChevronRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-sm text-ink-soft">{t("team.fullTeamComingSoon")}</p>
    </Panel>
  );
}
