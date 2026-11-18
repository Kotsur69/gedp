import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { WORKFLOW_COMMENT_MAX_LENGTH, type MissingCondition } from "@/domain/document-status";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { DocumentWorkflowView, StatusHistoryEntry } from "@/server/workflow";
import { DOCUMENT_STATUS_TONE } from "./status-tone";
import { WorkflowControls } from "./workflow-controls";

// "Status dokumentu" (WF-01..06): current status, what it means for the viewer, the workflow
// buttons with the missing closing conditions next to "Wyślij do walidacji" (slide 5), and the
// status history (WF-06). Used by the owner's Goal Centre and by the validator's document view.

type Props = { workflow: DocumentWorkflowView; titleId: string };

type Translate = Awaited<ReturnType<typeof getTranslations<"workflow">>>;
type DocumentStatus = DocumentWorkflowView["status"];

function missingText(t: Translate, condition: MissingCondition): string {
  switch (condition.code) {
    case "minPerformanceGoals":
    case "minDevelopmentGoals":
      return t(`conditions.${condition.code}`, { min: condition.min });
    case "weightSum":
      return t("conditions.weightSum", { required: condition.required, current: condition.current });
    case "leadershipAcknowledged":
    case "valuesAcknowledged":
    case "safetyCommitment":
      return t(`conditions.${condition.code}`);
  }
}

/** The latest return comment, shown to the owner while the document is ZWROCONY. */
function lastReturnComment(history: readonly StatusHistoryEntry[]): string | null {
  return history.findLast((entry) => entry.toStatus === "ZWROCONY")?.comment ?? null;
}

const OWNER_NOTICE: Partial<Record<DocumentStatus, "sentNotice" | "approvedNotice" | "returnedNotice">> = {
  DO_WALIDACJI: "sentNotice",
  ZATWIERDZONY: "approvedNotice",
  ZWROCONY: "returnedNotice",
};

export async function DocumentStatusPanel({ workflow, titleId }: Props) {
  const [t, tGlossary, locale, messages] = await Promise.all([
    getTranslations("workflow"),
    getTranslations("glossary"),
    getLocale(),
    getMessages(),
  ]);
  const { status, isOwner, actions, missing, history } = workflow;
  const missingListId = `${titleId}-missing`;
  const ownerNotice = isOwner ? OWNER_NOTICE[status] : undefined;
  const returnComment = isOwner && status === "ZWROCONY" ? lastReturnComment(history) : null;
  const statusLabel = (value: DocumentStatus) => tGlossary(`documentStatus.${value}`);
  const clientMessages = { workflow: messages.workflow, common: { cancel: messages.common.cancel } };

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={titleId} className="text-2xl font-semibold text-ink">
          {t("panelTitle")}
        </h2>
        <p className={`rounded-lg border px-2.5 py-0.5 text-sm font-semibold ${DOCUMENT_STATUS_TONE[status]}`}>
          {statusLabel(status)}
        </p>
      </div>

      {ownerNotice && (
        <p className="mt-3 max-w-3xl rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
          {t(ownerNotice)}
        </p>
      )}
      {returnComment && (
        <blockquote className="mt-3 max-w-3xl rounded-xl border border-line bg-canvas px-4 py-3 leading-relaxed whitespace-pre-line text-ink">
          {t("returnedComment", { comment: returnComment })}
        </blockquote>
      )}
      {actions.includes("APPROVE") && <p className="mt-3 max-w-3xl leading-relaxed text-ink-soft">{t("validatorIntro")}</p>}

      {actions.includes("SEND") && (
        <div className="mt-4 max-w-3xl">
          <p className="leading-relaxed text-ink-soft">{t("sendHint")}</p>
          {missing.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-accent">{t("readyToSend")}</p>
          ) : (
            // Slide 5: "Brakuje: ..." next to the blocked send button, which is described by it.
            <div id={missingListId} className="mt-3 rounded-xl bg-notice-surface px-4 py-3 text-sm text-notice">
              <p className="font-semibold">{t("missing", { items: "" }).trim()}</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {missing.map((condition) => (
                  <li key={condition.code}>{missingText(t, condition)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Mounted even without buttons: after a send / approve / return the refreshed page has none,
          and the controls' live region must survive to announce the outcome. */}
      <NextIntlClientProvider messages={clientMessages}>
        <WorkflowControls
          documentId={workflow.documentId}
          actions={actions}
          isSendBlocked={missing.length > 0}
          missingListId={missing.length > 0 ? missingListId : undefined}
          commentMaxLength={WORKFLOW_COMMENT_MAX_LENGTH}
        />
      </NextIntlClientProvider>

      <StatusHistory history={history} t={t} statusLabel={statusLabel} locale={locale as Locale} headingId={`${titleId}-history`} />
    </section>
  );
}

type HistoryProps = {
  history: readonly StatusHistoryEntry[];
  t: Translate;
  statusLabel: (status: DocumentStatus) => string;
  locale: Locale;
  headingId: string;
};

/** WF-06: every status change with its author, date and comment, newest first. */
function StatusHistory({ history, t, statusLabel, locale, headingId }: HistoryProps) {
  const newestFirst = [...history].reverse();
  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-line pt-5">
      <h3 id={headingId} className="text-xs font-semibold tracking-wider text-accent uppercase">
        {t("statusHistory")}
      </h3>
      {newestFirst.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">{t("historyEmpty")}</p>
      ) : (
        <ol className="mt-3 space-y-4">
          {newestFirst.map((entry) => (
            <li key={entry.id} className="relative border-l-2 border-line-strong pl-4">
              <span aria-hidden="true" className="absolute top-1.5 -left-[5px] size-2 rounded-full bg-accent" />
              <p className="font-semibold text-ink">
                {entry.fromStatus === null
                  ? t("created")
                  : t("transition", { from: statusLabel(entry.fromStatus), to: statusLabel(entry.toStatus) })}
              </p>
              <p className="mt-0.5 text-sm text-ink-soft">
                {t("changedBy", { name: entry.authorName })} ·{" "}
                <span className="tabular-nums">{t("changedOn", { date: formatDate(entry.createdAt, locale) })}</span>
              </p>
              {entry.comment && (
                <p className="mt-1.5 max-w-3xl text-sm leading-relaxed whitespace-pre-line text-ink">
                  <span className="font-semibold">{t("comment")}:</span> {entry.comment}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
