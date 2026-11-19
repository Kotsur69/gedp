"use client";

import { useLocale, useTranslations } from "next-intl";
import { DatePicker } from "@/components/goals/date-picker";
import { describedControl, GOAL_CONTROL_CLASSES, GoalField } from "@/components/goals/goal-field";
import { IconSelect } from "@/components/goals/icon-select";
import { TargetTypeIcon } from "@/components/goals/target-type-icon";
import { WeightInput } from "@/components/goals/weight-input";
import {
  DEFAULT_GOAL_PROGRESS,
  DEFAULT_TARGET_TYPE_CODE,
  GOAL_PROGRESS_VALUES,
  GOAL_TARGET_MAX_LENGTH,
  GOAL_TEXT_MAX_LENGTH,
  GOAL_TITLE_MAX_LENGTH,
  PLAN_WEIGHT_TARGET,
  type GoalField as GoalFieldName,
  type GoalInputErrorCode,
  type GoalProgress,
  type PerformanceGoalContext,
} from "@/domain/performance-goal";
import type { Locale } from "@/i18n/config";
import {
  findTargetType,
  targetTypeName,
  isUnitCode,
  PROGRESS_LABEL_KEY,
  type PerformanceGoalItem,
} from "./goal-format";

// Part 2 goal form (G2-10..17, IMG11 layout): title on top; description beside target type and
// target; measures; then due date, progress and weight in one row; the live plan weight total
// under it (G2-23). Input only: the shared zod schema decides what is valid. No ⓘ tooltips until
// HR provides their texts (G2-28, Q-16).

export type PerformanceGoalFormValues = {
  title: string;
  description: string;
  measures: string;
  dueDate: string;
  progress: GoalProgress;
  targetTypeId: string;
  target: string;
  weight: string;
};

export type GoalFieldErrors = Partial<Record<GoalFieldName, GoalInputErrorCode>>;

/** Visual order, used to focus the first invalid field. */
export const FIELD_ORDER: readonly GoalFieldName[] = [
  "title",
  "description",
  "targetTypeId",
  "target",
  "measures",
  "dueDate",
  "progress",
  "weight",
];

export const fieldId = (field: GoalFieldName): string => `performance-goal-${field}`;

export function toFormValues(goal: PerformanceGoalItem | null, context: PerformanceGoalContext): PerformanceGoalFormValues {
  const defaultType = context.targetTypes.find((type) => type.code === DEFAULT_TARGET_TYPE_CODE);
  const typeId = goal ? goal.targetTypeId : (defaultType?.id ?? null);
  return {
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    measures: goal?.measures ?? "",
    dueDate: goal?.dueDate ?? "",
    progress: goal?.progress ?? DEFAULT_GOAL_PROGRESS,
    targetTypeId: typeId === null ? "" : String(typeId),
    target: goal?.target ?? "",
    weight: goal?.weight === null || goal?.weight === undefined ? "" : String(goal.weight),
  };
}

/** Form values -> the shared schema's input. The weight goes as a number so 12.5 is refused, not rounded. */
export function toPayload(values: PerformanceGoalFormValues) {
  return {
    title: values.title,
    description: values.description,
    measures: values.measures,
    dueDate: values.dueDate,
    progress: values.progress,
    targetTypeId: values.targetTypeId === "" ? null : Number(values.targetTypeId),
    target: values.target,
    weight: values.weight === "" ? null : Number(values.weight),
  };
}

type FieldsProps = {
  values: PerformanceGoalFormValues;
  onChange: (next: PerformanceGoalFormValues) => void;
  onBlurField: (field: GoalFieldName) => void;
  /** Errors to show now (touched fields, or all after a refused save). */
  errors: GoalFieldErrors;
  context: PerformanceGoalContext;
  planWeight: number;
  isPending: boolean;
};

