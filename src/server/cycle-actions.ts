"use server";

import { cookies } from "next/headers";
import { requireEmployee } from "@/server/current-employee";
import {
  CYCLE_YEAR_COOKIE,
  CYCLE_YEAR_COOKIE_MAX_AGE_SECONDS,
  loadCycleOptions,
  parseCycleYear,
} from "@/server/cycles";

/**
 * Stores the cycle year picked in the header (NFR-05). The caller refreshes the router so every
 * server component re-reads getSelectedCycle(). The client sends the year as a number; anything
 * else is a hand-crafted request and is refused before touching the session or the database.
 */
export async function setCycleYearAction(year: unknown): Promise<void> {
  const parsed = typeof year === "number" ? parseCycleYear(year) : null;
  if (parsed === null) throw new Error("Invalid cycle year");

  const employee = await requireEmployee();
  const options = await loadCycleOptions(employee.isHrAdmin);
  if (!options.some((option) => option.year === parsed)) throw new Error("Cycle year not available");

  (await cookies()).set(CYCLE_YEAR_COOKIE, String(parsed), {
    path: "/",
    maxAge: CYCLE_YEAR_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    // Production is served over HTTPS; browsers also accept Secure cookies on http://localhost.
    secure: process.env.NODE_ENV === "production",
  });
}
