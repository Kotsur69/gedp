"use client";

import { type ReactNode, useState, useTransition } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/shell/icons";
import { THEMES, type Theme } from "@/theme/config";
import { setThemeAction } from "@/theme/theme-actions";

type ThemeSwitcherProps = {
  current: Theme;
  /** Group label in the current UI language, e.g. "Motyw". */
  label: string;
  /** Screen-reader name and tooltip of each option ("Jasny", "Ciemny", "Systemowy"). */
  names: Readonly<Record<Theme, string>>;
  /** Announced when the choice could not be saved (the theme then reverts). */
  errorMessage: string;
};

const ICONS: Readonly<Record<Theme, ReactNode>> = {
  light: <SunIcon />,
  dark: <MoonIcon />,
  system: <MonitorIcon />,
};

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Light | dark | system segmented switch. Applies the theme at once (the <html> attribute drives
 * globals.css), then stores it in a cookie so the server renders it on the next load, no flash.
 */
export function ThemeSwitcher({ current, label, names, errorMessage }: ThemeSwitcherProps) {
  const [selected, setSelected] = useState<Theme>(current);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSelect = (theme: Theme) => {
    if (theme === selected || isPending) return;
    const previous = selected;
    setSelected(theme);
    setFailed(false);
    applyTheme(theme);
    startTransition(async () => {
      try {
        await setThemeAction(theme);
      } catch {
        // Not saved: go back to what the server will render on the next load.
        setSelected(previous);
        applyTheme(previous);
        setFailed(true);
      }
    });
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={isPending}
      className="relative inline-flex shrink-0 items-center rounded-full border border-line bg-surface/70 p-0.5"
    >
      {THEMES.map((theme) => {
        const isActive = theme === selected;
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={isActive}
            aria-label={names[theme]}
            title={names[theme]}
            // aria-disabled, not disabled: a disabled button would drop keyboard focus to <body>.
            // handleSelect ignores clicks while the save is pending.
            aria-disabled={isPending}
            onClick={() => handleSelect(theme)}
            className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none aria-disabled:cursor-wait ${
              isActive ? "bg-(image:--am-gradient) text-on-brand" : "text-ink-soft hover:text-accent"
            }`}
          >
            {ICONS[theme]}
          </button>
        );
      })}
      {/* Visible and announced; cleared on the next choice. */}
      <span
        role="status"
        className={
          failed
            ? "absolute top-full right-0 z-30 mt-1.5 w-max max-w-64 rounded-lg border border-danger/40 bg-surface px-3 py-1.5 text-xs font-semibold text-danger shadow-panel"
            : "sr-only"
        }
      >
        {failed ? errorMessage : ""}
      </span>
    </div>
  );
}
