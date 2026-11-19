"use server";

import { refresh } from "next/cache";
import type { CycleConfigErrorCode, CycleConfigFieldErrors, ReadinessGap } from "@/domain/cycle-config";
import {
  changeCycleStatus,
  createCycle,
  CycleAdminError,
  updateCycleSettings,
  type WriteResult,
} from "@/server/cycle-admin";
import { moveTargetType, saveCatalogItem, saveGroupGoalText, saveTargetType } from "@/server/cycle-catalog";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { isAccessError, type Viewer } from "@/server/permissions";

// Server Actions of the HR cycle panel (HR-05). Every payload is untrusted: cycle-admin.ts and
// cycle-catalog.ts validate it with the shared zod schemas and re-check HR against the live row
// inside the write transaction. The viewer always comes from the session, never from the payload.

export type CycleActionErrorCode = CycleConfigErrorCode | "FORBIDDEN" | "FAILED";
export type CycleActionFailure = {
  ok: false;
  code: CycleActionErrorCode;
  fieldErrors: CycleConfigFieldErrors;
  /** NOT_READY: what the cycle still lacks before it can open. */
  gaps: readonly ReadinessGap[];
};
export type CycleActionResult = { ok: true; changed: boolean } | CycleActionFailure;
export type CreateCycleActionResult = { ok: true; year: number } | CycleActionFailure;

/**
 * Codes that mean the page shows outdated data: re-render it with the saved state. NOT_READY too:
 * the page's readiness list (what the status buttons check) was older than the server's.
 */
const STALE_PAGE_CODES: ReadonlySet<CycleConfigErrorCode> = new Set([
  "NOT_FOUND",
  "CYCLE_CLOSED",
  "ANOTHER_OPEN",
  "NOT_READY",
]);

function failure(
  code: CycleActionErrorCode,
  fieldErrors: CycleConfigFieldErrors = {},
  gaps: readonly ReadinessGap[] = [],
): CycleActionFailure {
  return { ok: false, code, fieldErrors, gaps };
}

function toFailure(error: unknown): CycleActionFailure {
  if (error instanceof CycleAdminError) {
    if (STALE_PAGE_CODES.has(error.code)) refresh();
    return failure(error.code, error.fieldErrors, error.gaps);
  }
  if (isAccessError(error)) return failure("FORBIDDEN");
  // Name and Prisma code only: the raw error may echo query arguments.
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[admin/cycles] write failed: ${name} (${code})`);
  return failure("FAILED");
}

type Write = (viewer: Viewer, input: unknown) => Promise<WriteResult>;

/** Session HR check, the write, then a re-render when something changed. */
async function run(write: Write, input: unknown): Promise<CycleActionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return failure("FORBIDDEN");
  let result: WriteResult;
  try {
    result = await write(viewer, input);
  } catch (error: unknown) {
    return toFailure(error);
  }
  if (result.changed) refresh();
  return { ok: true, changed: result.changed };
}

/** "Utwórz cykl": empty or a copy of an existing cycle. The client then opens the new cycle. */
export async function createCycleAction(input: unknown): Promise<CreateCycleActionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return failure("FORBIDDEN");
  try {
    const created = await createCycle(db(), viewer, input);
    return { ok: true, year: created.year };
  } catch (error: unknown) {
    return toFailure(error);
  }
}

/**
 * A changed year moves the page to /admin/cycles/<new year>: no refresh then, since re-rendering the
 * old address would hit "not found" before the client navigates to the new one.
 */
export async function updateCycleSettingsAction(input: unknown): Promise<CycleActionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return failure("FORBIDDEN");
  try {
    const result = await updateCycleSettings(db(), viewer, input);
    if (result.changed && !result.yearChanged) refresh();
    return { ok: true, changed: result.changed };
  } catch (error: unknown) {
    return toFailure(error);
  }
}

export async function changeCycleStatusAction(input: unknown): Promise<CycleActionResult> {
  return run((viewer, payload) => changeCycleStatus(db(), viewer, payload), input);
}

export async function saveGroupGoalTextAction(input: unknown): Promise<CycleActionResult> {
  return run((viewer, payload) => saveGroupGoalText(db(), viewer, payload), input);
}

export async function saveCatalogItemAction(input: unknown): Promise<CycleActionResult> {
  return run((viewer, payload) => saveCatalogItem(db(), viewer, payload), input);
}

export async function saveTargetTypeAction(input: unknown): Promise<CycleActionResult> {
  return run((viewer, payload) => saveTargetType(db(), viewer, payload), input);
}

export async function moveTargetTypeAction(input: unknown): Promise<CycleActionResult> {
  return run((viewer, payload) => moveTargetType(db(), viewer, payload), input);
}
