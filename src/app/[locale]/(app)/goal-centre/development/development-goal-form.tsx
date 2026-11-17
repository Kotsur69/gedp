"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarIcon } from "@/components/shell/icons";
import {
  GOAL_PROGRESS_VALUES,
  type CatalogOption,
  type DevelopmentGoalContext,
  type DevelopmentGoalField,
  type DevelopmentGoalInputErrorCode,
  type GoalProgress,
} from "@/domain/development-goal";
import { GOAL_TEXT_MAX_LENGTH, GOAL_TITLE_MAX_LENGTH } from "@/domain/performance-goal";
import type { Locale } from "@/i18n/config";
import { PROGRESS_LABEL_KEY, type DevelopmentGoalItem } from "./goal-format";

// Part 3 form: ONLY the fields shared by both candidate models (Q-04) - competency + development
// area from the cycle's catalogue, action title / description, one start-end period field and
// progress. No measure, target type or weight. Input only: the shared zod schema decides validity.

export type GoalFormValues = {
  competencyId: string;
  developmentAreaId: string;
  actionTitle: string;
  actionDescription: string;
  startDate: string;
  endDate: string;
  progress: GoalProgress;
};

export type GoalFieldErrors = Partial<Record<DevelopmentGoalField, DevelopmentGoalInputErrorCode>>;

/** Visual order, used to focus the first invalid field after a failed save. */
export const FIELD_ORDER: readonly DevelopmentGoalField[] = [
  "developmentAreaId",
  "competencyId",
  "actionTitle",
  "actionDescription",
  "startDate",
  "endDate",
  "progress",
];

export const fieldId = (field: DevelopmentGoalField): string => `development-goal-${field}`;

export function toFormValues(goal: DevelopmentGoalItem | null): GoalFormValues {
  return {
    competencyId: goal?.competencyId ? String(goal.competencyId) : "",
    developmentAreaId: goal?.developmentAreaId ? String(goal.developmentAreaId) : "",
    actionTitle: goal?.actionTitle ?? "",
    actionDescription: goal?.actionDescription ?? "",
    startDate: goal?.startDate ?? "",
    endDate: goal?.endDate ?? "",
    progress: goal?.progress ?? "DO_ROZPOCZECIA",
  };
}

/** Form values -> the shared schema's input (ids as numbers, blanks as null). */
export function toPayload(values: GoalFormValues) {
  const id = (value: string): number | null => (value === "" ? null : Number(value));
  return {
    competencyId: id(values.competencyId),
    developmentAreaId: id(values.developmentAreaId),
    actionTitle: values.actionTitle,
    actionDescription: values.actionDescription,
    startDate: values.startDate,
    endDate: values.endDate,
    progress: values.progress,
  };
}

type FieldsProps = {
  values: GoalFormValues;
  onChange: (next: GoalFormValues) => void;
  errors: GoalFieldErrors;
  context: DevelopmentGoalContext;
  isPending: boolean;
};

