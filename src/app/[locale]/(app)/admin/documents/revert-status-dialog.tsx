"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { DOCUMENT_STATUS_TONE } from "@/components/workflow/status-tone";
import { revertTargets, WORKFLOW_COMMENT_MAX_LENGTH, type DocumentStatusValue } from "@/domain/document-status";
import type { AdminDocumentItem } from "@/server/document-admin";
import { revertDocumentStatusAction, type RevertActionErrorCode } from "./actions";

// "Cofnij status" window (WF-08): HR picks an EARLIER status (only those are offered, from the same
// table the server enforces) and must give a reason. The server re-checks everything: HR, the
// direction, that the document is still in the status shown here, the open cycle.

export type RevertOutcome = { name: string; from: DocumentStatusValue; to: DocumentStatusValue };

const TITLE_ID = "revert-status-title";
const REASON_ID = "revert-status-reason";
const ERROR_ID = "revert-status-error";

/**
 * The status shown here is no longer true (actions.ts refreshes the list for these). The window
 * closes and the table announces why, so the message survives the refresh - also when a status
 * filter drops the row from the list.
 */
const STALE_CODES: ReadonlySet<RevertActionErrorCode> = new Set(["STATUS_CHANGED", "CYCLE_NOT_OPEN", "ILLEGAL_TRANSITION"]);

type RevertStatusDialogProps = {
  document: AdminDocumentItem | null;
  onClosed: () => void;
  onReverted: (outcome: RevertOutcome) => void;
  /** Called with the message when the window closes because the list was out of date. */
  onStale: (message: string) => void;
};

export function RevertStatusDialog({ document, onClosed, onReverted, onStale }: RevertStatusDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  // Set by the form's own close (after a save or a stale result). The close event fires after
  // dialog.close() returns, and the still-pending transition re-renders the form in between, which
  // sets pendingRef back to true - so pendingRef alone would reopen a window the form just closed.
  const isCloseRequestedRef = useRef(false);

  const handleClose = () => {
    const isRequested = isCloseRequestedRef.current;
    isCloseRequestedRef.current = false;
    // Any other close while a save runs (e.g. a repeated Escape): reopen, the result would be lost.
    if (!isRequested && pendingRef.current && document) return dialogRef.current?.showModal();
    onClosed();
  };

  // Syncs the native <dialog> (an external DOM API) with the document chosen in the table.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (document && !dialog.open) {
      isCloseRequestedRef.current = false;
      dialog.showModal();
    }
    if (!document && dialog.open) dialog.close();
  }, [document]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={TITLE_ID}
      // Escape must not close the window while a save is running: its result would be lost.
      onCancel={(event) => pendingRef.current && event.preventDefault()}
      onClose={handleClose}
      className="m-auto max-h-[92dvh] w-[min(100%-2rem,36rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
    >
      {document && (
        <RevertForm
          key={document.documentId}
          document={document}
          pendingRef={pendingRef}
          requestClose={() => {
            const dialog = dialogRef.current;
            // Already closed (e.g. a forced Escape): no close event will come to consume the flag.
            if (!dialog?.open) return;
            isCloseRequestedRef.current = true;
            dialog.close();
          }}
          onReverted={onReverted}
          onStale={onStale}
        />
      )}
    </dialog>
  );
}

type RevertFormProps = {
  document: AdminDocumentItem;
  pendingRef: { current: boolean };
  requestClose: () => void;
  onReverted: (outcome: RevertOutcome) => void;
  onStale: (message: string) => void;
};

