"use client";

import { useTranslations } from "next-intl";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/shell/icons";
import { GOAL_WEIGHT_MAX, GOAL_WEIGHT_MIN } from "@/domain/performance-goal";
import { helpId } from "./goal-field";

// G2-17 weight (IMG15): whole number with up / down arrows and a "%" sign. A native number input,
// so ArrowUp / ArrowDown step from the keyboard; the arrow buttons are for the mouse and touch
// (tabIndex -1: one tab stop per field). The value stays text so a wrong entry (0, 101, 12.5)
// reaches the shared schema and is reported, not silently corrected.

type WeightInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  hasError?: boolean;
  disabled?: boolean;
};

function stepped(value: string, step: number): string {
  const current = Number.parseInt(value, 10);
  const base = Number.isNaN(current) ? (step > 0 ? GOAL_WEIGHT_MIN - 1 : GOAL_WEIGHT_MAX + 1) : current;
  return String(Math.min(GOAL_WEIGHT_MAX, Math.max(GOAL_WEIGHT_MIN, base + step)));
}

export function WeightInput({ id, value, onChange, onBlur, hasError = false, disabled = false }: WeightInputProps) {
  const t = useTranslations("goalControls");
  const border = hasError ? "border-danger" : "border-line-strong";
  const stepButton = (step: 1 | -1) => (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      aria-label={step > 0 ? t("increase") : t("decrease")}
      title={step > 0 ? t("increase") : t("decrease")}
      onClick={() => onChange(stepped(value, step))}
      className="flex h-11 w-9 cursor-pointer items-center justify-center text-ink-soft transition-colors duration-200 hover:bg-accent/10 hover:text-accent disabled:cursor-wait motion-reduce:transition-none"
    >
      {step > 0 ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
    </button>
  );

  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-xl border bg-surface transition-colors duration-200 focus-within:border-accent focus-within:outline-3 focus-within:outline-accent/25 hover:border-accent motion-reduce:transition-none ${border}`}
    >
      <input
        id={id}
        name="weight"
        type="number"
        inputMode="numeric"
        min={GOAL_WEIGHT_MIN}
        max={GOAL_WEIGHT_MAX}
        step={1}
        value={value}
        disabled={disabled}
        aria-describedby={helpId(id)}
        aria-invalid={hasError || undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="min-h-11 w-full min-w-0 [appearance:textfield] bg-transparent px-4 py-2.5 text-base text-ink tabular-nums focus:outline-none disabled:cursor-wait [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span aria-hidden="true" className="flex items-center pr-2 text-lg font-semibold text-accent">
        %
      </span>
      <div className="flex border-l border-line">
        {stepButton(-1)}
        {stepButton(1)}
      </div>
    </div>
  );
}
