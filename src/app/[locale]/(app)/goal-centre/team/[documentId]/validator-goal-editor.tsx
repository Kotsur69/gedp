"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PencilIcon } from "@/components/shell/icons";
import type { DevelopmentGoalContext } from "@/domain/development-goal";
import type { PerformanceGoalContext } from "@/domain/performance-goal";
import { DevelopmentGoalDialog } from "../../development/development-goal-dialog";
import type { DevelopmentGoalItem } from "../../development/goal-format";
import type { PerformanceGoalItem } from "../../performance/goal-format";
import { PerformanceGoalDialog } from "../../performance/performance-goal-dialog";

// WF-04: N+1 changes the employee's goals while the document waits for validation. The review rows
// stay server-rendered; each gets an edit button that opens the Part 2 / Part 3 goal window in
// validator mode (content only, no plan or cancel buttons). The server re-checks every rule on save.

// The windows always open in edit mode. `canChange` is true because the page renders an editor only
// when the workflow says the validator may edit; `wasSent` only matters for "Anuluj cel", which the
// windows hide for the validator.

type OpenGoal = (goalId: number) => void;

const OpenGoalContext = createContext<OpenGoal | null>(null);

type EditorProps<Goal, Context> = {
  documentId: number;
  goals: readonly Goal[];
  context: Context;
  children: ReactNode;
};

export function PerformanceGoalEditor({
  documentId,
  goals,
  context,
  children,
}: EditorProps<PerformanceGoalItem, PerformanceGoalContext>) {
  const [goalId, setGoalId] = useState<number | null>(null);
  return (
    <OpenGoalContext value={setGoalId}>
      {children}
      <PerformanceGoalDialog
        target={goalId === null ? null : { kind: "edit", goalId }}
        goals={goals}
        context={context}
        documentId={documentId}
        canChange
        wasSent
        isValidator
        onClosed={() => setGoalId(null)}
      />
    </OpenGoalContext>
  );
}

export function DevelopmentGoalEditor({
  documentId,
  goals,
  context,
  children,
}: EditorProps<DevelopmentGoalItem, DevelopmentGoalContext>) {
  const [goalId, setGoalId] = useState<number | null>(null);
  return (
    <OpenGoalContext value={setGoalId}>
      {children}
      <DevelopmentGoalDialog
        target={goalId === null ? null : { kind: "edit", goalId }}
        goals={goals}
        context={context}
        documentId={documentId}
        canChange
        wasSent
        isValidator
        onClosed={() => setGoalId(null)}
      />
    </OpenGoalContext>
  );
}

/** Pencil on a review row; opens the goal window of the nearest editor above it. */
export function EditGoalButton({ goalId, title }: { goalId: number; title: string }) {
  const openGoal = use(OpenGoalContext);
  const t = useTranslations("team");
  if (!openGoal) throw new Error("EditGoalButton must be rendered inside a goal editor");
  const label = t("editGoal", { title });
  return (
    <button
      type="button"
      onClick={() => openGoal(goalId)}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-soft transition-colors duration-200 hover:bg-accent/10 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
    >
      <PencilIcon className="size-4" />
    </button>
  );
}
