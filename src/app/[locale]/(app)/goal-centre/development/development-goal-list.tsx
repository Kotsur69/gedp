"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/shell/icons";
import type { DevelopmentGoalContext } from "@/domain/development-goal";
import type { Locale } from "@/i18n/config";
import { DevelopmentGoalDialog, type DialogTarget } from "./development-goal-dialog";
import { catalogName, PROGRESS_FILL_PERCENT, PROGRESS_LABEL_KEY, type DevelopmentGoalItem } from "./goal-format";
import { StateBadges } from "./goal-summary";

const LIST_HEADING_ID = "development-goal-list-heading";

// Part 3 list (G3-01, G3-02, G3-05): empty at first, one card per goal (competency, development
// area, progress bar, edit and delete), and the "+" right after the last card. No "copy" icon in
// Part 3. Delete exists only before the document is sent; afterwards the window offers "Anuluj cel".

type ListProps = {
  goals: readonly DevelopmentGoalItem[];
  context: DevelopmentGoalContext;
  /** null when the year is read-only and the person has no document. */
  documentId: number | null;
  canChange: boolean;
  wasSent: boolean;
};

export function DevelopmentGoalList({ goals, context, documentId, canChange, wasSent }: ListProps) {
  const t = useTranslations("developmentGoals");
  const [target, setTarget] = useState<DialogTarget | null>(null);
  const mayAdd = canChange && documentId !== null;

  // The browser returns focus to the button that opened the window; when that card is gone
  // (deleted), focus lands on the list heading instead of the page body.
  const handleClosed = () => {
    setTarget(null);
    requestAnimationFrame(() => {
      if (document.activeElement === null || document.activeElement === document.body) {
        document.getElementById(LIST_HEADING_ID)?.focus();
      }
    });
  };

  return (
    <>
      <h2 id={LIST_HEADING_ID} tabIndex={-1} className="sr-only">
        {t("listHeading")}
      </h2>
      {goals.length === 0 && <p className="text-ink-soft">{t("empty")}</p>}
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {goals.map((goal) => (
          <li key={goal.id}>
            <GoalCard
              goal={goal}
              context={context}
              mayEdit={mayAdd && goal.state !== "ANULOWANY"}
              mayDelete={mayAdd && !wasSent}
              onOpen={(kind) => setTarget({ kind, goalId: goal.id })}
            />
          </li>
        ))}
        {mayAdd && (
          <li className="flex items-center">
            <AddButton onClick={() => setTarget({ kind: "create" })} />
          </li>
        )}
      </ul>
      <DevelopmentGoalDialog
        target={target}
        goals={goals}
        context={context}
        documentId={documentId}
        canChange={canChange}
        wasSent={wasSent}
        onClosed={handleClosed}
      />
    </>
  );
}

type CardProps = {
  goal: DevelopmentGoalItem;
  context: DevelopmentGoalContext;
  mayEdit: boolean;
  mayDelete: boolean;
  onOpen: (kind: "view" | "edit" | "confirmDelete") => void;
};

function GoalCard({ goal, context, mayEdit, mayDelete, onOpen }: CardProps) {
  const t = useTranslations("developmentGoals");
  const tGlossary = useTranslations("glossary");
  const locale = useLocale() as Locale;
  const competency = catalogName(context.competencies, goal.competencyId, locale) ?? t("noCompetency");
  const area = catalogName(context.developmentAreas, goal.developmentAreaId, locale) ?? t("noArea");
  const progress = tGlossary(`goalProgress.${PROGRESS_LABEL_KEY[goal.progress]}`);
  const cancelledTone = goal.state === "ANULOWANY" ? "opacity-70" : "";

  return (
    <article
      className={`relative flex h-full min-h-52 flex-col rounded-2xl border border-line bg-surface p-5 shadow-panel transition duration-200 focus-within:border-accent/60 hover:-translate-y-0.5 hover:border-accent/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${cancelledTone}`}
    >
      <h3 className="text-lg leading-snug font-semibold text-balance text-ink">
        {/* Stretched button: the whole card opens the goal; the icon buttons below sit above it. */}
        <button
          type="button"
          onClick={() => onOpen("view")}
          aria-haspopup="dialog"
          aria-label={t("openGoal", { competency })}
          className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
        >
          {competency}
        </button>
      </h3>
      <p className="mt-1 text-sm text-ink-soft">{area}</p>
      <StateBadges goal={goal} />

      <div className="mt-auto pt-5">
        <p className="text-xs font-semibold text-ink-soft">{t("progressValue", { progress })}</p>
        <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wash-cool/60">
          <div
            className="h-full rounded-full bg-(image:--am-gradient)"
            style={{ width: `${PROGRESS_FILL_PERCENT[goal.progress]}%` }}
          />
        </div>
        {(mayEdit || mayDelete) && (
          <div className="relative z-10 mt-3 flex justify-end gap-1">
            {mayEdit && (
              <IconButton label={t("editGoal", { competency })} onClick={() => onOpen("edit")}>
                <PencilIcon className="size-4" />
              </IconButton>
            )}
            {mayDelete && (
              <IconButton
                label={t("deleteGoalNamed", { competency })}
                onClick={() => onOpen("confirmDelete")}
                isDanger
              >
                <TrashIcon className="size-4" />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

type IconButtonProps = { label: string; onClick: () => void; isDanger?: boolean; children: ReactNode };

function IconButton({ label, onClick, isDanger = false, children }: IconButtonProps) {
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

/** G3-05: the "+" sits right after the last card (and alone while the list is empty). */
function AddButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("developmentGoals");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl p-1 pr-4 text-left font-semibold text-ink transition-colors duration-200 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-(image:--am-gradient) text-on-brand shadow-card transition-transform duration-200 group-hover:scale-105 group-active:scale-95 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
        <PlusIcon className="size-7" />
      </span>
      {t("addGoal")}
    </button>
  );
}
