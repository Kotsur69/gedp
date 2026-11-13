"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "link";
};

const VARIANT_CLASSES: Record<NonNullable<SubmitButtonProps["variant"]>, string> = {
  // Same CTA as AMSteel_Quote: the full AM gradient with spaced white label.
  primary:
    "h-12 w-full rounded-xl bg-(image:--am-gradient) px-6 font-semibold tracking-[0.06em] text-white hover:opacity-90 disabled:opacity-60",
  secondary:
    "h-11 rounded-xl border border-line-strong bg-white px-5 font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-60",
  link: "min-h-11 px-1 text-sm font-semibold text-ink-soft underline-offset-4 hover:text-accent hover:underline disabled:opacity-60",
};

/** Submit button that disables itself and swaps its label while the parent form's action runs. */
export function SubmitButton({ children, pendingLabel, variant = "primary" }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`cursor-pointer transition duration-200 motion-reduce:transition-none disabled:cursor-wait ${VARIANT_CLASSES[variant]}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