export function DevelopmentGoalFields({ values, onChange, errors, context, isPending }: FieldsProps) {
  const t = useTranslations("developmentGoals");
  const tGlossary = useTranslations("glossary");
  const locale = useLocale() as Locale;
  const set = (field: keyof GoalFormValues) => (value: string) => onChange({ ...values, [field]: value });
  const errorText = (field: DevelopmentGoalField) => {
    const code = errors[field];
    return code ? t(`fieldErrors.${code}`, { year: context.cycleYear }) : null;
  };
  const catalogSelect = (field: "competencyId" | "developmentAreaId", options: readonly CatalogOption[]) => (
    <CatalogSelect
      field={field}
      options={options}
      value={values[field]}
      onChange={set(field)}
      locale={locale}
      hasError={Boolean(errors[field])}
      isPending={isPending}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-soft">{t("requiredLegend")}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          field="developmentAreaId"
          label={t("fields.developmentArea")}
          hint={t("fieldHints.developmentArea")}
          error={errorText("developmentAreaId")}
          isRequired
        >
          {catalogSelect("developmentAreaId", context.developmentAreas)}
        </Field>
        <Field
          field="competencyId"
          label={t("fields.competency")}
          hint={t("fieldHints.competency")}
          error={errorText("competencyId")}
          isRequired
        >
          {catalogSelect("competencyId", context.competencies)}
        </Field>
      </div>

      <Field
        field="actionTitle"
        label={t("fields.actionTitle")}
        hint={t("fieldHints.actionTitle")}
        error={errorText("actionTitle")}
        isRequired
      >
        <input
          {...controlProps("actionTitle", Boolean(errors.actionTitle), isPending)}
          type="text"
          value={values.actionTitle}
          onChange={(event) => set("actionTitle")(event.target.value)}
          maxLength={GOAL_TITLE_MAX_LENGTH}
          autoComplete="off"
        />
      </Field>

      <Field
        field="actionDescription"
        label={t("fields.actionDescription")}
        hint={t("fieldHints.actionDescription")}
        error={errorText("actionDescription")}
        isRequired
      >
        <textarea
          {...controlProps("actionDescription", Boolean(errors.actionDescription), isPending)}
          value={values.actionDescription}
          onChange={(event) => set("actionDescription")(event.target.value)}
          maxLength={GOAL_TEXT_MAX_LENGTH}
          rows={4}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PeriodField
          values={values}
          onChange={onChange}
          cycleYear={context.cycleYear}
          errors={errors}
          error={errorText("startDate") ?? errorText("endDate")}
          isPending={isPending}
        />
        <Field field="progress" label={t("fields.progress")} error={errorText("progress")}>
          <select
            {...controlProps("progress", Boolean(errors.progress), isPending)}
            value={values.progress}
            onChange={(event) => set("progress")(event.target.value)}
          >
            {GOAL_PROGRESS_VALUES.map((value) => (
              <option key={value} value={value}>
                {tGlossary(`goalProgress.${PROGRESS_LABEL_KEY[value]}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

const CONTROL_CLASSES =
  "min-h-11 w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-base text-ink transition-colors duration-200 hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-accent/25 aria-invalid:border-danger disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none";

function controlProps(field: DevelopmentGoalField, hasError: boolean, isPending: boolean) {
  const describedBy = [`${fieldId(field)}-hint`, hasError ? `${fieldId(field)}-error` : null].filter(Boolean).join(" ");
  return {
    id: fieldId(field),
    name: field,
    disabled: isPending,
    "aria-invalid": hasError || undefined,
    "aria-describedby": describedBy,
    className: CONTROL_CLASSES,
  };
}

type CatalogSelectProps = {
  field: "competencyId" | "developmentAreaId";
  options: readonly CatalogOption[];
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  hasError: boolean;
  isPending: boolean;
};

/** Only active catalogue entries can be picked (G3-20); a deactivated current value stays visible, disabled. */
function CatalogSelect({ field, options, value, onChange, locale, hasError, isPending }: CatalogSelectProps) {
  const t = useTranslations("developmentGoals");
  const name = (option: CatalogOption) => (locale === "en" ? option.nameEn : option.namePl);
  const current = options.find((option) => String(option.id) === value);
  return (
    <select {...controlProps(field, hasError, isPending)} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t("choose")}</option>
      {current && !current.isActive && (
        <option value={value} disabled>
          {t("inactiveSuffix", { name: name(current) })}
        </option>
      )}
      {options
        .filter((option) => option.isActive)
        .map((option) => (
          <option key={option.id} value={String(option.id)}>
            {name(option)}
          </option>
        ))}
    </select>
  );
}

type PeriodFieldProps = {
  values: GoalFormValues;
  onChange: (next: GoalFormValues) => void;
  cycleYear: number;
  errors: GoalFieldErrors;
  error: string | null;
  isPending: boolean;
};

const PERIOD_HINT_ID = "development-goal-period-hint";
const PERIOD_ERROR_ID = "development-goal-period-error";

/** G3-12: start and end date as ONE field (one label, one bordered control, one error line). */
function PeriodField({ values, onChange, cycleYear, errors, error, isPending }: PeriodFieldProps) {
  const t = useTranslations("developmentGoals");
  const dateInput = (field: "startDate" | "endDate") => (
    <input
      id={fieldId(field)}
      name={field}
      type="date"
      value={values[field]}
      onChange={(event) => onChange({ ...values, [field]: event.target.value })}
      min={`${cycleYear}-01-01`}
      max={`${cycleYear}-12-31`}
      disabled={isPending}
      aria-label={t(`fields.${field}`)}
      aria-invalid={errors[field] ? true : undefined}
      aria-describedby={error ? `${PERIOD_HINT_ID} ${PERIOD_ERROR_ID}` : PERIOD_HINT_ID}
      className="min-h-11 w-full min-w-0 rounded-lg bg-transparent px-2 text-base text-ink tabular-nums focus-visible:outline-3 focus-visible:outline-accent/25 disabled:cursor-wait"
    />
  );
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-ink">
        {t("fields.period")} <RequiredMark />
      </legend>
      <p id={PERIOD_HINT_ID} className="mt-1 text-sm text-ink-soft">
        {t("fieldHints.period", { year: cycleYear })}
      </p>
      <div
        className={`mt-2 flex items-center gap-1 rounded-xl border bg-surface px-2 transition-colors duration-200 focus-within:border-accent hover:border-accent motion-reduce:transition-none ${error ? "border-danger" : "border-line-strong"}`}
      >
        <CalendarIcon className="size-5 shrink-0 text-ink-soft" />
        {dateInput("startDate")}
        <span aria-hidden="true" className="text-ink-soft">
          –
        </span>
        {dateInput("endDate")}
      </div>
      {error && <FieldError id={PERIOD_ERROR_ID}>{error}</FieldError>}
    </fieldset>
  );
}

type FieldProps = {
  field: DevelopmentGoalField;
  label: string;
  hint?: string;
  error: string | null;
  isRequired?: boolean;
  children: ReactNode;
};

function Field({ field, label, hint, error, isRequired = false, children }: FieldProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={fieldId(field)} className="text-sm font-semibold text-ink">
        {label} {isRequired && <RequiredMark />}
      </label>
      <p id={`${fieldId(field)}-hint`} className="mt-1 text-sm text-ink-soft">
        {hint}
      </p>
      <div className="mt-auto pt-2">{children}</div>
      {error && <FieldError id={`${fieldId(field)}-error`}>{error}</FieldError>}
    </div>
  );
}

function RequiredMark() {
  const t = useTranslations("developmentGoals");
  return (
    <>
      <span aria-hidden="true" className="text-danger">
        *
      </span>
      <span className="sr-only">{t("requiredMark")}</span>
    </>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-sm font-semibold text-danger">
      {children}
    </p>
  );
}
