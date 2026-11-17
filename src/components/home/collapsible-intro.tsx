"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/shell/icons";

interface CollapsibleIntroProps {
  children: ReactNode;
  /** Constant accessible name; aria-expanded carries the state, so the name never contradicts it. */
  label: string;
  /** Tooltip hints for pointer users. */
  expandLabel: string;
  collapseLabel: string;
}

/**
 * HOME-11: the intro text folds away with an arrow button under it. Open by default. While
 * collapsed the content is `inert`, so its links leave the tab order and screen readers skip it.
 */
export function CollapsibleIntro({ children, label, expandLabel, collapseLabel }: CollapsibleIntroProps) {
  const [isOpen, setIsOpen] = useState(true);
  const contentId = useId();

  return (
    <div className="mt-4">
      <div
        id={contentId}
        inert={!isOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
      <div className="relative mt-4 flex justify-center before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-line">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          aria-label={label}
          title={isOpen ? collapseLabel : expandLabel}
          onClick={() => setIsOpen((open) => !open)}
          className="group relative flex size-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-8 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-soft shadow-panel transition-colors duration-200 group-hover:border-accent group-hover:text-accent motion-reduce:transition-none">
            <ChevronDownIcon
              className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
