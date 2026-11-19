"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, PencilIcon } from "@/components/shell/icons";
import {
  acknowledgeGroupGoalAction,
  saveBhpCommitmentAction,
  type GroupGoalActionErrorCode,
  type GroupGoalActionResult,
} from "./actions";

// Part 1 cards and their detail window (G1-03, G1-11, G1-12). Display and input only: every rule
// (owner only, not sent, open cycle, 1..1000 chars, no un-acknowledge) is enforced by the server,
// which refreshes the page after a change, so the props here are always the saved state.

export type GroupGoalCardData = {
  templateId: number;
  type: "PRZYWODZTWO" | "WARTOSCI" | "BHP";
  title: string;
  /** HR text in the current language. */
  content: string;
  /** Formatted acknowledgement date, null while not acknowledged. */
  acknowledgedOn: string | null;
  commitment: string | null;
};

type GroupGoalCardsProps = {
  goals: readonly GroupGoalCardData[];
  /** null when the year is read-only and the person has no document. */
  documentId: number | null;
  canChange: boolean;
  commitmentMaxLength: number;
};

export function GroupGoalCards({ goals, documentId, canChange, commitmentMaxLength }: GroupGoalCardsProps) {
  const t = useTranslations("groupGoals");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const openGoal = goals.find((goal) => goal.templateId === openId) ?? null;

  const handleOpen = (templateId: number) => {
    setOpenId(templateId);
    dialogRef.current?.showModal();
  };

  return (
    <>
      <ul className="grid gap-4 md:grid-cols-3">
        {goals.map((goal) => (
          <li key={goal.templateId}>
            <GoalCard
              goal={goal}
              onOpen={() => handleOpen(goal.templateId)}
              openLabel={t("openGoal", { title: goal.title })}
            />
          </li>
        ))}
      </ul>
      <dialog
        ref={dialogRef}
        aria-labelledby="group-goal-title"
        onClose={() => setOpenId(null)}
        className="m-auto max-h-[90dvh] w-[min(100%-2rem,44rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        {openGoal && (
          // key: another goal starts with fresh edit state.
          <GoalDetail
            key={openGoal.templateId}
            goal={openGoal}
            documentId={documentId}
            mayChange={canChange && documentId !== null}
            commitmentMaxLength={commitmentMaxLength}
            onClose={() => dialogRef.current?.close()}
          />
        )}
      </dialog>
    </>
  );
}

type GoalCardProps = { goal: GroupGoalCardData; onOpen: () => void; openLabel: string };

function GoalCard({ goal, onOpen, openLabel }: GoalCardProps) {
  const t = useTranslations("groupGoals");
  // G1-03 [ZAŁ]: the BHP card shows the person's own commitment, not the Believe in Zero text.
  const isEmptyCommitment = goal.type === "BHP" && !goal.commitment;
  const preview = goal.type === "BHP" ? (goal.commitment ?? t("commitmentEmpty")) : goal.content;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={openLabel}
      className="group flex h-full min-h-56 w-full cursor-pointer flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-panel transition duration-200 hover:-translate-y-0.5 hover:border-accent/60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-lg leading-snug font-semibold text-balance">{goal.title}</span>
        <PencilIcon className="mt-1 size-4 shrink-0 text-ink-soft transition-colors group-hover:text-accent" />
      </span>
      <StatusBadge acknowledged={goal.acknowledgedOn !== null} />
      <span
        className={`mt-4 line-clamp-5 text-sm leading-relaxed whitespace-pre-line ${isEmptyCommitment ? "text-ink-soft italic" : "text-ink"}`}
      >
        {preview}
      </span>
    </button>
  );
}

function StatusBadge({ acknowledged }: { acknowledged: boolean }) {
  const t = useTranslations("groupGoals");
  if (acknowledged) {
    return (
      <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
        <CheckIcon className="size-3.5" />
        {t("acknowledgedBadge")}
      </span>
    );
  }
  return (
    <span className="mt-3 inline-flex w-fit items-center rounded-full bg-notice-surface px-2.5 py-1 text-xs font-semibold text-notice">
      {t("toAcknowledge")}
    </span>
  );
}

type GoalDetailProps = {
  goal: GroupGoalCardData;
  documentId: number | null;
  mayChange: boolean;
  commitmentMaxLength: number;
  onClose: () => void;
};

