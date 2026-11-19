// Colour theme preference (opt-in dark mode). No `server-only`: the client switcher imports this.
//
// The root layout writes the choice as <html data-theme="...">; globals.css maps "dark" (and
// "system" when the OS prefers dark) onto the dark token block. The server knows the cookie, so
// the first paint already has the right theme and no script runs before it.

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Light stays the default until the person picks something else. */
export const DEFAULT_THEME: Theme = "light";

export const THEME_COOKIE = "GEDP_THEME";
// A UI preference, not personal data; remembered for a year so it survives sign-out.
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Cookie value -> supported theme; anything missing or unknown falls back to light. */
export function resolveTheme(cookieValue: string | undefined): Theme {
  return isTheme(cookieValue) ? cookieValue : DEFAULT_THEME;
}
