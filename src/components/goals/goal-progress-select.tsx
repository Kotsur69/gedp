"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateGoalProgressAction, type WorkflowActionErrorCode } from "@/app/[locale]/(app)/goal-centre/workflow-actions";
import { GOAL_PROGRESS_VALUES, type GoalProgress } from "@/domain/performance-goal";

// WF-05 [ZAŁ Q-13]: on an approved document the owner can still move a goal's progress during the
// year. A native select (keyboard and screen readers for free) that saves on change; on failure it
// goes back to the saved value and says why. The server re-checks the lock on every save.

const LABEL_KEY: Readonly<Record<GoalProgress, "TO_START" | "ONGOING" | "COMPLETED">> = {
  DO_ROZPOCZECIA: "TO_START",
  W_TRAKCIE: "ONGOING",
  UKONCZONY: "COMPLETED",
};

type Props = {
  part: "PERFORMANCE" | "DEVELOPMENT";
  goalId: number;
  value: GoalProgress;
  /** Goal title (or competency) for the accessible name: "Postęp celu: …". */
  goalName: string;
};

export function GoalProgressSelect({ part, goalId, value, goalName }: Props) {
  const t = useTranslations("workflow");
  const tGlossary = useTranslations("glossary");
  const [selected, setSelected] = useState<GoalProgress>(value);
  const [error, setError] = useState<WorkflowActionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();
  const errorId = useId();

  function handleChange(next: GoalProgress) {
    const previous = selected;
    setSelected(next);
    setError(null);
    startTransition(async () => {
      const result = await updateGoalProgressAction({ part, goalId, progress: next });
      if (result.ok) return;
      setSelected(previous);
      setError(result.code);
    });
  }

  return (
    // Above the card's stretched "open goal" button, like the card's icon buttons.
    <div className="relative z-10">
      <select
        value={selected}
        onChange={(event) => handleChange(event.target.value as GoalProgress)}
        aria-label={t("progressFor", { title: goalName })}
        aria-busy={isPending || undefined}
        aria-invalid={error !== null || undefined}
        aria-describedby={error ? errorId : undefined}
        className={`min-h-11 w-full cursor-pointer rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors duration-200 hover:border-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${isPending ? "cursor-wait opacity-60" : ""}`}
      >
        {GOAL_PROGRESS_VALUES.map((option) => (
          <option key={option} value={option}>
            {tGlossary(`goalProgress.${LABEL_KEY[option]}`)}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {t(`errors.${error}`, { max: 0 })}
        </p>
      )}
    </div>
  );
}
