"use client";

import { useOptimistic, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { setCycleYearAction } from "@/server/cycle-actions";
import { CalendarIcon, ChevronDownIcon } from "@/components/shell/icons";

type CycleYearSelectProps = {
  options: readonly { year: number; label: string }[];
  selectedYear: number;
  /** Visible label ("Rok cyklu"). */
  label: string;
  /** Shown when the server refuses the change. */
  errorMessage: string;
};

/**
 * Cycle year switch in the header (NFR-05, HOME-16). A native select: keyboard, screen reader and
 * the phone's own picker work without extra code. The server stores the choice in a cookie, then
 * the router refreshes so every server component re-reads the selected cycle.
 */
export function CycleYearSelect({ options, selectedYear, label, errorMessage }: CycleYearSelectProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticYear, setOptimisticYear] = useOptimistic(selectedYear);
  const [hasError, setHasError] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const year = Number(event.target.value);
    setHasError(false);
    startTransition(async () => {
      setOptimisticYear(year);
      try {
        await setCycleYearAction(year);
      } catch {
        // The optimistic value rolls back when the transition ends; tell the person why.
        setHasError(true);
        return;
      }
      // Updates after an await need their own transition to keep `isPending` until the refresh lands.
      startTransition(() => router.refresh());
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {/* Screen-reader label: visually the calendar icon and the year say it. */}
        <label htmlFor="cycle-year" className="sr-only">
          {label}
        </label>
        <div className="relative">
          <CalendarIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-accent" />
          <select
            id="cycle-year"
            value={optimisticYear}
            onChange={handleChange}
            // Not `disabled` while saving: a disabled control drops keyboard focus to <body>.
            // The optimistic value already shows the choice; a second change simply queues.
            aria-busy={isPending}
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? "cycle-year-error" : undefined}
            className="field-sizing-content min-h-11 cursor-pointer appearance-none rounded-full border border-line-strong bg-surface py-2 pr-9 pl-9 text-base font-semibold text-ink tabular-nums transition-colors duration-200 hover:border-accent aria-busy:cursor-wait motion-reduce:transition-none"
          >
            {options.map((option) => (
              <option key={option.year} value={option.year}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-soft" />
        </div>
      </div>
      {hasError && (
        <p id="cycle-year-error" role="alert" className="text-xs font-semibold text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
