"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { InfoIcon } from "@/components/shell/icons";
import { revertTargets } from "@/domain/document-status";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { AdminDocumentItem, PersonRef } from "@/server/document-admin";
import { RevertStatusDialog, StatusBadge, type RevertOutcome } from "./revert-status-dialog";

// Document list of the HR panel (WF-08, WF-09): status and who validates each document, with
// "Cofnij status" per row. Display only: the page loads the rows (HR checked there) and the Server
// Action re-checks everything on save.

const CELL = "border-b border-line px-3 py-3 align-top";
const HEAD =
  "border-b border-line-strong px-3 py-2 text-left text-xs font-semibold tracking-[0.06em] text-ink-soft uppercase";

type DocumentTableProps = {
  items: readonly AdminDocumentItem[];
  year: number;
  /** False in a cycle that is not open: statuses are view only. */
  canRevert: boolean;
};

export function DocumentTable({ items, year, canRevert }: DocumentTableProps) {
  const t = useTranslations("admin.documents");
  const tStatus = useTranslations("glossary.documentStatus");
  const [revertedId, setRevertedId] = useState<number | null>(null);
  const [status, setStatus] = useState<{ message: string; isNotice: boolean } | null>(null);
  const reverted = items.find((item) => item.documentId === revertedId) ?? null;

  const handleReverted = ({ name, from, to }: RevertOutcome) => {
    setStatus({ message: t("revert.done", { name, from: tStatus(from), to: tStatus(to) }), isNotice: false });
  };

  // Always mounted, so the outcome is announced even when a status filter hides the row afterwards.
  const statusRegion = (
    <p
      role="status"
      aria-live="polite"
      className={`mt-2 min-h-6 text-sm font-semibold ${status?.isNotice ? "text-notice" : "text-accent"}`}
    >
      {status?.message}
    </p>
  );

  if (items.length === 0) {
    return (
      <>
        {statusRegion}
        <p className="mt-2 rounded-2xl border border-dashed border-line-strong p-6 text-ink-soft">{t("empty")}</p>
      </>
    );
  }

  return (
    <>
      {statusRegion}
      <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">{t("tableCaption", { year })}</caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD}>
                {t("employee")}
              </th>
              <th scope="col" className={HEAD}>
                {t("validators")}
              </th>
              <th scope="col" className={HEAD}>
                {t("status")}
              </th>
              <th scope="col" className={HEAD}>
                {t("lastChange")}
              </th>
              {canRevert && (
                <th scope="col" className={HEAD}>
                  <span className="sr-only">{t("actions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <DocumentRow
                key={item.documentId}
                item={item}
                canRevert={canRevert}
                onRevert={() => {
                  setStatus(null);
                  setRevertedId(item.documentId);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      {canRevert && (
        <RevertStatusDialog
          document={reverted}
          onClosed={() => setRevertedId(null)}
          onReverted={handleReverted}
          onStale={(message) => setStatus({ message, isNotice: true })}
        />
      )}
    </>
  );
}

type DocumentRowProps = { item: AdminDocumentItem; canRevert: boolean; onRevert: () => void };

function DocumentRow({ item, canRevert, onRevert }: DocumentRowProps) {
  const t = useTranslations("admin.documents");
  const tStatus = useTranslations("glossary.documentStatus");
  const locale = useLocale() as Locale;
  const hasEarlierStatus = revertTargets(item.status).length > 0;
  return (
    <tr className="transition-colors duration-150 hover:bg-canvas motion-reduce:transition-none">
      <th scope="row" className={`${CELL} text-left font-normal`}>
        <span className={`block font-semibold ${item.isActive ? "text-ink" : "text-ink-soft"}`}>{item.employeeName}</span>
        <span className="block text-ink-soft tabular-nums">
          {item.amei}
          {item.department && ` · ${item.department}`}
        </span>
      </th>
      <td className={`${CELL} text-ink`}>
        <Validators manager={item.manager} override={item.validatorOverride} />
      </td>
      <td className={CELL}>
        <StatusBadge status={item.status} label={tStatus(item.status)} />
      </td>
      <td className={`${CELL} text-ink-soft tabular-nums`}>{formatDate(item.updatedAt, locale)}</td>
      {canRevert && (
        <td className={`${CELL} text-right`}>
          {hasEarlierStatus ? (
            <button
              type="button"
              onClick={onRevert}
              aria-label={t("revertFor", { name: item.employeeName })}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line-strong bg-surface px-4 font-semibold whitespace-nowrap text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
            >
              {t("revert.submit")}
            </button>
          ) : (
            <span className="text-ink-soft">{t("noEarlier")}</span>
          )}
        </td>
      )}
    </tr>
  );
}

/** N+1 and the WF-09 override; with neither, nobody can validate the document - said in text. */
function Validators({ manager, override }: { manager: PersonRef | null; override: PersonRef | null }) {
  const t = useTranslations("admin");
  if (!manager && !override) {
    return (
      <span className="inline-flex items-start gap-1 rounded-lg bg-notice-surface px-2 py-1 text-xs font-semibold text-notice">
        <InfoIcon className="mt-px size-3.5 shrink-0" />
        {t("employees.noValidator")}
      </span>
    );
  }
  return (
    <dl className="grid gap-1">
      {manager && <Person label={t("documents.managerLabel")} person={manager} />}
      {override && <Person label={t("employees.overrideLabel")} person={override} isOverride />}
    </dl>
  );
}

function Person({ label, person, isOverride = false }: { label: string; person: PersonRef; isOverride?: boolean }) {
  return (
    <div className={isOverride ? "border-l-2 border-accent/50 pl-2" : undefined}>
      <dt className={`text-xs font-semibold tracking-[0.04em] ${isOverride ? "text-accent" : "text-ink-soft"}`}>{label}</dt>
      <dd>
        {person.name} <span className="text-ink-soft tabular-nums">({person.amei})</span>
      </dd>
    </div>
  );
}
