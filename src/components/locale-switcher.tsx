"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/i18n/locale-actions";
import { LOCALES, type Locale } from "@/i18n/config";

type LocaleSwitcherProps = {
  current: Locale;
  /** Group label in the current UI language, e.g. "Język". */
  label: string;
  /** Endonyms for the screen-reader name of each option ("Polski", "English"). */
  names: Readonly<Record<Locale, string>>;
};

/** PL | EN segmented switch (NFR-01). Stores the choice in a cookie, then re-renders the page. */
export function LocaleSwitcher({ current, label, names }: LocaleSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSelect = (locale: Locale) => {
    if (locale === current || isPending) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      // Updates after an await need their own transition to keep `isPending` until the refresh lands.
      startTransition(() => router.refresh());
    });
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={isPending}
      className="inline-flex shrink-0 items-center rounded-full border border-line bg-white/70 p-0.5 text-xs font-semibold tracking-[0.06em]"
    >
      {LOCALES.map((locale) => {
        const isActive = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={isActive}
            aria-label={names[locale]}
            disabled={isPending}
            onClick={() => handleSelect(locale)}
            className={`min-h-11 min-w-11 cursor-pointer rounded-full px-2.5 uppercase transition-colors duration-200 motion-reduce:transition-none disabled:cursor-wait ${
              isActive ? "bg-(image:--am-gradient) text-white" : "text-ink-soft hover:text-accent"
            }`}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
