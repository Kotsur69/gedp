"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CorrectionReasonField } from "@/components/goals/correction-reason-field";
import { GoalActionButton } from "@/components/goals/goal-action-button";
import { describedControl, GOAL_CONTROL_CLASSES, GoalField } from "@/components/goals/goal-field";
import { PencilIcon } from "@/components/shell/icons";
import {
  isHrCorrectionReasonErrorCode,
  parseHrCorrectionReason,
  type HrCorrectionReasonErrorCode,
} from "@/domain/hr-correction";
import { correctBhpCommitmentAction, type BhpCorrectionErrorCode } from "./actions";

// HR-07, Part 1: HR corrects the text of the employee's saved BHP commitment. A pencil on the
// review row opens a window with the text and the required reason. Display and input only: the
// server checks HR, the reason and the commitment again and refreshes the page after the save.

const TITLE_ID = "bhp-correction-title";
const COMMITMENT_ID = "bhp-correction-commitment";
const REASON_ID = "bhp-correction-reason";
const ERROR_ID = "bhp-correction-error";

type BhpCorrectionProps = {
  documentId: number;
  templateId: number;
  commitment: string;
  maxLength: number;
};

export function BhpCorrection({ documentId, templateId, commitment, maxLength }: BhpCorrectionProps) {
  const t = useTranslations("hrCorrection");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  // Set by the form's own close (after a save). The close event fires while the transition is still
  // pending, so pendingRef alone would reopen a window the form just closed (as in the revert window).
  const isCloseRequestedRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleClose = () => {
    const isRequested = isCloseRequestedRef.current;
    isCloseRequestedRef.current = false;
    // Any other close while a save runs (a repeated Escape): reopen, the result would be lost.
    if (!isRequested && pendingRef.current) return dialogRef.current?.showModal();
    setIsOpen(false);
  };

  // Syncs the native <dialog> (an external DOM API) with the open state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={t("editCommitment")}
        title={t("editCommitment")}
        aria-haspopup="dialog"
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-soft transition-colors duration-200 hover:bg-accent/10 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
      >
        <PencilIcon className="size-4" />
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={TITLE_ID}
        // Escape must not close the window while a save is running: its result would be lost.
        onCancel={(event) => pendingRef.current && event.preventDefault()}
        onClose={handleClose}
        className="m-auto max-h-[92dvh] w-[min(100%-2rem,40rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        {isOpen && (
          <CorrectionForm
            documentId={documentId}
            templateId={templateId}
            initialCommitment={commitment}
            maxLength={maxLength}
            pendingRef={pendingRef}
            requestClose={() => {
              const dialog = dialogRef.current;
              // Already closed (e.g. a forced Escape): no close event will come to consume the flag.
              if (!dialog?.open) return;
              isCloseRequestedRef.current = true;
              dialog.close();
            }}
          />
        )}
      </dialog>
    </>
  );
}

type CorrectionFormProps = {
  documentId: number;
  templateId: number;
  initialCommitment: string;
  maxLength: number;
  pendingRef: { current: boolean };
  requestClose: () => void;
};

