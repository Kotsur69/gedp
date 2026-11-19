"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { groupGoalTextSchema, MAX_GROUP_GOAL_TEXT_LENGTH, type GroupGoalTypeValue } from "@/domain/cycle-config";
import { saveGroupGoalTextAction } from "../actions";
import { TextAreaField } from "../cycle-fields";
import { FormStatus, PRIMARY_BUTTON, useCycleSave, useFieldError } from "../cycle-form-kit";

// One Group goal text (HR-05, Part 1): Polish and English side by side, one save for both. A type
// without a text is created on the first save; until then the cycle cannot open.

const FIELDS = ["contentPl", "contentEn"] as const;

type GroupGoalEditorProps = {
  cycleId: number;
  type: GroupGoalTypeValue;
  contentPl: string;
  contentEn: string;
  /** null when the cycle has no text of this type yet. */
  acknowledgements: number | null;
  isEditable: boolean;
};

export function GroupGoalEditor({ cycleId, type, contentPl, contentEn, acknowledgements, isEditable }: GroupGoalEditorProps) {
  const t = useTranslations("admin.cycles.groupGoals");
  const tGlossary = useTranslations("glossary");
  const [values, setValues] = useState({ contentPl, contentEn });
  const state = useCycleSave();
  const errorOf = useFieldError(state.fieldErrors);
  const titleId = `group-goal-${type}-title`;
  const isBusy = state.isPending;
  const isMissing = acknowledgements === null;

  const edit = (field: (typeof FIELDS)[number], value: string) => {
    if (isBusy) return;
    setValues((current) => ({ ...current, [field]: value }));
    state.markEdited();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isEditable) return;
    state.save({
      schema: groupGoalTextSchema,
      payload: { cycleId, type, ...values },
      action: saveGroupGoalTextAction,
      fields: FIELDS,
    });
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={titleId}
      className="rounded-2xl border border-line bg-surface p-4 shadow-panel sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={titleId} className="text-lg font-semibold text-ink">
          {tGlossary(`groupGoalTypes.${type}`)}
        </h3>
        <p className={`text-sm ${isMissing ? "font-semibold text-notice" : "text-ink-soft"}`}>
          {isMissing ? t("missing") : t("acknowledgements", { count: acknowledgements })}
        </p>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <TextAreaField
          id={`group-goal-${type}-pl`}
          label={t("contentPl")}
          hint={t("contentHint")}
          error={errorOf("contentPl")}
          value={values.contentPl}
          onChange={(value) => edit("contentPl", value)}
          maxLength={MAX_GROUP_GOAL_TEXT_LENGTH}
          lang="pl"
          isDisabled={!isEditable}
          isBusy={isBusy}
        />
        <TextAreaField
          id={`group-goal-${type}-en`}
          label={t("contentEn")}
          hint={t("contentHint")}
          error={errorOf("contentEn")}
          value={values.contentEn}
          onChange={(value) => edit("contentEn", value)}
          maxLength={MAX_GROUP_GOAL_TEXT_LENGTH}
          lang="en"
          isDisabled={!isEditable}
          isBusy={isBusy}
        />
      </div>
      {isEditable && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
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
