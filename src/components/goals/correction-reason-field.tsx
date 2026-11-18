"use client";

import { useTranslations } from "next-intl";
import { HR_CORRECTION_REASON_MAX_LENGTH, type HrCorrectionReasonErrorCode } from "@/domain/hr-correction";
import { describedControl, GOAL_CONTROL_CLASSES, GoalField } from "./goal-field";

// HR-07: the required "reason for the correction" of every HR change to someone's document. It
// sits under the corrected fields in the goal windows and the BHP window, and is stored in the
// audit row. The server checks it again (src/domain/hr-correction.ts).

type CorrectionReasonFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: HrCorrectionReasonErrorCode | null;
  isPending: boolean;
};

export function CorrectionReasonField({ id, value, onChange, error, isPending }: CorrectionReasonFieldProps) {
  const t = useTranslations("hrCorrection");
  const length = value.trim().length;
  const errorText = error ? t(`errors.${error}`, { max: HR_CORRECTION_REASON_MAX_LENGTH }) : null;
  return (
    <div className="mt-6 rounded-2xl border border-brand-orange/60 bg-notice-surface/60 p-4 sm:p-5">
      <GoalField
        id={id}
        label={t("reasonLabel")}
        hint={t("reasonHint", { count: length, max: HR_CORRECTION_REASON_MAX_LENGTH })}
        error={errorText}
        requiredText={t("required")}
      >
        <textarea
          {...describedControl(id, error !== null)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={isPending}
          required
          rows={3}
          // One over the limit, so the form can say "too long" instead of the browser cutting silently.
          maxLength={HR_CORRECTION_REASON_MAX_LENGTH + 1}
          className={`${GOAL_CONTROL_CLASSES} resize-y`}
        />
      </GoalField>
    </div>
  );
}
