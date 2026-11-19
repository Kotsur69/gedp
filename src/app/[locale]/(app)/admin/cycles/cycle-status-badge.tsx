import type { CycleStatus } from "@/generated/prisma/enums";

// Cycle status badge (HR-05). Same convention as the document status: the text carries the
// meaning, the tone only reinforces it. No hooks, so server and client components can both use it.

const CYCLE_STATUS_TONE: Readonly<Record<CycleStatus, string>> = {
  PRZYGOTOWANIE: "border-brand-orange/60 bg-notice-surface text-notice",
  OTWARTY: "border-transparent bg-accent text-on-solid",
  ZAMKNIETY: "border-line-strong text-ink-soft",
};

type CycleStatusBadgeProps = {
  status: CycleStatus;
  label: string;
};

export function CycleStatusBadge({ status, label }: CycleStatusBadgeProps) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-3 text-sm font-semibold whitespace-nowrap ${CYCLE_STATUS_TONE[status]}`}
    >
      {label}
    </span>
  );
}
