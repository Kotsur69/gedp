// Shared class names of the HR export form, matching the other HR panel forms.

export const LABEL = "block text-sm font-semibold text-ink";

export const CONTROL =
  "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink transition duration-200 hover:border-accent focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent/40 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

export const SECONDARY_BUTTON =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line-strong bg-surface px-5 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

export const PRIMARY_BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/** A selectable card (checkbox or radio inside a label). */
export const CHOICE_CARD =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line-strong px-3 py-3 transition duration-200 hover:border-accent has-checked:border-accent has-checked:bg-canvas has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent/40 motion-reduce:transition-none";
