"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  developmentGoalFieldErrors,
  developmentGoalSchema,
  type DevelopmentGoalContext,
  type GoalSaveMode,
} from "@/domain/development-goal";
import type { Locale } from "@/i18n/config";
import {
  cancelDevelopmentGoalAction,
  createDevelopmentGoalAction,
  deleteDevelopmentGoalAction,
  updateDevelopmentGoalAction,
  updateDevelopmentGoalAsValidatorAction,
  type DevelopmentGoalActionErrorCode,
  type DevelopmentGoalActionResult,
} from "./actions";
import {
  DevelopmentGoalFields,
  FIELD_ORDER,
  fieldId,
  toFormValues,
  toPayload,
  type GoalFieldErrors,
  type GoalFormValues,
} from "./development-goal-form";
import { catalogName, type DevelopmentGoalItem } from "./goal-format";
import { GoalSummary, StateBadges } from "./goal-summary";

// Part 3 goal window (G3-21, IMG17 layout): summary with "Anuluj cel" / "Zamknij" / "Edytuj", the
// form for a new or edited goal, and the delete / cancel / discard confirmations (in the window,
// not window.confirm). Display and input only: every rule is enforced again by the server, which
// refreshes the page after a change.

export type DialogTarget = { kind: "create" } | { kind: "view" | "edit" | "confirmDelete"; goalId: number };
type Mode = "view" | "edit" | "confirmDelete" | "confirmCancel" | "confirmDiscard";

const TITLE_ID = "development-goal-dialog-title";
const ERROR_ID = "development-goal-dialog-error";
const CONFIRM_NO_ID = "development-goal-dialog-no";

/** Asked on Escape; returns true when the body handled it (unsaved edits -> discard question). */
type CancelRequest = () => boolean;

type DialogProps = {
  target: DialogTarget | null;
  goals: readonly DevelopmentGoalItem[];
  context: DevelopmentGoalContext;
  documentId: number | null;
  canChange: boolean;
  wasSent: boolean;
  /** WF-04: the validator edits during validation - content only, no plan or cancel buttons. */
  isValidator?: boolean;
  onClosed: () => void;
};