function CorrectionForm(props: CorrectionFormProps) {
  const { documentId, templateId, initialCommitment, maxLength, pendingRef, requestClose } = props;
  const t = useTranslations("hrCorrection");
  const tCommon = useTranslations("common");
  const [commitment, setCommitment] = useState(initialCommitment);
  const [reason, setReason] = useState("");
  const [commitmentError, setCommitmentError] = useState<"COMMITMENT_REQUIRED" | "COMMITMENT_TOO_LONG" | null>(null);
  const [reasonError, setReasonError] = useState<HrCorrectionReasonErrorCode | null>(null);
  const [error, setError] = useState<BhpCorrectionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();
  const focusRequestRef = useRef<string | null>(null);

  // Focus after the commit in which nothing is pending (disabled controls cannot take focus).
  useEffect(() => {
    pendingRef.current = isPending;
    if (isPending || !focusRequestRef.current) return;
    document.getElementById(focusRequestRef.current)?.focus();
    focusRequestRef.current = null;
  });

  const showResultError = (code: BhpCorrectionErrorCode) => {
    if (isHrCorrectionReasonErrorCode(code)) {
      setReasonError(code);
      focusRequestRef.current = REASON_ID;
    } else if (code === "COMMITMENT_REQUIRED" || code === "COMMITMENT_TOO_LONG") {
      setCommitmentError(code);
      focusRequestRef.current = COMMITMENT_ID;
    } else {
      setError(code);
      focusRequestRef.current = ERROR_ID;
    }
  };

  const handleSave = () => {
    if (isPending) return;
    const trimmed = commitment.trim();
    const localCommitmentError =
      trimmed === "" ? "COMMITMENT_REQUIRED" : trimmed.length > maxLength ? "COMMITMENT_TOO_LONG" : null;
    const parsedReason = parseHrCorrectionReason(reason);
    setCommitmentError(localCommitmentError);
    setReasonError(parsedReason.ok ? null : parsedReason.code);
    setError(null);
    if (localCommitmentError) return document.getElementById(COMMITMENT_ID)?.focus();
    if (!parsedReason.ok) return document.getElementById(REASON_ID)?.focus();

    startTransition(async () => {
      try {
        const result = await correctBhpCommitmentAction({
          documentId,
          templateId,
          commitment: trimmed,
          reason: parsedReason.reason,
        });
        if (result.ok) return requestClose();
        showResultError(result.code);
      } catch {
        // Network failure or a server error outside the action's own handling.
        showResultError("FAILED");
      }
    });
  };

  const errorText = error ? t(`bhpErrors.${bannerKey(error)}`) : null;
  const commitmentErrorText = commitmentError ? t(`bhpErrors.${commitmentError}`, { max: maxLength }) : null;

  return (
    <div className="flex max-h-[92dvh] flex-col">
      <header className="border-b border-line px-6 pt-6 pb-4 sm:px-8">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">{t("modeBadge")}</p>
        <h2 id={TITLE_ID} className="mt-1 text-xl font-semibold text-balance sm:text-2xl">
          {t("bhpTitle")}
        </h2>
      </header>

      <div className="overflow-y-auto px-6 py-5 sm:px-8">
        <GoalField
          id={COMMITMENT_ID}
          label={t("bhpLabel")}
          hint={t("bhpHint", { count: commitment.trim().length, max: maxLength })}
          error={commitmentErrorText}
          requiredText={t("required")}
        >
          <textarea
            {...describedControl(COMMITMENT_ID, commitmentError !== null)}
            value={commitment}
            onChange={(event) => setCommitment(event.target.value)}
            disabled={isPending}
            required
            // showModal() moves focus to the element marked autofocus.
            autoFocus
            rows={5}
            maxLength={maxLength + 1}
            className={`${GOAL_CONTROL_CLASSES} resize-y`}
          />
        </GoalField>
        <CorrectionReasonField id={REASON_ID} value={reason} onChange={setReason} error={reasonError} isPending={isPending} />
        {errorText && (
          <p id={ERROR_ID} role="alert" tabIndex={-1} className="mt-4 text-sm font-semibold text-danger focus:outline-none">
            {errorText}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">
        <GoalActionButton variant="secondary" onClick={() => !isPending && requestClose()} isBusy={isPending}>
          {tCommon("cancel")}
        </GoalActionButton>
        <GoalActionButton onClick={handleSave} isBusy={isPending}>
          {isPending ? t("saving") : t("save")}
        </GoalActionButton>
      </footer>
    </div>
  );
}

const BANNER_KEYS = ["NOT_ACKNOWLEDGED", "FORBIDDEN", "FAILED"] as const;
type BannerKey = (typeof BANNER_KEYS)[number] | "INVALID_INPUT";

/** Codes without a message of their own (wrong template, malformed payload) read "refresh and retry". */
function bannerKey(code: BhpCorrectionErrorCode): BannerKey {
  return (BANNER_KEYS as readonly string[]).includes(code) ? (code as BannerKey) : "INVALID_INPUT";
}
