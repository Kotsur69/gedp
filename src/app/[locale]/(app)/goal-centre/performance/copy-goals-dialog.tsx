"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { GoalActionButton } from "@/components/goals/goal-action-button";
import { CopyIcon } from "@/components/shell/icons";
import { copyPerformanceGoalsAction, type PerformanceGoalActionErrorCode } from "./actions";
import { actionErrorKey } from "./performance-goal-dialog";

// G2-06 confirmation: says how many of last year's goals will be added as drafts before copying.
// With nothing to copy it says so and offers only "Zamknij".

type CopyGoalsDialogProps = {
  isOpen: boolean;
  documentId: number;
  previousYear: number;
  count: number;
  onClosed: () => void;
};

const TITLE_ID = "copy-goals-dialog-title";
const ERROR_ID = "copy-goals-dialog-error";

export function CopyGoalsDialog({ isOpen, documentId, previousYear, count, onClosed }: CopyGoalsDialogProps) {
  const t = useTranslations("performanceGoals");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<PerformanceGoalActionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();

  // Syncs the native <dialog> (an external DOM API) with the list's state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  // A refused copy moves focus to the message, so screen readers and keyboard users find it.
  useEffect(() => {
    if (error && !isPending) document.getElementById(ERROR_ID)?.focus();
  }, [error, isPending]);

  const close = () => dialogRef.current?.close();
  const handleCopy = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await copyPerformanceGoalsAction({ documentId });
        if (result.ok) return close();
        setError(result.code);
      } catch {
        setError("FAILED");
      }
    });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={TITLE_ID}
      onClose={() => {
        setError(null);
        onClosed();
      }}
      className="m-auto w-[min(100%-2rem,32rem)] rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 px-6 pt-6 pb-2 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-(image:--am-gradient) text-on-brand">
            <CopyIcon className="size-5" />
          </span>
          <h2 id={TITLE_ID} className="text-xl font-semibold text-balance">
            {t("copyTitle", { year: previousYear })}
          </h2>
        </div>
        <p className="leading-relaxed text-ink-soft">
          {count > 0 ? t("copyConfirm", { count, year: previousYear }) : t("copyNothing", { year: previousYear })}
        </p>
        {error && (
          <p id={ERROR_ID} role="alert" tabIndex={-1} className="text-sm font-semibold text-danger focus:outline-none">
            {t(`actionErrors.${actionErrorKey(error)}`)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-3 px-6 py-4 sm:px-8">
        <GoalActionButton variant="secondary" onClick={close} isBusy={isPending}>
          {count > 0 ? tCommon("no") : tCommon("close")}
        </GoalActionButton>
        {count > 0 && (
          <GoalActionButton onClick={handleCopy} isBusy={isPending}>
            {isPending ? t("copying") : t("copyAction")}
          </GoalActionButton>
        )}
      </div>
    </dialog>
  );
}
