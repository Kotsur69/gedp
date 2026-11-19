import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { CycleStatus } from "@/generated/prisma/enums";
import { MAX_CYCLE_YEAR, MIN_CYCLE_YEAR } from "@/domain/cycle-config";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";

// Cycle year chosen in the header (NFR-05, HOME-16). The choice lives in a cookie, like the
// language, so URLs stay the same for every year. It is only a preference: every read goes through
// pickCycle, which ignores a year the person may not see, and a year that is not OPEN is read-only.
// Pages and server actions read the year from getSelectedCycle(), never from input.

export const CYCLE_YEAR_COOKIE = "GEDP_CYCLE_YEAR";
export const CYCLE_YEAR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface CycleOption {
  year: number;
  status: CycleStatus;
}

export interface SelectedCycle extends CycleOption {
  /** True unless the cycle is open: goals and documents of that year can be viewed, not changed. */
  isReadOnly: boolean;
}

export interface CycleChoice {
  /** Years offered in the selector, newest first. */
  options: readonly CycleOption[];
  /** null only when no cycle exists yet. */
  selected: SelectedCycle | null;
}

/**
 * A four-digit year within MIN_CYCLE_YEAR..MAX_CYCLE_YEAR (shared with the HR-05 cycle panel), or
 * null: anything else in the cookie, a URL or an action payload is noise. Accepts a string or a number.
 */
export function parseCycleYear(raw: unknown): number | null {
  const year = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : raw;
  if (typeof year !== "number" || !Number.isInteger(year)) return null;
  return year >= MIN_CYCLE_YEAR && year <= MAX_CYCLE_YEAR ? year : null;
}

/** Only an open cycle accepts changes. Closed years and a cycle in preparation are view-only. */
export function isCycleReadOnly(status: CycleStatus): boolean {
  return status !== "OTWARTY";
}

/**
 * Which cycles the selector offers. A cycle in preparation is HR's work in progress (templates,
 * competencies), so only HR sees it before it opens. Assumption until HR says otherwise.
 */
export function visibleCycleStatuses(isHrAdmin: boolean): CycleStatus[] {
  return isHrAdmin ? ["PRZYGOTOWANIE", "OTWARTY", "ZAMKNIETY"] : ["OTWARTY", "ZAMKNIETY"];
}

/**
 * The cycle to show: the requested year if it is on offer, otherwise the open cycle, otherwise the
 * newest one. `options` must be sorted newest first.
 */
export function pickCycle(options: readonly CycleOption[], requestedYear: number | null): SelectedCycle | null {
  const cycle =
    options.find((option) => option.year === requestedYear) ??
    options.find((option) => option.status === "OTWARTY") ??
    options[0];
  return cycle ? { year: cycle.year, status: cycle.status, isReadOnly: isCycleReadOnly(cycle.status) } : null;
}

/** Cycles offered to this person, newest first. Deduplicated per request. */
export const loadCycleOptions = cache(async (isHrAdmin: boolean): Promise<CycleOption[]> => {
  return db().cycle.findMany({
    where: { status: { in: visibleCycleStatuses(isHrAdmin) } },
    select: { year: true, status: true },
    orderBy: { year: "desc" },
  });
});

/** Years on offer and the one selected for the signed-in person. Redirects when signed out. */
export const getCycleChoice = cache(async (): Promise<CycleChoice> => {
  const employee = await requireEmployee();
  const [options, cookieStore] = await Promise.all([loadCycleOptions(employee.isHrAdmin), cookies()]);
  const requested = parseCycleYear(cookieStore.get(CYCLE_YEAR_COOKIE)?.value);
  return { options, selected: pickCycle(options, requested) };
});

/** The cycle every page and action of this request works on (null when no cycle exists yet). */
export async function getSelectedCycle(): Promise<SelectedCycle | null> {
  return (await getCycleChoice()).selected;
}
