import type { ReactNode } from "react";

// Footer buttons of the goal windows. Two kinds of "not now":
// - isBusy: a save is running; the button keeps focus but does nothing (aria-busy).
// - isDisabled: the action is not allowed yet (G2-21 "Dodaj do planu" before the form is valid).
//   aria-disabled instead of the disabled attribute, so keyboard users can still reach the button
//   and hear why (describedBy); the click handler decides what a press does in that state.

type GoalActionButtonProps = {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  isBusy?: boolean;
  isDisabled?: boolean;
  describedBy?: string;
  id?: string;
  /** Marks the button a goal window focuses first when it opens (data-initial-focus). */
  isInitialFocus?: boolean;
};

const VARIANT_CLASSES = {
  primary: "bg-(image:--am-gradient) tracking-[0.04em] text-on-brand hover:opacity-90",
  secondary: "border border-line-strong bg-surface text-ink hover:border-accent hover:text-accent",
  danger: "border border-danger/60 bg-surface text-danger hover:bg-danger hover:text-on-solid",
} as const;

const DISABLED_CLASSES = "cursor-not-allowed bg-line text-ink-soft";

export function GoalActionButton(props: GoalActionButtonProps) {
  const { children, onClick, variant = "primary", isBusy = false, isDisabled = false, describedBy, id } = props;
  const initialFocus = props.isInitialFocus ? { "data-initial-focus": "" } : {};
  const look = isDisabled ? DISABLED_CLASSES : `cursor-pointer ${VARIANT_CLASSES[variant]}`;
  return (
    <button
      id={id}
      {...initialFocus}
      type="button"
      onClick={isBusy ? undefined : onClick}
      aria-disabled={isBusy || isDisabled || undefined}
      aria-busy={isBusy || undefined}
      aria-describedby={describedBy}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-5 font-semibold transition duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${look} ${isBusy ? "cursor-wait opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}
