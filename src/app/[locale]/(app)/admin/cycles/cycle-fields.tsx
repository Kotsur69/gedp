"use client";

import { describedControl, GOAL_CONTROL_CLASSES, GoalField, helpId } from "@/components/goals/goal-field";

// Labelled controls of the HR cycle panel (HR-05), built on the goal forms' GoalField: label,
// control and ONE help line that turns into the error (aria-live), so every screen reads the same.
//
// Two different "off" states: `isDisabled` for a field that cannot change at all (closed cycle,
// fixed code), and `isBusy` while a save runs. A busy field stays focusable (read-only, or a
// checkbox that ignores clicks): disabling the focused input would drop keyboard focus to <body>.

const READ_ONLY_TONE = "read-only:bg-canvas";

type BaseFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error: string | null;
  isDisabled?: boolean;
  isBusy?: boolean;
  /** Focus on mount: for a form the user just opened (inline edit, "Dodaj"). */
  hasInitialFocus?: boolean;
  className?: string;
};

type TextFieldProps = BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  isUppercase?: boolean;
};

export function TextField({
  id,
  label,
  hint = "",
  error,
  isDisabled,
  isBusy,
  hasInitialFocus,
  className,
  value,
  onChange,
  maxLength,
  isUppercase = false,
}: TextFieldProps) {
  return (
    <GoalField id={id} label={label} hint={hint} error={error} className={className}>
      <input
        {...describedControl(id, error !== null)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isDisabled}
        readOnly={isBusy}
        autoFocus={hasInitialFocus}
        // One over the limit, so the schema can say "too long" instead of the browser cutting silently.
        maxLength={maxLength + 1}
        autoComplete="off"
        spellCheck={!isUppercase}
        className={`${GOAL_CONTROL_CLASSES} ${READ_ONLY_TONE} ${isUppercase ? "uppercase" : ""}`}
      />
    </GoalField>
  );
}

type NumberFieldProps = BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
};

export function NumberField({
  id,
  label,
  hint = "",
  error,
  isDisabled,
  isBusy,
  className,
  value,
  onChange,
  min,
  max,
}: NumberFieldProps) {
  return (
    <GoalField id={id} label={label} hint={hint} error={error} className={className}>
      <input
        {...describedControl(id, error !== null)}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isDisabled}
        readOnly={isBusy}
        className={`${GOAL_CONTROL_CLASSES} ${READ_ONLY_TONE} tabular-nums`}
      />
    </GoalField>
  );
}

type TextAreaFieldProps = BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  lang: "pl" | "en";
};

export function TextAreaField({
  id,
  label,
  hint = "",
  error,
  isDisabled,
  isBusy,
  className,
  value,
  onChange,
  maxLength,
  lang,
}: TextAreaFieldProps) {
  return (
    <GoalField id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        {...describedControl(id, error !== null)}
        lang={lang}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isDisabled}
        readOnly={isBusy}
        maxLength={maxLength + 1}
        rows={10}
        className={`${GOAL_CONTROL_CLASSES} ${READ_ONLY_TONE} min-h-48 resize-y leading-relaxed`}
      />
    </GoalField>
  );
}

type CheckboxFieldProps = {
  id: string;
  label: string;
  hint: string;
  error: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
  isDisabled?: boolean;
  isBusy?: boolean;
};

/** A checkbox with its label as one 44px target; the hint (or error) sits under it. */
export function CheckboxField({ id, label, hint, error, checked, onChange, isDisabled, isBusy }: CheckboxFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line-strong px-3 transition duration-200 hover:border-accent has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:border-line-strong has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent/40 motion-reduce:transition-none"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => !isBusy && onChange(event.target.checked)}
          disabled={isDisabled}
          aria-describedby={helpId(id)}
          aria-invalid={error ? true : undefined}
          className="size-5 shrink-0 accent-(--color-accent)"
        />
        <span className="font-semibold text-ink">{label}</span>
      </label>
      <p
        id={helpId(id)}
        aria-live="polite"
        className={`mt-1.5 text-sm leading-snug ${error ? "font-semibold text-danger" : "text-ink-soft"}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}
