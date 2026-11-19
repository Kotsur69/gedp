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
import { listTeam } from "@/server/team";
import { listDocumentsToValidate, type DocumentToValidate } from "@/server/workflow";
import { Panel, ViewSwitch } from "../goal-centre-ui";
import { TeamList } from "./team-list";

export function generateMetadata() {
  return screenMetadata("myTeam");
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Goal Centre, "Mój zespół" view (WF-20..22, HOME-12): managers and override validators only;
// anyone else gets 404. The validation inbox (WF-03) on top, then the team list with status and
// completion. Who is listed and who may be validated comes from the permission module on the
// server (src/server/team.ts); `?level=` is parsed there against the viewer's own depth.
export default function TeamPage({ searchParams }: Props) {
  return (
    <Suspense fallback={null}>
      <GuardedTeam searchParams={searchParams} />
    </Suspense>
  );
}

async function GuardedTeam({ searchParams }: Props) {
  await requireTab("myTeam");
  const [viewer, selected, locale, t, params] = await Promise.all([
    requireEmployee(),
    getSelectedCycle(),
    getLocale(),
    getTranslations(),
    searchParams,
  ]);
  const cycle = selected
    ? await db().cycle.findUnique({ where: { year: selected.year }, select: { id: true } })
    : null;
  const [inbox, team] = await Promise.all([
    cycle ? listDocumentsToValidate(db(), viewer, cycle.id) : [],
    cycle ? listTeam(db(), viewer, cycle.id, params.level) : null,
  ]);
  const displayLocale = locale as Locale;

  return (
    <div className="flex flex-col gap-6">
      <Panel labelledBy="team-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {selected && (
              <p className="text-xs font-semibold tracking-wider text-accent uppercase">
                {t("glossary.cycleYear", { year: selected.year })}
              </p>
            )}
            <h1 id="team-title" className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
              {t("glossary.goalCentre")}
            </h1>
            <p className="mt-1 text-sm font-semibold text-ink-soft">{t("team.title")}</p>
          </div>
          <ViewSwitch
            active="team"
            label={t("goalCentre.viewSwitch")}
            labels={{ mine: t("goalCentre.myGoals"), team: t("goalCentre.myTeam") }}
          />
        </div>
        {!cycle && <p className="mt-4 text-ink-soft">{t("goalCentre.noCycle")}</p>}
      </Panel>

      {cycle && <ValidationInbox inbox={inbox} locale={displayLocale} />}

      {team && (
        <Panel labelledBy="team-list-title">
          <TeamList view={team} locale={displayLocale} />
        </Panel>
      )}
    </div>
  );
}

async function ValidationInbox({ inbox, locale }: { inbox: readonly DocumentToValidate[]; locale: Locale }) {
  const t = await getTranslations();
  return (
    <Panel labelledBy="to-validate-title">
      <h2 id="to-validate-title" className="flex items-center gap-2 text-2xl font-semibold text-ink">
        {t("team.toValidateTitle")}
        {inbox.length > 0 && (
          <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-accent px-2 text-base text-on-solid tabular-nums">
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
                href={`/goal-centre/team/${item.documentId}`}
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
                  {t("team.lastUpdate")}: {formatDate(item.updatedAt, locale)}
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
    </Panel>
  );
}