function RevertForm({ document, pendingRef, requestClose, onReverted, onStale }: RevertFormProps) {
  const t = useTranslations("admin.documents");
  const tWorkflow = useTranslations("workflow");
  const tStatus = useTranslations("glossary.documentStatus");
  const tCommon = useTranslations("common");
  // The status the window was opened for: a refreshed list must not change what HR confirms.
  const [from] = useState(document.status);
  const targets = revertTargets(from);
  const [to, setTo] = useState<DocumentStatusValue | undefined>(targets[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<RevertActionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();
  const focusRequestRef = useRef<string | null>(null);
  const isReasonError = error === "REASON_REQUIRED" || error === "COMMENT_TOO_LONG";

  useEffect(() => {
    pendingRef.current = isPending;
    if (isPending || !focusRequestRef.current) return;
    window.document.getElementById(focusRequestRef.current)?.focus();
    focusRequestRef.current = null;
  });

  const showError = (code: RevertActionErrorCode) => {
    setError(code);
    focusRequestRef.current = code === "REASON_REQUIRED" || code === "COMMENT_TOO_LONG" ? REASON_ID : ERROR_ID;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending || !to) return;
    const trimmed = reason.trim();
    if (trimmed === "") return showError("REASON_REQUIRED");
    if (trimmed.length > WORKFLOW_COMMENT_MAX_LENGTH) return showError("COMMENT_TOO_LONG");
    setError(null);
    startTransition(async () => {
      try {
        const result = await revertDocumentStatusAction({ documentId: document.documentId, from, to, reason: trimmed });
        if (!result.ok && STALE_CODES.has(result.code)) {
          onStale(errorText(result.code));
          return requestClose();
        }
        if (!result.ok) return showError(result.code);
        onReverted({ name: document.employeeName, from, to });
        requestClose();
      } catch {
        // Network failure or a server error outside the action's own handling.
        showError("FAILED");
      }
    });
  };

  const errorText = (code: RevertActionErrorCode) =>
    code === "COMMENT_TOO_LONG" ? tWorkflow("errors.COMMENT_TOO_LONG", { max: WORKFLOW_COMMENT_MAX_LENGTH }) : tWorkflow(`errors.${code}`);

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-h-[92dvh] flex-col">
      <header className="border-b border-line px-6 pt-6 pb-4 sm:px-8">
        <p className="text-sm font-semibold text-accent">{t("revert.title")}</p>
        <h2 id={TITLE_ID} className="mt-1 text-xl font-semibold text-balance sm:text-2xl">
          {document.employeeName}
        </h2>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-soft">{t("revert.current")}:</span>
          <StatusBadge status={from} label={tStatus(from)} />
        </p>
      </header>

      <div className="grid gap-5 overflow-y-auto px-6 py-5 sm:px-8">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">{t("revert.target")}</legend>
          <div className="mt-2 grid gap-2">
            {targets.map((status) => (
              <label
                key={status}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line-strong px-3 py-2 transition duration-200 hover:border-accent has-checked:border-accent has-checked:bg-canvas has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent/40 motion-reduce:transition-none"
              >
                <input
                  type="radio"
                  name="revert-target"
                  value={status}
                  checked={to === status}
                  onChange={() => !isPending && setTo(status)}
                  className="size-5 accent-(--color-accent)"
                />
                <StatusBadge status={status} label={tStatus(status)} />
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={REASON_ID} className="block text-sm font-semibold text-ink">
            {tWorkflow("revertReason")} <span aria-hidden="true" className="text-danger">*</span>
          </label>
          <textarea
            id={REASON_ID}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            readOnly={isPending}
            required
            rows={4}
            // One over the limit, so the form can say "too long" instead of the browser cutting silently.
            maxLength={WORKFLOW_COMMENT_MAX_LENGTH + 1}
            aria-invalid={isReasonError || undefined}
            aria-describedby={`${REASON_ID}-hint${isReasonError ? ` ${REASON_ID}-error` : ""}`}
            className="mt-1 block w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-base leading-relaxed text-ink transition duration-200 hover:border-accent read-only:bg-canvas focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent/40 aria-invalid:border-danger motion-reduce:transition-none"
          />
          <div className="mt-1 flex items-start justify-between gap-3 text-sm">
            <p id={`${REASON_ID}-hint`} className="text-ink-soft">
              {t("revert.reasonHint")}
            </p>
            <p className="shrink-0 text-ink-soft tabular-nums">
              {t("revert.count", { count: reason.trim().length, max: WORKFLOW_COMMENT_MAX_LENGTH })}
            </p>
          </div>
          {isReasonError && error && (
            <p id={`${REASON_ID}-error`} role="alert" className="mt-1 text-sm font-semibold text-danger">
              {errorText(error)}
            </p>
          )}
        </div>

        {error && !isReasonError && (
          <p
            id={ERROR_ID}
            role="alert"
            tabIndex={-1}
            className="rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-danger focus:outline-none"
          >
            {errorText(error)}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">
        <button
          type="button"
          onClick={() => !isPending && requestClose()}
          aria-disabled={isPending || undefined}
          className="min-h-11 cursor-pointer rounded-xl border border-line-strong bg-surface px-5 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none"
        >
          {tCommon("cancel")}
        </button>
        <button
          type="submit"
          aria-disabled={isPending || undefined}
          aria-busy={isPending || undefined}
          className="min-h-11 cursor-pointer rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none"
        >
          {isPending ? t("revert.saving") : t("revert.submit")}
        </button>
      </footer>
    </form>
  );
}

/** Status text always carries the meaning; the tone only reinforces it. */
export function StatusBadge({ status, label }: { status: DocumentStatusValue; label: string }) {
  return (
    <span className={`inline-block rounded-lg border px-2.5 py-0.5 text-sm font-semibold ${DOCUMENT_STATUS_TONE[status]}`}>
      {label}
    </span>
  );
}
