"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useTranslations } from "next-intl";
import { CorrectionReasonField } from "@/components/goals/correction-reason-field";
import { ESCAPE_OWNER_ATTRIBUTE } from "@/components/goals/date-picker";
import { GoalActionButton } from "@/components/goals/goal-action-button";
import { ChevronLeftIcon } from "@/components/shell/icons";
import {
  isHrCorrectionReasonErrorCode,
  parseHrCorrectionReason,
  type GoalEditor,
  type HrCorrectionReasonErrorCode,
} from "@/domain/hr-correction";
import type { GoalSaveMode, PerformanceGoalContext } from "@/domain/performance-goal";
import { StateBadges } from "../development/goal-summary";
import {
  cancelPerformanceGoalAction,
  correctPerformanceGoalAsHrAction,
  createPerformanceGoalAction,
  deletePerformanceGoalAction,
  updatePerformanceGoalAction,
  updatePerformanceGoalAsValidatorAction,
  type PerformanceGoalActionErrorCode,
  type PerformanceGoalActionResult,
} from "./actions";
import type { PerformanceGoalItem } from "./goal-format";
import { FIELD_ORDER, fieldId, PerformanceGoalFields } from "./performance-goal-form";
import { PerformanceGoalSummary } from "./performance-goal-summary";
import { useGoalForm } from "./use-goal-form";

// Part 2 goal window (G2-20..22, G2-25): the form for a new or edited goal with "Zamknij",
// "Zapisz i zamknij" and "Dodaj do planu" (IMG11), the read-only view, and the delete / cancel /
// discard confirmations inside the window. Display and input only: the server checks every rule
// again and refreshes the page after a change.

export type DialogTarget = { kind: "create" } | { kind: "view" | "edit" | "confirmDelete"; goalId: number };
type Mode = "view" | "edit" | "confirmDelete" | "confirmCancel" | "confirmDiscard";

const TITLE_ID = "performance-goal-dialog-title";
const ERROR_ID = "performance-goal-dialog-error";
const CONFIRM_NO_ID = "performance-goal-dialog-no";
const PLAN_HINT_ID = "performance-goal-dialog-plan-hint";
const REASON_ID = "performance-goal-dialog-reason";

/** First focus when the window opens: the form's title field, the view's heading, a confirmation's "Nie". */
export const INITIAL_FOCUS_ATTRIBUTE = "data-initial-focus";

/** Asked on Escape; returns true when the body handled it (discard question, back from a confirmation). */
type CancelRequest = () => boolean;

type DialogProps = {
  target: DialogTarget | null;
  goals: readonly PerformanceGoalItem[];
  context: PerformanceGoalContext;
  documentId: number | null;
  canChange: boolean;
  wasSent: boolean;
  /**
   * WF-04 "validator" and HR-07 "hr" edit content only (no plan or cancel buttons); "hr" also asks
   * for the required correction reason.
   */
  editor?: GoalEditor;
  onClosed: () => void;
};

export function PerformanceGoalDialog({ target, onClosed, ...rest }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRequestRef = useRef<CancelRequest | null>(null);
  // A goal that disappeared (deleted, refreshed from another tab) closes the window.
  const activeTarget =
    target && (target.kind === "create" || rest.goals.some((goal) => goal.id === target.goalId)) ? target : null;

  // Syncs the native <dialog> (an external DOM API) with the target chosen by the list.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activeTarget && !dialog.open) {
      dialog.showModal();
      // showModal() picks its own first focus; the body marks the element it should start on.
      dialog.querySelector<HTMLElement>(`[${INITIAL_FOCUS_ATTRIBUTE}]`)?.focus();
    }
    if (!activeTarget && dialog.open) dialog.close();
  }, [activeTarget]);

  // Escape is handled here on keydown, so every mode decides what it means (a repeated Escape may
  // fire a "cancel" the page cannot prevent). Popups stop their own Escape before it gets here.
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (!cancelRequestRef.current?.()) dialogRef.current?.close();
  };
  // Fallback for close requests that are not a key press (e.g. the Android back gesture).
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    const isInPopup = document.activeElement?.closest(`[${ESCAPE_OWNER_ATTRIBUTE}]`);
    if (isInPopup || cancelRequestRef.current?.()) event.preventDefault();
  };

  const targetKey = activeTarget
    ? activeTarget.kind === "create"
      ? "create"
      : `${activeTarget.kind}-${activeTarget.goalId}`
    : "none";
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={TITLE_ID}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClose={onClosed}
      className="m-auto max-h-[94dvh] w-[min(100%-2rem,64rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
    >
      {activeTarget && (
        <DialogBody
          key={targetKey}
          target={activeTarget}
          cancelRequestRef={cancelRequestRef}
          requestClose={() => dialogRef.current?.close()}
          {...rest}
        />
      )}
    </dialog>
  );
}

