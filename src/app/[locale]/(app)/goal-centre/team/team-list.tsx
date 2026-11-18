import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRightIcon } from "@/components/shell/icons";
import { DOCUMENT_STATUS_TONE } from "@/components/workflow/status-tone";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { DIRECT_LEVEL, TEAM_LIMIT, type TeamMember, type TeamView } from "@/server/team";
import { Notice } from "../goal-centre-ui";

// WF-21 team list: one row per report with document status, completion (closing conditions met /
// total) and last update; N+2 and above get a level filter. Server-rendered: the filter is plain
// links (?level=), so every state has its own URL and works without JavaScript.

const TEAM_PATH = "/goal-centre/team";
// Name | status | completion | last update | action, from lg up; stacked below.
const ROW_GRID = "lg:grid lg:grid-cols-[minmax(0,1fr)_11rem_8.5rem_8rem_12rem] lg:items-center lg:gap-5";
const FOCUS_RING = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent";

// `never` = the root namespace (every key, e.g. "team.levelN" and "glossary.documentStatus.*").
type Translate = Awaited<ReturnType<typeof getTranslations<never>>>;

function levelHref(level: number | null): string {
  return level === null ? TEAM_PATH : `${TEAM_PATH}?level=${level}`;
}

function LevelFilter({ view, t }: { view: TeamView; t: Translate }) {
  const options: { level: number | null; label: string }[] = [
    { level: null, label: t("team.wholeStructure") },
    { level: DIRECT_LEVEL, label: t("team.directReports") },
    ...Array.from({ length: view.maxLevel - DIRECT_LEVEL }, (_, index) => {
      const level = index + DIRECT_LEVEL + 1;
      return { level, label: t("team.levelN", { level }) };
    }),
  ];
  return (
    <nav aria-label={t("team.levelFilter")} className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.level === view.level;
          return (
            <li key={option.level ?? "all"}>
              <Link
                href={levelHref(option.level)}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none ${FOCUS_RING} ${
                  isActive
                    ? "border-transparent bg-ink text-on-brand"
                    : "border-line-strong bg-surface text-ink hover:border-accent/60 hover:text-accent"
                }`}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Tag({ children, tone = "border-line-strong text-ink-soft" }: { children: string; tone?: string }) {
  return <span className={`rounded-md border px-1.5 py-px text-xs font-semibold ${tone}`}>{children}</span>;
}

function CompletionMeter({ member, t }: { member: TeamMember; t: Translate }) {
  if (!member.document) {
    return (
      <span className="text-sm text-ink-soft">
        <span className="sr-only">{t("team.completion")}: {t("team.noDocument")}</span>
        <span aria-hidden="true">{t("team.neverUpdated")}</span>
      </span>
    );
  }
  const { met, total } = member.document.completion;
  const isComplete = met === total;
  return (
    <span className="flex items-center gap-2.5 lg:flex-col lg:items-stretch lg:gap-1.5">
      <span className="sr-only">{t("team.completionDescription", { met, total })}</span>
      <span aria-hidden="true" className="text-sm font-semibold text-ink tabular-nums">
        {t("team.completionValue", { met, total })}
      </span>
      <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-line lg:w-full">
        <span
          className={`block h-full origin-left rounded-full ${isComplete ? "bg-(image:--am-gradient)" : "bg-accent/70"}`}
          style={{ transform: `scaleX(${total === 0 ? 0 : met / total})` }}
        />
      </span>
    </span>
  );
}

function RowAction({ member, t }: { member: TeamMember; t: Translate }) {
  if (!member.document) {
    return <span className="text-sm text-ink-soft">{t("team.noDocument")}</span>;
  }
  // Validate mode only where the permission module says canValidate AND the document waits for it.
  const isValidation = member.canValidate && member.document.status === "DO_WALIDACJI";
  const label = isValidation ? t("team.validateDocument") : t("team.openDocument");
  return (
    <Link
      href={`${TEAM_PATH}/${member.document.id}`}
      aria-label={`${label}: ${member.name}`}
      className={`group inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-[opacity,color,border-color] duration-200 motion-reduce:transition-none ${FOCUS_RING} ${
        isValidation
          ? "bg-(image:--am-gradient) text-on-brand hover:opacity-90"
          : "border border-line-strong bg-surface text-ink hover:border-accent/60 hover:text-accent"
      }`}
    >
      {label}
      <ChevronRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

type MemberRowProps = { member: TeamMember; view: TeamView; locale: Locale; t: Translate };

function MemberRow({ member, view, locale, t }: MemberRowProps) {
  const status = member.document?.status ?? "NONE";
  const statusLabel = member.document ? t(`glossary.documentStatus.${member.document.status}`) : t("team.notStarted");
  const subtitle = [member.position, member.department].filter(Boolean).join(" · ");
  // The level tag only helps on the whole-structure list; a filtered list is all one level.
  const levelTag = view.maxLevel > DIRECT_LEVEL && view.level === null ? member.level : null;
  return (
    <li className={`flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 ${ROW_GRID}`}>
      <div className="w-full min-w-0 lg:w-auto">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold break-words text-ink">{member.name}</span>
          {levelTag !== null && <Tag>{t("team.levelN", { level: levelTag })}</Tag>}
          {member.level === null && (
            <Tag tone="border-accent/50 text-accent">{t("glossary.roles.validatorOverride")}</Tag>
          )}
          {!member.isActive && <Tag>{t("team.inactive")}</Tag>}
        </p>
        {subtitle && <p className="mt-0.5 text-sm break-words text-ink-soft">{subtitle}</p>}
      </div>
      <p>
        <span className="sr-only">{t("team.documentStatus")}: </span>
        <span className={`inline-block rounded-lg border px-2.5 py-0.5 text-sm font-semibold ${DOCUMENT_STATUS_TONE[status]}`}>
          {statusLabel}
        </span>
      </p>
      <CompletionMeter member={member} t={t} />
      <p className="text-sm text-ink-soft tabular-nums">
        <span className="sr-only">{t("team.lastUpdate")}: </span>
        {member.document ? formatDate(member.document.lastUpdatedAt, locale) : t("team.neverUpdated")}
      </p>
      <div className="ml-auto lg:ml-0 lg:justify-self-end">
        <RowAction member={member} t={t} />
      </div>
    </li>
  );
}

export async function TeamList({ view, locale }: { view: TeamView; locale: Locale }) {
  const t = await getTranslations();
  const hasFilter = view.maxLevel > DIRECT_LEVEL;
  const emptyText = view.level === null ? t("team.empty") : t("team.emptyLevel");
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="team-list-title" className="text-2xl font-semibold text-ink">
          {t("team.listTitle")}
        </h2>
        <p className="text-sm font-semibold text-ink-soft tabular-nums">
          {t("team.membersCount", { count: view.members.length })}
        </p>
      </div>
      {hasFilter && <LevelFilter view={view} t={t} />}
      {view.isTruncated && <Notice>{t("team.truncated", { limit: TEAM_LIMIT })}</Notice>}

      {view.members.length === 0 ? (
        <p className="mt-4 text-ink-soft">{emptyText}</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          {/* Column captions for sighted users from lg up; each cell carries its own sr-only label. */}
          <div
            aria-hidden="true"
            className={`hidden border-b border-line bg-canvas px-5 py-2.5 text-xs font-semibold tracking-wider text-ink-soft uppercase ${ROW_GRID}`}
          >
            <span>{t("team.name")}</span>
            <span>{t("team.documentStatus")}</span>
            <span>{t("team.completion")}</span>
            <span>{t("team.lastUpdate")}</span>
            <span />
          </div>
          <ul aria-labelledby="team-list-title" className="divide-y divide-line">
            {view.members.map((member) => (
              <MemberRow key={member.employeeId} member={member} view={view} locale={locale} t={t} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
