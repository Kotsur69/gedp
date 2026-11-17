"use client";

import { useState } from "react";
import {
  goalFieldErrors,
  performanceGoalSchema,
  planWeightWithGoal,
  type GoalField,
  type GoalSaveMode,
  type PerformanceGoalContext,
} from "@/domain/performance-goal";
import type { PerformanceGoalItem } from "./goal-format";
import {
  FIELD_ORDER,
  toFormValues,
  toPayload,
  type GoalFieldErrors,
  type PerformanceGoalFormValues,
} from "./performance-goal-form";

// State and live validation of the Part 2 form (G2-21, G2-22, G2-23). Every check runs the shared
// zod schema on each render, so the form and the server agree:
// - an error shows once its field has been left (blur), or for every field after a refused save;
// - "Dodaj do planu" is allowed only while the full PLAN validation passes;
// - errors the server returned stay until that field changes;
// - the plan weight total follows the weight being typed.

export interface GoalFormState {
  values: PerformanceGoalFormValues;
  /** The payload the server would receive for the current values. */
  payload: ReturnType<typeof toPayload>;
  /** What the form shows now. */
  errors: GoalFieldErrors;
  canAddToPlan: boolean;
  planWeight: number;
  isDirty: boolean;
  change: (next: PerformanceGoalFormValues) => void;
  touch: (field: GoalField) => void;
  /** Checks a save; on failure shows the failing fields and returns the first one. */
  checkSave: (mode: GoalSaveMode) => GoalField | null;
  showServerErrors: (errors: GoalFieldErrors) => GoalField | null;
  /** Starts over from the goal as it is now (edit after view). */
  reset: (goal: PerformanceGoalItem | null) => void;
}

const firstField = (errors: GoalFieldErrors): GoalField | null =>
  FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;

export function useGoalForm(
  goal: PerformanceGoalItem | null,
  goals: readonly PerformanceGoalItem[],
  context: PerformanceGoalContext,
): GoalFormState {
  const [initialValues, setInitialValues] = useState(() => toFormValues(goal, context));
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState<ReadonlySet<GoalField>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [serverErrors, setServerErrors] = useState<GoalFieldErrors>({});

  const payload = toPayload(values);
  const planCheck = performanceGoalSchema("PLAN", context).safeParse(payload);
  const liveErrors: GoalFieldErrors = planCheck.success ? {} : goalFieldErrors(planCheck.error);
  const errors: GoalFieldErrors = {};
  for (const field of FIELD_ORDER) {
    const code = serverErrors[field] ?? (showAll || touched.has(field) ? liveErrors[field] : undefined);
    if (code) errors[field] = code;
  }

  const reveal = (fields: readonly GoalField[]) =>
    setTouched((previous) => (fields.every((field) => previous.has(field)) ? previous : new Set([...previous, ...fields])));

  return {
    values,
    payload,
    errors,
    canAddToPlan: planCheck.success,
    planWeight: planWeightWithGoal(goals, goal?.id ?? null, payload.weight),
    isDirty: JSON.stringify(values) !== JSON.stringify(initialValues),
    change: (next) => {
      const changed = FIELD_ORDER.filter((field) => next[field] !== values[field]);
      if (changed.some((field) => serverErrors[field] !== undefined)) {
        setServerErrors((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([field]) => !changed.includes(field as GoalField))),
        );
      }
      setValues(next);
    },
    touch: (field) => reveal([field]),
    checkSave: (mode) => {
      const check = performanceGoalSchema(mode, context).safeParse(payload);
      if (check.success) return null;
      const failed = goalFieldErrors(check.error);
      if (mode === "PLAN") setShowAll(true);
      else reveal(FIELD_ORDER.filter((field) => failed[field] !== undefined));
      return firstField(failed);
    },
    showServerErrors: (next) => {
      setServerErrors(next);
      return firstField(next);
    },
    reset: (fresh) => {
      const next = toFormValues(fresh, context);
      setInitialValues(next);
      setValues(next);
      setTouched(new Set());
      setShowAll(false);
      setServerErrors({});
    },
  };
}
