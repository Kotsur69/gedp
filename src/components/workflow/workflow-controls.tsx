"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { transitionDocumentAction, type WorkflowActionErrorCode } from "@/app/[locale]/(app)/goal-centre/workflow-actions";
import { GoalActionButton } from "@/components/goals/goal-action-button";
import type { WorkflowAction } from "@/domain/document-status";

// Buttons of the document workflow (WF-01, WF-03): "Wyślij do walidacji" for the owner,
// "Zatwierdź" and "Zwróć do poprawy" for the validator. The server decides; these only ask.
// Send stays reachable while blocked (aria-disabled + described by the missing-conditions list),
// so keyboard and screen-reader users hear why. A return opens an inline form whose comment is
// required here AND on the server.

type Props = {
  documentId: number;
  actions: readonly WorkflowAction[];
  /** Closing conditions not met: the send button explains itself instead of sending. */
  isSendBlocked: boolean;
  /** id of the missing-conditions list next to the button. */
  missingListId?: string;
  commentMaxLength: number;
};

type Outcome = { kind: "done"; action: WorkflowAction } | { kind: "error"; code: WorkflowActionErrorCode } | null;
type CommentErrorCode = "COMMENT_REQUIRED" | "COMMENT_TOO_LONG";

export function WorkflowControls({ documentId, actions, isSendBlocked, missingListId, commentMaxLength }: Props) {
  const t = useTranslations("workflow");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<CommentErrorCode | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const returnToggleRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const commentId = `${formId}-comment`;
  const commentHelpId = `${formId}-help`;
  const commentErrorId = `${formId}-error`;

  function showCommentError(code: CommentErrorCode) {
    setCommentError(code);
    commentRef.current?.focus();
  }

  function submit(action: WorkflowAction, text?: string) {
    setOutcome(null);
    startTransition(async () => {
      const result = await transitionDocumentAction({ documentId, action, comment: text });
      if (result.ok) {
        setOutcome({ kind: "done", action });
        setIsReturnOpen(false);
        setComment("");
        return;
      }
      if (result.code === "COMMENT_REQUIRED" || result.code === "COMMENT_TOO_LONG") {
        showCommentError(result.code);
        return;
      }
      setOutcome({ kind: "error", code: result.code });
    });
  }

  function handleReturnSubmit() {
    const trimmed = comment.trim();
    if (trimmed === "") return showCommentError("COMMENT_REQUIRED");
    if (trimmed.length > commentMaxLength) return showCommentError("COMMENT_TOO_LONG");
    setCommentError(null);
    submit("RETURN", trimmed);
  }

  function closeReturn() {
    setIsReturnOpen(false);
    setCommentError(null);
    returnToggleRef.current?.focus();
  }

  const describedBy = commentError ? `${commentHelpId} ${commentErrorId}` : commentHelpId;

  return (
    <div className={`flex flex-col gap-4 ${actions.length > 0 || outcome ? "mt-5" : ""}`}>
      <div className={`flex flex-wrap gap-3 ${actions.length > 0 ? "" : "hidden"}`}>
        {actions.includes("SEND") && (
          <GoalActionButton
            onClick={() => {
              if (!isSendBlocked) submit("SEND");
            }}
            isBusy={isPending}
            isDisabled={isSendBlocked}
            describedBy={isSendBlocked ? missingListId : undefined}
          >
            {t("sendForValidation")}
          </GoalActionButton>
        )}
        {actions.includes("APPROVE") && (
          <GoalActionButton onClick={() => submit("APPROVE")} isBusy={isPending}>
            {t("approve")}
          </GoalActionButton>
        )}
        {actions.includes("RETURN") && (
          <button
            ref={returnToggleRef}
            type="button"
            onClick={() => (isReturnOpen ? closeReturn() : setIsReturnOpen(true))}
            aria-expanded={isReturnOpen}
            aria-controls={formId}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line-strong bg-surface px-5 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
          >
            {t("returnForCorrection")}
          </button>
        )}
      </div>

      {isReturnOpen && (
        <div id={formId} className="max-w-2xl rounded-2xl border border-line bg-canvas p-4 sm:p-5">
          <label htmlFor={commentId} className="font-semibold text-ink">
            {t("returnComment")} <span aria-hidden="true">*</span>
          </label>
          <textarea
            ref={commentRef}
            id={commentId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            required
            aria-invalid={commentError !== null}
            aria-describedby={describedBy}
            rows={4}
            maxLength={commentMaxLength}
            autoFocus
            className="mt-2 block w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-base leading-relaxed text-ink focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent/40 aria-invalid:border-danger"
          />
          <div className="mt-1.5 flex justify-between gap-3 text-sm text-ink-soft">
            <p id={commentHelpId}>{t("commentHelp")}</p>
            <p aria-hidden="true" className="shrink-0 tabular-nums">
              {t("commentCount", { count: comment.length, max: commentMaxLength })}
            </p>
          </div>
          {commentError && (
            <p id={commentErrorId} role="alert" className="mt-2 text-sm font-semibold text-danger">
              {t(`errors.${commentError}`, { max: commentMaxLength })}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <GoalActionButton variant="danger" onClick={handleReturnSubmit} isBusy={isPending}>
              {t("returnSubmit")}
            </GoalActionButton>
            <GoalActionButton variant="secondary" onClick={closeReturn}>
              {tCommon("cancel")}
            </GoalActionButton>
          </div>
        </div>
      )}

      {/* One live region for the outcome, so a send / approve / return is announced once. */}
      <p role="status" className={`text-sm font-semibold ${outcome ? "min-h-6" : ""}`}>
        {outcome?.kind === "done" && <span className="text-accent">{t(`done.${outcome.action}`)}</span>}
        {outcome?.kind === "error" && (
          <span className="text-danger">{t(`errors.${outcome.code}`, { max: commentMaxLength })}</span>
        )}
      </p>
    </div>
  );
}
