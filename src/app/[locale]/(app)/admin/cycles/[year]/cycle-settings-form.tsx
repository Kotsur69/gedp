"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/goals/date-picker";
import { GoalField } from "@/components/goals/goal-field";
import {
  cycleSettingsSchema,
  MAX_CYCLE_YEAR,
  MAX_MIN_GOALS,
  MAX_WEIGHT_SUM,
  MIN_CYCLE_YEAR,
} from "@/domain/cycle-config";
import { updateCycleSettingsAction } from "../actions";
import { NumberField } from "../cycle-fields";
import { FormStatus, PRIMARY_BUTTON, toNumberOrNull, useCycleSave, useFieldError } from "../cycle-form-kit";

// "Rok i terminy" (HR-05): year, goal-setting dates and the closing-condition thresholds the
// document workflow reads from the cycle (WF-C4 / WF-C5).

export type CycleSettingsValues = {
  year: number;
  goalSettingOpensAt: string | null;
  goalSettingClosesAt: string | null;
  minPerformanceGoals: number;
  requiredWeightSum: number;
  minDevelopmentGoals: number;
};

type CycleSettingsFormProps = {
  cycleId: number;
  initial: CycleSettingsValues;
  isEditable: boolean;
  canChangeYear: boolean;
};

const FIELDS = [
  "year",
  "goalSettingOpensAt",
  "goalSettingClosesAt",
  "minPerformanceGoals",
  "requiredWeightSum",
  "minDevelopmentGoals",
] as const;
type Field = (typeof FIELDS)[number];
type FormValues = Record<Field, string>;

const toForm = (values: CycleSettingsValues): FormValues => ({
  year: String(values.year),
  goalSettingOpensAt: values.goalSettingOpensAt ?? "",
  goalSettingClosesAt: values.goalSettingClosesAt ?? "",
  minPerformanceGoals: String(values.minPerformanceGoals),
  requiredWeightSum: String(values.requiredWeightSum),
  minDevelopmentGoals: String(values.minDevelopmentGoals),
});

const fieldId = (field: Field) => `cycle-settings-${field}`;

export function CycleSettingsForm({ cycleId, initial, isEditable, canChangeYear }: CycleSettingsFormProps) {
  const t = useTranslations("admin.cycles.settings");
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => toForm(initial));
  const state = useCycleSave();
  const errorOf = useFieldError(state.fieldErrors);
  const isBusy = state.isPending;
  // Goal setting for year N may start late in N-1 and run into N+1.
  const dateMin = `${Math.max(initial.year - 1, MIN_CYCLE_YEAR)}-01-01`;
  const dateMax = `${Math.min(initial.year + 1, MAX_CYCLE_YEAR)}-12-31`;

  const set = (field: Field) => (value: string) => {
    if (isBusy) return;
    setValues((current) => ({ ...current, [field]: value }));
    state.markEdited();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isEditable) return;
    state.save({
      schema: cycleSettingsSchema,
      payload: {
        cycleId,
        year: toNumberOrNull(values.year),
        goalSettingOpensAt: values.goalSettingOpensAt,
        goalSettingClosesAt: values.goalSettingClosesAt,
        minPerformanceGoals: toNumberOrNull(values.minPerformanceGoals),
        requiredWeightSum: toNumberOrNull(values.requiredWeightSum),
        minDevelopmentGoals: toNumberOrNull(values.minDevelopmentGoals),
      },
      action: updateCycleSettingsAction,
      fields: FIELDS,
      // The page lives at /admin/cycles/<year>: follow a changed year to its new address.
      onSaved: (changed) => {
        const savedYear = Number(values.year);
        if (changed && savedYear !== initial.year) router.replace(`/admin/cycles/${savedYear}`);
      },
    });
  };

  const dateField = (field: "goalSettingOpensAt" | "goalSettingClosesAt", label: string) => (
    <GoalField id={fieldId(field)} label={label} hint={t("dateHint")} error={errorOf(field)}>
      <DatePicker
        id={fieldId(field)}
        value={values[field]}
        onChange={set(field)}
        min={dateMin}
        max={dateMax}
        hasError={errorOf(field) !== null}
        disabled={!isEditable}
      />
    </GoalField>
  );

  const thresholdField = (field: "minPerformanceGoals" | "requiredWeightSum" | "minDevelopmentGoals", max: number) => (
    <NumberField
      id={fieldId(field)}
      label={t(field)}
      hint={t(`${field}Hint`)}
      error={errorOf(field)}
      value={values[field]}
      onChange={set(field)}
      min={0}
      max={max}
      isDisabled={!isEditable}
      isBusy={isBusy}
    />
  );

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-6">
      <div className="grid gap-5 md:grid-cols-3">
        <NumberField
          id={fieldId("year")}
          label={t("year")}
          hint={canChangeYear ? "" : t("yearLocked")}
          error={errorOf("year")}
          value={values.year}
          onChange={set("year")}
          min={MIN_CYCLE_YEAR}
          max={MAX_CYCLE_YEAR}
          isDisabled={!isEditable || !canChangeYear}
          isBusy={isBusy}
        />
        {dateField("goalSettingOpensAt", t("goalSettingOpens"))}
        {dateField("goalSettingClosesAt", t("goalSettingCloses"))}
      </div>

      <fieldset className="rounded-2xl border border-line p-4 sm:p-5">
        <legend className="px-1 font-semibold text-ink">{t("closingTitle")}</legend>
        <p className="text-sm text-ink-soft">{t("closingIntro")}</p>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          {thresholdField("minPerformanceGoals", MAX_MIN_GOALS)}
          {thresholdField("requiredWeightSum", MAX_WEIGHT_SUM)}
          {thresholdField("minDevelopmentGoals", MAX_MIN_GOALS)}
        </div>
      </fieldset>

      {isEditable && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            aria-disabled={state.isPending || undefined}
            aria-busy={state.isPending || undefined}
            className={PRIMARY_BUTTON}
          >
            {t("submit")}
          </button>
          <FormStatus state={state} />
        </div>
      )}
    </form>
  );
}