function GoalDetail({ goal, documentId, mayChange, commitmentMaxLength, onClose }: GoalDetailProps) {
  const t = useTranslations("groupGoals");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<GroupGoalActionErrorCode | null>(null);
  const isBhp = goal.type === "BHP";
  // A BHP goal without a commitment opens straight into the field; otherwise "Edytuj" opens it.
  const [isEditing, setIsEditing] = useState(isBhp && mayChange && !goal.commitment);
  const [draft, setDraft] = useState(goal.commitment ?? "");

  const [justSaved, setJustSaved] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // After a save the button that had focus unmounts; hand focus to "Zamknij" (still mounted).
  useEffect(() => {
    if (justSaved && !isPending) closeRef.current?.focus();
  }, [justSaved, isPending]);

  const run = (action: () => Promise<GroupGoalActionResult>, onDone?: () => void) => {
    setError(null);
    setJustSaved(false);
    startTransition(async () => {
      let result: GroupGoalActionResult;
      try {
        result = await action();
      } catch {
        // Network failure or a server error outside the action's own handling: show it inline.
        setError("FAILED");
        return;
      }
      if (!result.ok) return setError(result.code);
      onDone?.();
      setJustSaved(true);
    });
  };

  const handleAcknowledge = () => {
    if (documentId === null) return;
    run(() => acknowledgeGroupGoalAction({ documentId, templateId: goal.templateId }));
  };

  const handleSave = () => {
    if (documentId === null) return;
    // Quick feedback only; the server checks the same rules again.
    const trimmed = draft.trim();
    if (trimmed.length === 0) return setError("COMMITMENT_REQUIRED");
    if (trimmed.length > commitmentMaxLength) return setError("COMMITMENT_TOO_LONG");
    run(
      () => saveBhpCommitmentAction({ documentId, templateId: goal.templateId, commitment: trimmed }),
      () => setIsEditing(false),
    );
  };

  const handleCancelEdit = () => {
    setDraft(goal.commitment ?? "");
    setError(null);
    if (goal.commitment) setIsEditing(false);
    else onClose();
  };

  const errorText = error ? errorMessage(error, t, commitmentMaxLength) : null;
  const heading = isBhp ? `${goal.title} – Believe in Zero` : goal.title;

  return (
    <div className="flex max-h-[90dvh] flex-col">
      <header className="border-b border-line px-6 pt-6 pb-4 sm:px-8">
        <h2 id="group-goal-title" className="text-xl font-semibold text-balance sm:text-2xl">
          {heading}
        </h2>
        {goal.acknowledgedOn && (
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-accent">
            <CheckIcon className="size-4" />
            {t("acknowledgedOn", { date: goal.acknowledgedOn })}
          </p>
        )}
      </header>

      <div className="overflow-y-auto px-6 py-5 sm:px-8">
        <HrText content={goal.content} />
        {isBhp && (
          <CommitmentField
            commitment={goal.commitment}
            draft={draft}
            onDraftChange={setDraft}
            isEditing={isEditing}
            isPending={isPending}
            maxLength={commitmentMaxLength}
            errorText={errorText}
          />
        )}
        {!isBhp && errorText && <ErrorText>{errorText}</ErrorText>}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">
        <p role="status" className="mr-auto text-sm font-semibold text-accent">
          {justSaved && !isPending ? t("saved") : ""}
        </p>
        {isEditing ? (
          <>
            <ActionButton variant="secondary" onClick={handleCancelEdit} disabled={isPending}>
              {tCommon("cancel")}
            </ActionButton>
            <ActionButton onClick={handleSave} disabled={isPending}>
              {isPending ? t("saving") : tCommon("save")}
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton ref={closeRef} variant="secondary" onClick={onClose}>
              {tCommon("close")}
            </ActionButton>
            {isBhp && mayChange && <ActionButton onClick={() => setIsEditing(true)}>{tCommon("edit")}</ActionButton>}
            {!isBhp && mayChange && !goal.acknowledgedOn && (
              <ActionButton onClick={handleAcknowledge} disabled={isPending}>
                {isPending ? t("saving") : t("acknowledge")}
              </ActionButton>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

type CommitmentFieldProps = {
  commitment: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  isEditing: boolean;
  isPending: boolean;
  maxLength: number;
  errorText: string | null;
};

function CommitmentField({
  commitment,
  draft,
  onDraftChange,
  isEditing,
  isPending,
  maxLength,
  errorText,
}: CommitmentFieldProps) {
  const t = useTranslations("groupGoals");
  const label = (
    <>
      {t("commitmentLabel")}{" "}
      <span aria-hidden="true" className="text-danger">
        *
      </span>
      <span className="sr-only">{t("requiredMark")}</span>
    </>
  );

  if (!isEditing) {
    return (
      <section aria-labelledby="commitment-label" className="mt-6 rounded-2xl border border-line-strong p-4">
        <h3 id="commitment-label" className="text-sm font-semibold">
          {label}
        </h3>
        <p className={`mt-2 leading-relaxed whitespace-pre-line ${commitment ? "" : "text-ink-soft italic"}`}>
          {commitment ?? t("commitmentEmpty")}
        </p>
        {errorText && <ErrorText>{errorText}</ErrorText>}
      </section>
    );
  }

  const describedBy = ["commitment-hint", "commitment-count", errorText ? "commitment-error" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="mt-6">
      <label htmlFor="commitment" className="text-sm font-semibold">
        {label}
      </label>
      <p id="commitment-hint" className="mt-1 text-sm text-ink-soft">
        {t("commitmentHint")}
      </p>
      <textarea
        id="commitment"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        maxLength={maxLength}
        rows={4}
        required
        readOnly={isPending}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={describedBy}
        className="mt-2 w-full resize-y rounded-xl border border-line-strong bg-surface px-4 py-3 text-base leading-relaxed text-ink transition-colors duration-200 hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-accent/25 aria-invalid:border-danger motion-reduce:transition-none"
      />
      <p id="commitment-count" className="mt-1 text-right text-xs text-ink-soft tabular-nums">
        {t("characterCount", { count: draft.trim().length, max: maxLength })}
      </p>
      {errorText && <ErrorText>{errorText}</ErrorText>}
    </div>
  );
}

/**
 * HR text is plain text (never HTML): lines starting with "- " become a list, the rest paragraphs.
 * HR edits it in the cycle panel (HR-05, up to 20 000 characters), so it must stay React text nodes:
 * never pass it to a markdown or HTML renderer without a sanitising, element-allowlisted setup.
 * The tinted panel marks it as imposed text, apart from the person's own bordered entry (S07).
 */
function HrText({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1.5 pl-5 marker:text-accent">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const line of content.split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith("- ")) {
      bullets = [...bullets, text.slice(2)];
      continue;
    }
    flushBullets();
    if (text) blocks.push(<p key={`p-${blocks.length}`}>{text}</p>);
  }
  flushBullets();
  return <div className="space-y-3 rounded-2xl bg-canvas px-5 py-4 leading-relaxed">{blocks}</div>;
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p id="commitment-error" role="alert" className="mt-2 text-sm font-semibold text-danger">
      {children}
    </p>
  );
}

type ActionButtonProps = {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  ref?: Ref<HTMLButtonElement>;
};

const BUTTON_CLASSES = {
  primary: "bg-(image:--am-gradient) tracking-[0.04em] text-on-brand hover:opacity-90",
  secondary: "border border-line-strong bg-surface text-ink hover:border-accent hover:text-accent",
} as const;

function ActionButton({ children, onClick, disabled = false, variant = "primary", ref }: ActionButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={disabled || undefined}
      className={`min-h-11 cursor-pointer rounded-xl px-5 font-semibold transition duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${BUTTON_CLASSES[variant]}`}
    >
      {children}
    </button>
  );
}

type GroupGoalsTranslator = ReturnType<typeof useTranslations<"groupGoals">>;

function errorMessage(code: GroupGoalActionErrorCode, t: GroupGoalsTranslator, max: number): string {
  switch (code) {
    case "COMMITMENT_REQUIRED":
      return t("commitmentRequired");
    case "COMMITMENT_TOO_LONG":
      return t("commitmentTooLong", { max });
    case "NOT_EDITABLE":
    case "ALREADY_ACKNOWLEDGED":
    case "FORBIDDEN":
      return t(`actionErrors.${code}`);
    default:
      // INVALID_INPUT, WRONG_GOAL_TYPE, TEMPLATE_NOT_FOUND and FAILED mean the same to the person.
      return t("actionErrors.FAILED");
  }
}
