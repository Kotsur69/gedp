"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GoalProgressSelect } from "@/components/goals/goal-progress-select";
import { CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/shell/icons";
import type { PerformanceGoalContext } from "@/domain/performance-goal";
import type { Locale } from "@/i18n/config";
import { StateBadges } from "../development/goal-summary";
import { CopyGoalsDialog } from "./copy-goals-dialog";
import {
  displayDate,
  displayTarget,
  findTargetType,
  isUnitCode,
  PROGRESS_FILL_PERCENT,
  PROGRESS_LABEL_KEY,
  type PerformanceGoalItem,
} from "./goal-format";
import { PerformanceGoalDialog, type DialogTarget } from "./performance-goal-dialog";

const LIST_HEADING_ID = "performance-goal-list-heading";

// Part 2 list (G2-01, G2-02, G2-06, G2-08, G2-09, G2-27): empty at first except for the "+" and
// "kopiuj" icons; one card per goal, three per row (title, target, due date, weight, progress
// bar, edit and delete); the two icons stay under the cards on the left. Delete exists only before
// the document is sent; afterwards the goal window offers "Anuluj cel".

type ListProps = {
  goals: readonly PerformanceGoalItem[];
  context: PerformanceGoalContext;
  /** null when the year is read-only and the person has no document. */
  documentId: number | null;
  canChange: boolean;
  wasSent: boolean;
  /** WF-05: approved document - goals in the plan get a progress select, nothing else changes. */
  canUpdateProgress: boolean;
  copyable: { previousYear: number; count: number };
};

export function PerformanceGoalList({ goals, context, documentId, canChange, wasSent, canUpdateProgress, copyable }: ListProps) {
  const t = useTranslations("performanceGoals");
  const [target, setTarget] = useState<DialogTarget | null>(null);
  const [isCopyOpen, setIsCopyOpen] = useState(false);
  const mayAdd = canChange && documentId !== null;

  // The browser returns focus to the button that opened the window. When that card is gone
  // (deleted: the refreshed list arrives after the window has closed), focus would fall to the page
  // body; it goes to the list heading instead.
  const isRestoringFocus = useRef(false);
  const restoreFocus = () => {
    const isLost = document.activeElement === null || document.activeElement === document.body;
    if (isLost) document.getElementById(LIST_HEADING_ID)?.focus();
    return isLost;
  };
  useEffect(() => {
    if (!isRestoringFocus.current) return;
    isRestoringFocus.current = false;
    restoreFocus();
  }, [goals]);
  const handleClosed = () => {
    setTarget(null);
    isRestoringFocus.current = true;
    requestAnimationFrame(() => {
      if (restoreFocus()) isRestoringFocus.current = false;
    });
  };

  return (
    <>
      <h2 id={LIST_HEADING_ID} tabIndex={-1} className="sr-only">
        {t("listHeading")}
      </h2>
      {goals.length === 0 && !mayAdd && <p className="text-ink-soft">{t("emptyReadOnly")}</p>}
      {goals.length > 0 && (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <GoalCard
                goal={goal}
                context={context}
                mayEdit={mayAdd && goal.state !== "ANULOWANY"}
                mayDelete={mayAdd && !wasSent}
                mayUpdateProgress={canUpdateProgress && goal.state === "W_PLANIE"}
                onOpen={(kind) => setTarget({ kind, goalId: goal.id })}
              />
            </li>
          ))}
        </ul>
      )}
      {mayAdd && (
        <div className={`flex gap-3 ${goals.length > 0 ? "mt-6" : ""}`}>
          {goals.length === 0 && <span className="sr-only">{t("empty")}</span>}
          <BrandIconButton label={t("addGoal")} onClick={() => setTarget({ kind: "create" })}>
            <PlusIcon className="size-6" />
          </BrandIconButton>
          <BrandIconButton label={t("copyGoals")} onClick={() => setIsCopyOpen(true)}>
            <CopyIcon className="size-5" />
          </BrandIconButton>
        </div>
      )}
      <PerformanceGoalDialog
        target={target}
        goals={goals}
        context={context}
        documentId={documentId}
        canChange={canChange}
        wasSent={wasSent}
        onClosed={handleClosed}
      />
      {documentId !== null && (
        <CopyGoalsDialog
          isOpen={isCopyOpen}
          documentId={documentId}
          previousYear={copyable.previousYear}
          count={copyable.count}
          onClosed={() => setIsCopyOpen(false)}
        />
      )}
    </>
  );
}

