// Locale settings shared by proxy.ts, the request config and the switcher. No `server-only`:
// proxy.ts imports this too.
//
// The URL never carries the locale. proxy.ts rewrites every page request to the internal
// /[locale] segment chosen from the cookie, so each language keeps a static shell
// (cacheComponents) and links stay the same in both languages (NFR-01).

export const LOCALES = ["pl", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** NFR-01: Polish unless the person switched to English. Browser language is ignored on purpose. */
export const DEFAULT_LOCALE: Locale = "pl";

export const LOCALE_COOKIE = "NEXT_LOCALE";
// A UI preference, not personal data; remembered for a year so it survives sign-out.
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Cookie value -> supported locale; anything missing or unknown falls back to Polish. */
export function resolveLocale(cookieValue: string | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

// Route handlers (/api/...) and file-like paths (robots.txt, report.csv) live outside [locale].
const NOT_A_PAGE = /^\/api(?:\/|$)|\.[^/]+$/;

/**
 * Internal path a page request is rewritten to ("/" -> "/pl", "/login" -> "/en/login"),
 * or null when the request is not a page and must pass through unchanged.
 */
export function localizedPath(pathname: string, cookieValue: string | undefined): string | null {
  if (NOT_A_PAGE.test(pathname)) return null;
  const locale = resolveLocale(cookieValue);
  return pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
}
