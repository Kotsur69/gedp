import type { ReactNode } from "react";

// One labelled form field of a goal form (G2-22): label, control, and ONE help line under the
// control. The help line shows the hint; an error replaces it, in red, and turns the label red.
// Both live in the same element (id `${id}-help`), so the control's aria-describedby never changes
// and screen readers hear the error when it appears (aria-live).

export const helpId = (id: string): string => `${id}-help`;
/** Id of the visible label; popup triggers are named by "label + current value" with it. */
export const labelId = (id: string): string => `${id}-label`;

/** Props every control in a GoalField spreads: described by the help line, invalid when erroring. */
export function describedControl(id: string, hasError: boolean) {
  return { id, "aria-describedby": helpId(id), "aria-invalid": hasError || undefined } as const;
}

type GoalFieldProps = {
  id: string;
  label: string;
  hint: string;
  error: string | null;
  /** "(required field)" for screen readers, next to the visible "*". */
  requiredText?: string;
  /** Bigger label for the goal title (IMG11 shows it as the form heading). */
  isProminent?: boolean;
  className?: string;
  children: ReactNode;
};

export function GoalField({ id, label, hint, error, requiredText, isProminent = false, className = "", children }: GoalFieldProps) {
  const labelTone = error ? "text-danger" : "text-ink";
  const labelSize = isProminent ? "text-lg" : "text-sm";
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <label id={labelId(id)} htmlFor={id} className={`${labelSize} font-semibold transition-colors duration-200 ${labelTone}`}>
        {label}
        {requiredText && (
          <>
            {" "}
            <span aria-hidden="true" className="text-danger">
              *
            </span>
            <span className="sr-only">{requiredText}</span>
          </>
        )}
      </label>
      <div className="mt-2">{children}</div>
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

/** Shared look of text inputs, textareas and selects in goal forms; red border when invalid. */
export const GOAL_CONTROL_CLASSES =
  "min-h-11 w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-base text-ink transition-colors duration-200 hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-accent/25 aria-invalid:border-danger disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none";
