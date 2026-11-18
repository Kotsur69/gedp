import type { ReactNode } from "react";
import Link from "next/link";
import { CheckIcon } from "@/components/shell/icons";

// Layout pieces shared by the Goal Centre screens (Part 1 on /goal-centre, Part 3 on
// /goal-centre/development). Server-renderable: no state, no handlers.

export function Panel({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      {children}
    </section>
  );
}

export type CounterItem = {
  key: string;
  label: string;
  value: number;
  /** Ring classes; the label carries the meaning, the colour only supports it. */
  tone?: string;
};

/** Round counters with a label underneath: WF-23 totals across all parts, G3-04 progress counters. */
export function CounterRings({ label, items }: { label: string; items: readonly CounterItem[] }) {
  return (
    <dl aria-label={label} className="flex flex-wrap gap-3 sm:gap-5">
      {items.map((item) => (
        <div key={item.key} className="flex w-24 flex-col-reverse items-center gap-2 text-center">
          <dt className="text-xs leading-tight font-semibold text-ink-soft">{item.label}</dt>
          <dd
            className={`flex size-14 items-center justify-center rounded-full border-2 bg-surface text-xl font-semibold text-ink tabular-nums ${item.tone ?? "border-line-strong"}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type SectionChip = {
  key: string;
  text: string;
  /** G1-10 / G3-04: every chip has a check mark except "Anulowane". */
  hasCheck?: boolean;
};

/** Display only until Q-16 decides whether the chips filter the cards. */
export function SectionChips({ label, chips }: { label: string; chips: readonly SectionChip[] }) {
  return (
    <ul aria-label={label} className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink tabular-nums"
        >
          {chip.hasCheck !== false && <CheckIcon className="size-3.5 text-accent" />}
          {chip.text}
        </li>
      ))}
    </ul>
  );
}

export type GoalCentreView = "mine" | "team";

type ViewSwitchProps = {
  active: GoalCentreView;
  /** Accessible name of the switch ("Widok Centrum celów"). */
  label: string;
  labels: Readonly<Record<GoalCentreView, string>>;
};

const VIEW_HREF: Readonly<Record<GoalCentreView, string>> = { mine: "/goal-centre", team: "/goal-centre/team" };
const VIEWS: readonly GoalCentreView[] = ["mine", "team"];

/**
 * WF-20 "Moje cele | Mój zespół", top right of Goal Centre (IMG03). Rendered only for people with
 * a team; the team page guards itself as well. Two links, so each view has its own URL.
 */
export function ViewSwitch({ active, label, labels }: ViewSwitchProps) {
  return (
    <nav aria-label={label} className="shrink-0">
      <ul className="inline-flex rounded-2xl border border-line-strong bg-canvas p-1">
        {VIEWS.map((view) => {
          const isActive = view === active;
          return (
            <li key={view}>
              <Link
                href={VIEW_HREF[view]}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-200 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
                  isActive ? "bg-(image:--am-gradient) text-on-brand shadow-panel" : "text-ink-soft hover:text-accent"
                }`}
              >
                {labels[view]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-4 rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
      {children}
    </p>
  );
}