export function DevelopmentGoalDialog({ target, onClosed, ...rest }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRequestRef = useRef<CancelRequest | null>(null);
  // A goal that disappeared (deleted, refreshed from another tab) closes the window instead of
  // leaving an empty modal open.
  const activeTarget =
    target && (target.kind === "create" || rest.goals.some((goal) => goal.id === target.goalId)) ? target : null;

  // Syncs the native <dialog> (an external DOM API) with the target chosen by the list.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activeTarget && !dialog.open) dialog.showModal();
    if (!activeTarget && dialog.open) dialog.close();
  }, [activeTarget]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (cancelRequestRef.current?.()) event.preventDefault();
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
      onCancel={handleCancel}
      onClose={onClosed}
      className="m-auto max-h-[92dvh] w-[min(100%-2rem,48rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
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
  const { target, goals, context, documentId, canChange, wasSent, isValidator = false, cancelRequestRef, requestClose } = props;
  const t = useTranslations("developmentGoals");
  const tCentre = useTranslations("goalCentre");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const goal = target.kind === "create" ? null : (goals.find((candidate) => candidate.id === target.goalId) ?? null);
  const [mode, setMode] = useState<Mode>(target.kind === "create" ? "edit" : target.kind);
  const [initialValues, setInitialValues] = useState(() => toFormValues(goal));
  const [values, setValues] = useState<GoalFormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<GoalFieldErrors>({});
  const [actionError, setActionError] = useState<DevelopmentGoalActionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();
  // Element to focus after the next commit in which nothing is pending (fields are disabled while a
  // save runs, and focusing a disabled control does nothing).
  const focusRequestRef = useRef<string | null>(null);

  const isDirty = mode === "edit" && JSON.stringify(values) !== JSON.stringify(initialValues);

  useEffect(() => {
    if (isPending || !focusRequestRef.current) return;
    document.getElementById(focusRequestRef.current)?.focus();
    focusRequestRef.current = null;
  });

  // Escape with unsaved edits asks inside the window (goalCentre.unsavedChanges).
  useEffect(() => {
    cancelRequestRef.current = () => {
      if (!isDirty) return false;
      focusRequestRef.current = CONFIRM_NO_ID;
      setMode("confirmDiscard");
      return true;
    };
    return () => {
      cancelRequestRef.current = null;
    };
  }, [isDirty, cancelRequestRef]);

  const switchMode = (next: Mode, focusId: string) => {
    focusRequestRef.current = focusId;
    setMode(next);
  };

  const showErrors = (errors: GoalFieldErrors, hasBanner: boolean) => {
    setFieldErrors(errors);
    const first = FIELD_ORDER.find((field) => errors[field] !== undefined);
    focusRequestRef.current = first ? fieldId(first) : hasBanner ? ERROR_ID : null;
  };

  const run = (action: () => Promise<DevelopmentGoalActionResult>) => {
    setActionError(null);
    startTransition(async () => {
      let result: DevelopmentGoalActionResult;
      try {
        result = await action();
      } catch {
        // Network failure or a server error outside the action's own handling: show it inline.
        setActionError("FAILED");
        focusRequestRef.current = ERROR_ID;
        return;
      }
      if (result.ok) return requestClose();
      setActionError(result.code);
      showErrors(result.fieldErrors, true);
    });
  };

  const handleSave = (requested: GoalSaveMode) => {
    if (documentId === null || isPending) return;
    // A goal already in the plan stays there, so its save is checked like "Dodaj do planu".
    const saveMode: GoalSaveMode = goal?.state === "W_PLANIE" ? "PLAN" : requested;
    const payload = toPayload(values);
    // Quick feedback with the same schema the server runs again.
    const parsed = developmentGoalSchema(saveMode, context).safeParse(payload);
    if (!parsed.success) return showErrors(developmentGoalFieldErrors(parsed.error), false);
    setFieldErrors({});
    run(() => {
      // WF-04: the validator's save never changes the goal's state, so it sends no mode.
      if (goal && isValidator) return updateDevelopmentGoalAsValidatorAction({ goalId: goal.id, goal: payload });
      return goal
        ? updateDevelopmentGoalAction({ goalId: goal.id, mode: saveMode, goal: payload })
        : createDevelopmentGoalAction({ documentId, mode: saveMode, goal: payload });
    });
  };

  // Edit starts from the goal as it is now, not as it was when the window opened.
  const handleEdit = () => {
    const fresh = toFormValues(goal);
    setInitialValues(fresh);
    setValues(fresh);
    switchMode("edit", fieldId(FIELD_ORDER[0]));
  };

  const handleCancelEdit = () => {
    if (isPending) return;
    if (!goal) return requestClose();
    setValues(initialValues);
    setFieldErrors({});
    setActionError(null);
    switchMode("view", TITLE_ID);
  };

  const handleConfirm = () => {
    if (!goal || isPending) return;
    run(() =>
      mode === "confirmDelete"
        ? deleteDevelopmentGoalAction({ goalId: goal.id })
        : cancelDevelopmentGoalAction({ goalId: goal.id }),
    );
  };

  const handleConfirmNo = () => {
    if (isPending) return;
    if (mode === "confirmDelete") return requestClose();
    if (mode === "confirmDiscard") return switchMode("edit", fieldId(FIELD_ORDER[0]));
    switchMode("view", TITLE_ID);
  };

  const competency = goal ? catalogName(context.competencies, goal.competencyId, locale) : null;
  const area = goal ? catalogName(context.developmentAreas, goal.developmentAreaId, locale) : null;
  const heading = goal ? (competency ?? t("noCompetency")) : t("newGoal");
  const errorKey: ActionErrorKey = actionError && isActionErrorKey(actionError) ? actionError : "INVALID_INPUT";
  const mayChange = canChange && documentId !== null && goal?.state !== "ANULOWANY";
  // The validator only changes content: no "Dodaj do planu", no "Anuluj cel".
  const mayAddToPlan = goal?.state !== "W_PLANIE" && !isValidator;
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
    <div className="flex max-h-[92dvh] flex-col">
      <header className="border-b border-line px-6 pt-6 pb-4 sm:px-8">
        <h2 id={TITLE_ID} tabIndex={-1} className="text-xl font-semibold text-balance focus:outline-none sm:text-2xl">
          {heading}
        </h2>
        {goal && <StateBadges goal={goal} />}
      </header>

      <div className="overflow-y-auto px-6 py-5 sm:px-8">
        {mode === "edit" && (
          <DevelopmentGoalFields
            values={values}
            onChange={setValues}
            errors={fieldErrors}
            context={context}
            isPending={isPending}
          />
        )}
        {mode !== "edit" && goal && <GoalSummary goal={goal} competency={competency} area={area} locale={locale} />}
        {mode !== "view" && mode !== "edit" && <Confirmation>{confirmText[mode]}</Confirmation>}
        {actionError && (
          <p id={ERROR_ID} role="alert" tabIndex={-1} className="mt-4 text-sm font-semibold text-danger focus:outline-none">
            {isValidator && actionError === "NOT_EDITABLE"
              ? t("actionErrors.VALIDATOR_NOT_EDITABLE")
              : t(`actionErrors.${errorKey}`)}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">
        {mode === "view" && (
          <>
            {mayChange && wasSent && !isValidator && (
              <ActionButton variant="danger" onClick={() => switchMode("confirmCancel", CONFIRM_NO_ID)}>
                {tCentre("cancelGoal")}
              </ActionButton>
            )}
            <ActionButton variant="secondary" onClick={requestClose}>
              {tCommon("close")}
            </ActionButton>
            {mayChange && <ActionButton onClick={handleEdit}>{tCommon("edit")}</ActionButton>}
          </>
        )}
        {mode === "edit" && (
          <>
            <ActionButton variant="secondary" onClick={handleCancelEdit} isBusy={isPending}>
              {tCommon("cancel")}
            </ActionButton>
            <ActionButton
              variant={mayAddToPlan ? "secondary" : "primary"}
              onClick={() => handleSave("DRAFT")}
              isBusy={isPending}
            >
              {isPending ? t("saving") : tCentre("saveAndClose")}
            </ActionButton>
            {mayAddToPlan && (
              <ActionButton onClick={() => handleSave("PLAN")} isBusy={isPending}>
                {tCentre("addToPlan")}
              </ActionButton>
            )}
          </>
        )}
        {mode !== "view" && mode !== "edit" && (
          <>
            <ActionButton id={CONFIRM_NO_ID} variant="secondary" onClick={handleConfirmNo} isBusy={isPending}>
              {tCommon("no")}
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={mode === "confirmDiscard" ? requestClose : handleConfirm}
              isBusy={isPending}
            >
              {confirmYes[mode]}
            </ActionButton>
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
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAILED",
] as const;
type ActionErrorKey = (typeof ACTION_ERROR_KEYS)[number];

/** Field-level codes are shown under the fields; the banner then says "correct the highlighted fields". */
function isActionErrorKey(code: DevelopmentGoalActionErrorCode): code is ActionErrorKey {
  return (ACTION_ERROR_KEYS as readonly string[]).includes(code);
}

function Confirmation({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-6 rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
      {children}
    </p>
  );
}

type ActionButtonProps = {
  children: ReactNode;
  onClick: () => void;
  /** A save is running: the button keeps focus (aria-disabled, not disabled) but does nothing. */
  isBusy?: boolean;
  variant?: "primary" | "secondary" | "danger";
  id?: string;
};

const BUTTON_CLASSES = {
  primary: "bg-(image:--am-gradient) tracking-[0.04em] text-on-brand hover:opacity-90",
  secondary: "border border-line-strong bg-surface text-ink hover:border-accent hover:text-accent",
  danger: "border border-danger/60 bg-surface text-danger hover:bg-danger hover:text-on-brand",
} as const;

function ActionButton({ children, onClick, isBusy = false, variant = "primary", id }: ActionButtonProps) {
  return (
    <button
      id={id}
      type="button"
      onClick={isBusy ? undefined : onClick}
      aria-disabled={isBusy || undefined}
      aria-busy={isBusy || undefined}
      className={`min-h-11 cursor-pointer rounded-xl px-5 font-semibold transition duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none ${BUTTON_CLASSES[variant]}`}
    >
      {children}
    </button>
  );
}