type BodyProps = Omit<DialogProps, "target" | "onClosed"> & {
  target: DialogTarget;
  cancelRequestRef: RefObject<CancelRequest | null>;
  requestClose: () => void;
};

function DialogBody(props: BodyProps) {
  const { target, goals, context, documentId, canChange, wasSent, editor = "owner", cancelRequestRef, requestClose } = props;
  const isValidator = editor === "validator";
  const isHr = editor === "hr";
  const t = useTranslations("performanceGoals");
  const tCentre = useTranslations("goalCentre");
  const tCommon = useTranslations("common");
  const goal = target.kind === "create" ? null : (goals.find((candidate) => candidate.id === target.goalId) ?? null);
  const [mode, setMode] = useState<Mode>(target.kind === "create" ? "edit" : target.kind);
  const form = useGoalForm(goal, goals, context);
  const [actionError, setActionError] = useState<PerformanceGoalActionErrorCode | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<HrCorrectionReasonErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();
  // Element to focus after the next commit in which nothing is pending (fields are disabled while a
  // save runs, and focusing a disabled control does nothing).
  const focusRequestRef = useRef<string | null>(null);
  const isDirty = mode === "edit" && (form.isDirty || reason.trim() !== "");

  useEffect(() => {
    if (isPending || !focusRequestRef.current) return;
    document.getElementById(focusRequestRef.current)?.focus();
    focusRequestRef.current = null;
  });

  // Escape: unsaved edits ask first, like "Zamknij"; on a confirmation it means "Nie".
  useEffect(() => {
    cancelRequestRef.current = () => {
      if (mode === "confirmDiscard") {
        focusRequestRef.current = fieldId(FIELD_ORDER[0]);
        setMode("edit");
        return true;
      }
      if (mode === "confirmCancel") {
        focusRequestRef.current = TITLE_ID;
        setMode("view");
        return true;
      }
      if (!isDirty) return false;
      focusRequestRef.current = CONFIRM_NO_ID;
      setMode("confirmDiscard");
      return true;
    };
    return () => {
      cancelRequestRef.current = null;
    };
  }, [isDirty, mode, cancelRequestRef]);

  const switchMode = (next: Mode, focusId: string) => {
    focusRequestRef.current = focusId;
    setMode(next);
  };

  const run = (action: () => Promise<PerformanceGoalActionResult>) => {
    setActionError(null);
    startTransition(async () => {
      let result: PerformanceGoalActionResult;
      try {
        result = await action();
      } catch {
        // Network failure or a server error outside the action's own handling: show it inline.
        setActionError("FAILED");
        focusRequestRef.current = ERROR_ID;
        return;
      }
      if (result.ok) return requestClose();
      if (isHrCorrectionReasonErrorCode(result.code)) {
        setReasonError(result.code);
        focusRequestRef.current = REASON_ID;
        return;
      }
      setActionError(result.code);
      const first = form.showServerErrors(result.fieldErrors);
      focusRequestRef.current = first ? fieldId(first) : ERROR_ID;
    });
  };

  const handleSave = (requested: GoalSaveMode) => {
    if (documentId === null || isPending) return;
    // A goal already in the plan stays there, so its save is checked like "Dodaj do planu".
    const saveMode: GoalSaveMode = goal?.state === "W_PLANIE" ? "PLAN" : requested;
    const firstInvalid = form.checkSave(saveMode);
    // HR-07: the reason is checked in the same pass, so both kinds of errors show at once.
    const parsedReason = isHr ? parseHrCorrectionReason(reason) : null;
    setReasonError(parsedReason && !parsedReason.ok ? parsedReason.code : null);
    const firstInvalidId = firstInvalid ? fieldId(firstInvalid) : parsedReason && !parsedReason.ok ? REASON_ID : null;
    if (firstInvalidId) {
      // Nothing is pending, so the control is enabled and can take focus right away.
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    const payload = form.payload;
    run(() => {
      // HR-07: content only, like WF-04, with the required reason.
      if (goal && parsedReason?.ok) {
        return correctPerformanceGoalAsHrAction({ goalId: goal.id, goal: payload, reason: parsedReason.reason });
      }
      // WF-04: the validator's save never changes the goal's state, so it sends no mode.
      if (goal && isValidator) return updatePerformanceGoalAsValidatorAction({ goalId: goal.id, goal: payload });
      return goal
        ? updatePerformanceGoalAction({ goalId: goal.id, mode: saveMode, goal: payload })
        : createPerformanceGoalAction({ documentId, mode: saveMode, goal: payload });
    });
  };

  /** "Zamknij": with unsaved changes it asks first (G2-20). */
  const handleClose = () => {
    if (isPending) return;
    if (isDirty) return switchMode("confirmDiscard", CONFIRM_NO_ID);
    requestClose();
  };

  // Edit starts from the goal as it is now, not as it was when the window opened.
  const handleEdit = () => {
    form.reset(goal);
    switchMode("edit", fieldId(FIELD_ORDER[0]));
  };

  const handleConfirm = () => {
    if (!goal || isPending) return;
    run(() =>
      mode === "confirmDelete"
        ? deletePerformanceGoalAction({ goalId: goal.id })
        : cancelPerformanceGoalAction({ goalId: goal.id }),
    );
  };

  const handleConfirmNo = () => {
    if (isPending) return;
    if (mode === "confirmDelete") return requestClose();
    if (mode === "confirmDiscard") return switchMode("edit", fieldId(FIELD_ORDER[0]));
    switchMode("view", TITLE_ID);
  };

  const heading = goal ? goal.title : t("newGoal");
  const mayChange = canChange && documentId !== null && goal?.state !== "ANULOWANY";
  const isInPlan = goal?.state === "W_PLANIE";
  // The validator and HR only change content: no "Dodaj do planu", no "Anuluj cel".
  const isContentOnly = editor !== "owner";
  const mayAddToPlan = !isInPlan && !isContentOnly;
  const showPlanHint = mode === "edit" && mayAddToPlan && !form.canAddToPlan;
  const confirmText = {
    confirmDelete: tCentre("deleteConfirm"),
    confirmCancel: tCentre("cancelConfirm"),
    confirmDiscard: tCentre("unsavedChanges"),
  };
  const confirmYes = {
    confirmDelete: tCentre("deleteGoal"),
    confirmCancel: tCentre("cancelGoal"),
    confirmDiscard: tCommon("yes"),
  };

  return (
    <div className="flex max-h-[94dvh] flex-col">
      <header className="border-b border-line px-6 pt-6 pb-4 sm:px-8">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">{t("sectionTitle")}</p>
        <h2
          id={TITLE_ID}
          tabIndex={-1}
          {...(mode === "view" ? { [INITIAL_FOCUS_ATTRIBUTE]: "" } : {})}
          className="mt-1 text-xl font-semibold text-balance break-words focus:outline-none sm:text-2xl"
        >
          {heading}
        </h2>
        {goal && <StateBadges goal={goal} />}
      </header>

      <div className="overflow-y-auto px-6 py-6 sm:px-8">
        {mode === "edit" && (
          <PerformanceGoalFields
            values={form.values}
            onChange={form.change}
            onBlurField={form.touch}
            errors={form.errors}
            context={context}
            planWeight={form.planWeight}
            isPending={isPending}
          />
        )}
        {mode === "edit" && isHr && (
          <CorrectionReasonField
            id={REASON_ID}
            value={reason}
            onChange={setReason}
            error={reasonError}
            isPending={isPending}
          />
        )}
        {mode !== "edit" && goal && <PerformanceGoalSummary goal={goal} context={context} />}
        {mode !== "view" && mode !== "edit" && (
          <p role="alert" className="mt-6 rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
            {confirmText[mode]}
          </p>
        )}
        {actionError && (
          <p id={ERROR_ID} role="alert" tabIndex={-1} className="mt-4 text-sm font-semibold text-danger focus:outline-none">
            {isValidator && actionError === "NOT_EDITABLE"
              ? t("actionErrors.VALIDATOR_NOT_EDITABLE")
              : t(`actionErrors.${actionErrorKey(actionError)}`)}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">
        {showPlanHint && (
          <p id={PLAN_HINT_ID} className="mr-auto max-w-sm text-sm text-ink-soft">
            {t("addToPlanBlocked")}
          </p>
        )}
        {mode === "view" && (
          <>
            {mayChange && wasSent && !isContentOnly && (
              <GoalActionButton variant="danger" onClick={() => switchMode("confirmCancel", CONFIRM_NO_ID)}>
                {tCentre("cancelGoal")}
              </GoalActionButton>
            )}
            <GoalActionButton variant="secondary" onClick={requestClose}>
              {tCommon("close")}
            </GoalActionButton>
            {mayChange && <GoalActionButton onClick={handleEdit}>{tCommon("edit")}</GoalActionButton>}
          </>
        )}
        {mode === "edit" && (
          <>
            <GoalActionButton variant="secondary" onClick={handleClose} isBusy={isPending}>
              <ChevronLeftIcon className="size-4" />
              {tCommon("close")}
            </GoalActionButton>
            <GoalActionButton
              variant={mayAddToPlan ? "secondary" : "primary"}
              onClick={() => handleSave("DRAFT")}
              isBusy={isPending}
            >
              {isPending ? t("saving") : tCentre("saveAndClose")}
            </GoalActionButton>
            {mayAddToPlan && (
              <GoalActionButton
                onClick={() => handleSave("PLAN")}
                isBusy={isPending}
                isDisabled={!form.canAddToPlan}
                describedBy={showPlanHint ? PLAN_HINT_ID : undefined}
              >
                {tCentre("addToPlan")}
              </GoalActionButton>
            )}
          </>
        )}
        {mode !== "view" && mode !== "edit" && (
          <>
            <GoalActionButton
              id={CONFIRM_NO_ID}
              variant="secondary"
              onClick={handleConfirmNo}
              isBusy={isPending}
              isInitialFocus
            >
              {tCommon("no")}
            </GoalActionButton>
            <GoalActionButton
              variant="danger"
              onClick={mode === "confirmDiscard" ? requestClose : handleConfirm}
              isBusy={isPending}
            >
              {confirmYes[mode]}
            </GoalActionButton>
          </>
        )}
      </footer>
    </div>
  );
}

const ACTION_ERROR_KEYS = [
  "NOT_EDITABLE",
  "GOAL_CANCELLED",
  "DOCUMENT_ALREADY_SENT",
  "DOCUMENT_NOT_SENT",
  "TOO_MANY_GOALS",
  "NOTHING_TO_COPY",
  "DEFAULT_TARGET_TYPE_MISSING",
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAILED",
] as const;
export type ActionErrorKey = (typeof ACTION_ERROR_KEYS)[number];

/** Field-level codes are shown under the fields; the banner then says "correct the highlighted fields". */
export function actionErrorKey(code: PerformanceGoalActionErrorCode): ActionErrorKey {
  return (ACTION_ERROR_KEYS as readonly string[]).includes(code) ? (code as ActionErrorKey) : "INVALID_INPUT";
}
