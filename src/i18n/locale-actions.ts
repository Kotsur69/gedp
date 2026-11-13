"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS } from "@/i18n/config";

/** Stores the chosen UI language. The caller refreshes the router so proxy.ts picks it up. */
export async function setLocaleAction(locale: unknown): Promise<void> {
  if (!isLocale(locale)) throw new Error("Unsupported locale");
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    // Production is served over HTTPS; browsers also accept Secure cookies on http://localhost.
    secure: process.env.NODE_ENV === "production",
  });
}