type CardProps = {
  goal: PerformanceGoalItem;
  context: PerformanceGoalContext;
  mayEdit: boolean;
  mayDelete: boolean;
  mayUpdateProgress: boolean;
  onOpen: (kind: "view" | "edit" | "confirmDelete") => void;
};

function GoalCard({ goal, context, mayEdit, mayDelete, mayUpdateProgress, onOpen }: CardProps) {
  const t = useTranslations("performanceGoals");
  const tGlossary = useTranslations("glossary");
  const locale = useLocale() as Locale;
  const isNumeric = findTargetType(context.targetTypes, goal.targetTypeId)?.isNumeric ?? false;
  const unit = isUnitCode(goal.targetTypeCode) ? ` ${t(`targetUnits.${goal.targetTypeCode}`)}` : "";
  const target = goal.target ? `${displayTarget(goal.target, isNumeric, locale)}${unit}` : t("notSet");
  const dueDate = goal.dueDate ? displayDate(goal.dueDate, locale) : t("notSet");
  const weight = goal.weight === null ? t("notSet") : `${goal.weight}%`;
  const progress = tGlossary(`goalProgress.${PROGRESS_LABEL_KEY[goal.progress]}`);
  const fill = PROGRESS_FILL_PERCENT[goal.progress] / 100;
  const cancelledTone = goal.state === "ANULOWANY" ? "opacity-70" : "";

  return (
    <article
      className={`relative flex h-full min-h-60 flex-col rounded-2xl border border-line bg-surface p-5 shadow-panel transition duration-200 focus-within:border-accent/60 hover:-translate-y-0.5 hover:border-accent/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${cancelledTone}`}
    >
      <h3 className="line-clamp-2 text-lg leading-snug font-semibold break-words text-ink">
        {/* Stretched button: the whole card opens the goal; the icon buttons below sit above it. */}
        <button
          type="button"
          onClick={() => onOpen("view")}
          aria-haspopup="dialog"
          aria-label={t("openGoal", { title: goal.title })}
          className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
        >
          {goal.title}
        </button>
      </h3>
      <StateBadges goal={goal} />

      {/* G2-27 order: target, due date, weight. */}
      <dl className="mt-4 space-y-1.5 text-sm">
        <CardRow label={t("card.target")}>
          <span className="line-clamp-2 break-words">{target}</span>
        </CardRow>
        <CardRow label={t("card.dueDate")}>
          <span className="tabular-nums">{dueDate}</span>
        </CardRow>
        <CardRow label={t("card.weight")}>
          <span className="font-semibold tabular-nums">{weight}</span>
        </CardRow>
      </dl>

      <div className="mt-auto pt-5">
        <p className="text-xs font-semibold text-ink-soft">{t("progressValue", { progress })}</p>
        {/* G2-08: empty / half / full bar; decorative, the text above carries the value. */}
        <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wash-cool/60">
          <div className="h-full origin-left rounded-full bg-(image:--am-gradient)" style={{ transform: `scaleX(${fill})` }} />
        </div>
        {mayUpdateProgress && (
          <div className="mt-3">
            <GoalProgressSelect part="PERFORMANCE" goalId={goal.id} value={goal.progress} goalName={goal.title} />
          </div>
        )}
        {(mayEdit || mayDelete) && (
          <div className="relative z-10 mt-3 flex justify-end gap-1">
            {mayEdit && (
              <CardIconButton label={t("editGoal", { title: goal.title })} onClick={() => onOpen("edit")}>
                <PencilIcon className="size-4" />
              </CardIconButton>
            )}
            {mayDelete && (
              <CardIconButton
                label={t("deleteGoalNamed", { title: goal.title })}
                onClick={() => onOpen("confirmDelete")}
                isDanger
              >
                <TrashIcon className="size-4" />
              </CardIconButton>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

type IconButtonProps = { label: string; onClick: () => void; isDanger?: boolean; children: ReactNode };

function CardIconButton({ label, onClick, isDanger = false, children }: IconButtonProps) {
  const hover = isDanger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-accent/10 hover:text-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      className={`flex size-11 cursor-pointer items-center justify-center rounded-xl text-ink-soft transition-colors duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${hover}`}
    >
      {children}
    </button>
  );
}

/** G2-01 / G2-09 / IMG10: the gradient "+" and "kopiuj" icons, bottom-left under the cards. */
function BrandIconButton({ label, onClick, children }: Omit<IconButtonProps, "isDanger">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      className="flex size-12 cursor-pointer items-center justify-center rounded-2xl bg-(image:--am-gradient) text-on-brand shadow-card transition-transform duration-200 hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100"
    >
      {children}
    </button>
  );
}