export function PerformanceGoalFields(props: FieldsProps) {
  const { values, onChange, onBlurField, errors, context, planWeight, isPending } = props;
  const t = useTranslations("performanceGoals");
  const tGlossary = useTranslations("glossary");
  const tControls = useTranslations("goalControls");
  const set = (field: keyof PerformanceGoalFormValues) => (value: string) => onChange({ ...values, [field]: value });
  const errorText = (field: GoalFieldName) => {
    const code = errors[field];
    return code ? t(`fieldErrors.${code}`, { year: context.cycleYear }) : null;
  };
  const required = t("requiredMark");
  const field = (name: GoalFieldName) => ({
    id: fieldId(name),
    error: errorText(name),
    requiredText: required,
  });
  const textProps = (name: "title" | "description" | "measures" | "target") => ({
    ...describedControl(fieldId(name), Boolean(errors[name])),
    name,
    value: values[name],
    disabled: isPending,
    onBlur: () => onBlurField(name),
  });

  const type = findTargetType(context.targetTypes, values.targetTypeId === "" ? null : Number(values.targetTypeId));
  const locale = useLocale() as Locale;
  const unit = type && isUnitCode(type.code) ? t(`targetUnits.${type.code}`) : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-soft">{t("requiredLegend")}</p>

      <GoalField label={t("fields.title")} hint={t("fields.titleHint")} isProminent {...field("title")}>
        <input
          {...textProps("title")}
          data-initial-focus=""
          type="text"
          maxLength={GOAL_TITLE_MAX_LENGTH}
          autoComplete="off"
          onChange={(event) => set("title")(event.target.value)}
          className={`${GOAL_CONTROL_CLASSES} text-lg font-semibold`}
        />
      </GoalField>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <GoalField label={t("fields.description")} hint={t("fields.descriptionHint")} {...field("description")}>
          <textarea
            {...textProps("description")}
            rows={6}
            maxLength={GOAL_TEXT_MAX_LENGTH}
            onChange={(event) => set("description")(event.target.value)}
            className={`${GOAL_CONTROL_CLASSES} resize-y`}
          />
        </GoalField>
        <div className="flex flex-col gap-6">
          <GoalField label={t("fields.targetType")} hint={t("fields.targetTypeHint")} {...field("targetTypeId")}>
            <IconSelect
              id={fieldId("targetTypeId")}
              value={values.targetTypeId}
              placeholder={tControls("chooseOption")}
              options={context.targetTypes.map((option) => ({
                value: String(option.id),
                label: targetTypeName(option, locale),
                icon: <TargetTypeIcon code={option.code} />,
              }))}
              onChange={set("targetTypeId")}
              onBlur={() => onBlurField("targetTypeId")}
              hasError={Boolean(errors.targetTypeId)}
              disabled={isPending}
            />
          </GoalField>
          <GoalField label={t("fields.target")} hint={t("fields.targetHint")} {...field("target")}>
            {type?.isNumeric ? (
              <div className="relative">
                <input
                  {...textProps("target")}
                  type="text"
                  inputMode="decimal"
                  maxLength={GOAL_TARGET_MAX_LENGTH}
                  autoComplete="off"
                  onChange={(event) => set("target")(event.target.value)}
                  className={`${GOAL_CONTROL_CLASSES} tabular-nums ${unit ? "pr-12" : ""}`}
                />
                {unit && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-semibold text-accent"
                  >
                    {unit}
                  </span>
                )}
              </div>
            ) : (
              <textarea
                {...textProps("target")}
                rows={2}
                maxLength={GOAL_TARGET_MAX_LENGTH}
                onChange={(event) => set("target")(event.target.value)}
                className={`${GOAL_CONTROL_CLASSES} resize-y`}
              />
            )}
          </GoalField>
        </div>
      </div>

      <GoalField label={t("fields.measures")} hint={t("fields.measuresHint")} {...field("measures")}>
        <textarea
          {...textProps("measures")}
          rows={3}
          maxLength={GOAL_TEXT_MAX_LENGTH}
          onChange={(event) => set("measures")(event.target.value)}
          className={`${GOAL_CONTROL_CLASSES} resize-y`}
        />
      </GoalField>

      <div className="grid gap-6 sm:grid-cols-3">
        <GoalField label={t("fields.dueDate")} hint={t("fields.dueDateHint")} {...field("dueDate")}>
          <DatePicker
            id={fieldId("dueDate")}
            value={values.dueDate}
            onChange={set("dueDate")}
            onBlur={() => onBlurField("dueDate")}
            min={`${context.cycleYear}-01-01`}
            max={`${context.cycleYear}-12-31`}
            hasError={Boolean(errors.dueDate)}
            disabled={isPending}
          />
        </GoalField>
        <GoalField label={t("fields.progress")} hint={t("fields.progressHint")} {...field("progress")}>
          <select
            {...describedControl(fieldId("progress"), Boolean(errors.progress))}
            name="progress"
            value={values.progress}
            disabled={isPending}
            onChange={(event) => set("progress")(event.target.value)}
            onBlur={() => onBlurField("progress")}
            className={`${GOAL_CONTROL_CLASSES} cursor-pointer`}
          >
            {GOAL_PROGRESS_VALUES.map((value) => (
              <option key={value} value={value}>
                {tGlossary(`goalProgress.${PROGRESS_LABEL_KEY[value]}`)}
              </option>
            ))}
          </select>
        </GoalField>
        <GoalField label={t("fields.weight")} hint={t("fields.weightHint")} {...field("weight")}>
          <WeightInput
            id={fieldId("weight")}
            value={values.weight}
            onChange={set("weight")}
            onBlur={() => onBlurField("weight")}
            hasError={Boolean(errors.weight)}
            disabled={isPending}
          />
        </GoalField>
      </div>

      <PlanWeightTotal weight={planWeight} />
    </div>
  );
}

/** G2-23 live total: the plan's weight with this goal included, against the 100% target. */
function PlanWeightTotal({ weight }: { weight: number }) {
  const t = useTranslations("performanceGoals");
  const difference = weight - PLAN_WEIGHT_TARGET;
  const status =
    difference === 0
      ? t("weightTotalOk")
      : difference < 0
        ? t("weightTotalMissing", { weight: -difference })
        : t("weightTotalOver", { weight: difference });
  const barTone = difference === 0 ? "bg-(image:--am-gradient)" : difference > 0 ? "bg-danger" : "bg-brand-orange";
  const textTone = difference === 0 ? "text-accent" : difference > 0 ? "text-danger" : "text-notice";
  const fill = Math.min(weight, PLAN_WEIGHT_TARGET) / PLAN_WEIGHT_TARGET;
  return (
    <div className="rounded-2xl bg-canvas px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-ink tabular-nums">{t("weightTotal", { weight })}</p>
        <p role="status" className={`text-sm font-semibold ${textTone}`}>
          {status}
        </p>
      </div>
      <div
        role="meter"
        aria-label={t("weightMeter")}
        aria-valuemin={0}
        aria-valuemax={PLAN_WEIGHT_TARGET}
        aria-valuenow={Math.min(weight, PLAN_WEIGHT_TARGET)}
        aria-valuetext={`${weight}%`}
        className="mt-3 h-2 overflow-hidden rounded-full bg-wash-cool/60"
      >
        {/* scaleX instead of width: the bar animates on the compositor. */}
        <div
          className={`h-full origin-left rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none ${barTone}`}
          style={{ transform: `scaleX(${fill})` }}
        />
      </div>
    </div>
  );
}
