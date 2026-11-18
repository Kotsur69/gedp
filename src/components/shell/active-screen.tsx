"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { tabForSegments, type TabId } from "@/components/shell/tabs";

// Both components read the active screen from the route tree (useSelectedLayoutSegments), not from
// the browser URL: proxy.ts rewrites every page to /[locale]/..., and usePathname() would differ
// between the prerendered shell and the browser (hydration mismatch).

export type ShellTab = { id: TabId; href: string; label: string };

type MainTabsProps = {
  /** Already filtered by role on the server, in screen order. */
  tabs: readonly ShellTab[];
  /** Accessible name of the nav landmark ("Menu główne"). */
  label: string;
};

/** Main tabs (HOME-12). Scrolls sideways on a phone instead of wrapping or overflowing the page. */
export function MainTabs({ tabs, label }: MainTabsProps) {
  const activeTab = tabForSegments(useSelectedLayoutSegments());
  return (
    <nav aria-label={label} className="-mx-4 sm:mx-0">
      <ul className="scrollbar-none flex snap-x overflow-x-auto px-4 sm:px-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <li key={tab.id} className="shrink-0 snap-start">
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                // Inset focus ring: the horizontal scroller clips anything drawn outside the link.
                className={`group relative flex min-h-12 items-center px-3 text-sm whitespace-nowrap focus-visible:-outline-offset-2 transition-colors duration-200 motion-reduce:transition-none sm:px-4 ${
                  isActive ? "font-semibold text-ink" : "text-ink-soft hover:text-accent"
                }`}
              >
                {tab.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 bottom-0 h-[3px] rounded-full transition-opacity duration-200 motion-reduce:transition-none sm:inset-x-4 ${
                    isActive ? "bg-(image:--am-gradient) opacity-100" : "bg-line-strong opacity-0 group-hover:opacity-100"
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type ScreenTitleProps = {
  /** "GEDP 2027 – Moje informacje" per tab, formatted on the server. */
  titles: Readonly<Record<TabId, string>>;
  /** For screens outside the main tabs: the app name alone. */
  fallback: string;
};

/** "App name – screen name" in the header (HOME-16). Wraps rather than truncates on a phone. */
export function ScreenTitle({ titles, fallback }: ScreenTitleProps) {
  const activeTab = tabForSegments(useSelectedLayoutSegments());
  return (
    <p className="text-base font-semibold text-balance text-ink sm:text-lg">
      {activeTab ? titles[activeTab] : fallback}
    </p>
  );
}
