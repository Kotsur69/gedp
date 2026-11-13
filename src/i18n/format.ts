import type { Locale } from "@/i18n/config";

// NFR-06: exactly one date format per language (eGEDP mixed four).
//   pl: 31.12.2026      en: 31 Dec 2026
// English uses the en-GB conventions (day first), which suit a European company.
const INTL_LOCALE: Readonly<Record<Locale, string>> = { pl: "pl-PL", en: "en-GB" };

const DATE_OPTIONS: Readonly<Record<Locale, Intl.DateTimeFormatOptions>> = {
  pl: { day: "2-digit", month: "2-digit", year: "numeric" },
  en: { day: "numeric", month: "short", year: "numeric" },
};

/** All dates are shown in company time, so server and browser render the same day. */
export const TIME_ZONE = "Europe/Warsaw";

/** Calendars start the week on Monday (G2-13; eGEDP used Sunday). ISO weekday: 1 = Monday. */
export const FIRST_DAY_OF_WEEK = 1;

export function formatDate(date: Date, locale: Locale): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("formatDate: invalid date");
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...DATE_OPTIONS[locale], timeZone: TIME_ZONE }).format(date);
}
