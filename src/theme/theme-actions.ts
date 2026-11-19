"use server";

import { cookies } from "next/headers";
import { isTheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE_SECONDS } from "@/theme/config";

/** Stores the chosen colour theme. The switcher already updated <html data-theme> itself. */
export async function setThemeAction(theme: unknown): Promise<void> {
  if (!isTheme(theme)) throw new Error("Unsupported theme");
  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    // Production is served over HTTPS; browsers also accept Secure cookies on http://localhost.
    secure: process.env.NODE_ENV === "production",
  });
}
