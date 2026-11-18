"use server";

import { refresh } from "next/cache";
import type { GoalField, GoalInputErrorCode } from "@/domain/performance-goal";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { copyPerformanceGoalsFromPreviousYear } from "@/server/performance-goal-copy";
import {
  cancelPerformanceGoal,
  createPerformanceGoal,
  deletePerformanceGoal,
  PerformanceGoalError,
  updatePerformanceGoal,
  updatePerformanceGoalAsValidator,
  correctPerformanceGoalAsHr,
  type PerformanceGoalErrorCode,
} from "@/server/performance-goals";
import { isAccessError } from "@/server/permissions";

// Server Actions of Goal Centre Part 2. The payload is untrusted: performance-goals.ts validates it
// with the shared zod schema (G2-24) and checks permission, document status and cycle inside the
// write transaction. The viewer always comes from the session, never from the payload.

export type PerformanceGoalActionErrorCode = PerformanceGoalErrorCode | "FORBIDDEN" | "FAILED";
export type PerformanceGoalFieldErrors = Partial<Record<GoalField, GoalInputErrorCode>>;
export type PerformanceGoalActionResult =
  | { ok: true }
  | { ok: false; code: PerformanceGoalActionErrorCode; fieldErrors: PerformanceGoalFieldErrors };

/** Rule conflicts that mean the page shows stale data: re-render it with the saved state. */
const STALE_PAGE_CODES: ReadonlySet<PerformanceGoalErrorCode> = new Set([
  "NOT_EDITABLE",
  "GOAL_CANCELLED",
  "DOCUMENT_ALREADY_SENT",
  "DOCUMENT_NOT_SENT",
  "NOTHING_TO_COPY",
]);

function failure(error: unknown, step: string): PerformanceGoalActionResult {
  if (error instanceof PerformanceGoalError) {
    if (STALE_PAGE_CODES.has(error.code)) refresh();
    const fieldErrors: PerformanceGoalFieldErrors = {};
    for (const issue of error.issues) {
      if (issue.field !== null && fieldErrors[issue.field] === undefined) fieldErrors[issue.field] = issue.code;
    }
    return { ok: false, code: error.code, fieldErrors };
  }
  // Not found and forbidden look the same to the browser: never reveal that a goal exists.
  if (isAccessError(error)) return { ok: false, code: "FORBIDDEN", fieldErrors: {} };
  // Name and Prisma code only: the raw error may echo query arguments (the person's goal text).
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[performance-goals] ${step} failed: ${name} (${code})`);
  return { ok: false, code: "FAILED", fieldErrors: {} };
}

async function run(step: string, operation: () => Promise<unknown>): Promise<PerformanceGoalActionResult> {
  try {
    await operation();
  } catch (error: unknown) {
    return failure(error, step);
  }
  refresh();
  return { ok: true };
}

/** "Zapisz i zamknij" / "Dodaj do planu" on a new goal. */
export async function createPerformanceGoalAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("create", () => createPerformanceGoal(db(), viewer, input));
}

/** "Zapisz i zamknij" / "Dodaj do planu" on an existing goal. */
export async function updatePerformanceGoalAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("update", () => updatePerformanceGoal(db(), viewer, input));
}

/** WF-04: the validator saves a changed goal while the document is in validation. */
export async function updatePerformanceGoalAsValidatorAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("validator update", () => updatePerformanceGoalAsValidator(db(), viewer, input));
}

/** HR-07: HR corrects a goal of any document, with a required reason (HR panel). */
export async function correctPerformanceGoalAsHrAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("hr correction", () => correctPerformanceGoalAsHr(db(), viewer, input));
}

/** Card trash icon - before the document is sent (G2-25). */
export async function deletePerformanceGoalAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("delete", () => deletePerformanceGoal(db(), viewer, input));
}

/** "Anuluj cel" (G2-25) - after the document has been sent. */
export async function cancelPerformanceGoalAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("cancel", () => cancelPerformanceGoal(db(), viewer, input));
}

/** "Kopiuj" (G2-06): last year's goals as drafts. */
export async function copyPerformanceGoalsAction(input: unknown): Promise<PerformanceGoalActionResult> {
  const viewer = await requireEmployee();
  return run("copy", () => copyPerformanceGoalsFromPreviousYear(db(), viewer, input));
}
