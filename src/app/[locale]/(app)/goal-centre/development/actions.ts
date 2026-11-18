"use server";

import { refresh } from "next/cache";
import type { DevelopmentGoalField, DevelopmentGoalInputErrorCode } from "@/domain/development-goal";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import {
  cancelDevelopmentGoal,
  createDevelopmentGoal,
  deleteDevelopmentGoal,
  DevelopmentGoalError,
  updateDevelopmentGoal,
  updateDevelopmentGoalAsValidator,
  correctDevelopmentGoalAsHr,
  type DevelopmentGoalErrorCode,
} from "@/server/development-goals";
import { isAccessError } from "@/server/permissions";

// Server Actions of Goal Centre Part 3. The payload is untrusted: development-goals.ts validates it
// with the shared zod schema and checks permission, document status and cycle inside the write
// transaction. The viewer always comes from the session, never from the payload.

export type DevelopmentGoalActionErrorCode = DevelopmentGoalErrorCode | "FORBIDDEN" | "FAILED";
export type DevelopmentGoalFieldErrors = Partial<Record<DevelopmentGoalField, DevelopmentGoalInputErrorCode>>;
export type DevelopmentGoalActionResult =
  | { ok: true }
  | { ok: false; code: DevelopmentGoalActionErrorCode; fieldErrors: DevelopmentGoalFieldErrors };

/** Rule conflicts that mean the page shows stale data: re-render it with the saved state. */
const STALE_PAGE_CODES: ReadonlySet<DevelopmentGoalErrorCode> = new Set([
  "NOT_EDITABLE",
  "GOAL_CANCELLED",
  "DOCUMENT_ALREADY_SENT",
  "DOCUMENT_NOT_SENT",
]);

function failure(error: unknown, step: string): DevelopmentGoalActionResult {
  if (error instanceof DevelopmentGoalError) {
    if (STALE_PAGE_CODES.has(error.code)) refresh();
    const fieldErrors: DevelopmentGoalFieldErrors = {};
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
  console.error(`[development-goals] ${step} failed: ${name} (${code})`);
  return { ok: false, code: "FAILED", fieldErrors: {} };
}

async function run(step: string, operation: () => Promise<unknown>): Promise<DevelopmentGoalActionResult> {
  try {
    await operation();
  } catch (error: unknown) {
    return failure(error, step);
  }
  refresh();
  return { ok: true };
}

/** "Zapisz i zamknij" / "Dodaj do planu" on a new goal. */
export async function createDevelopmentGoalAction(input: unknown): Promise<DevelopmentGoalActionResult> {
  const viewer = await requireEmployee();
  return run("create", () => createDevelopmentGoal(db(), viewer, input));
}

/** "Zapisz i zamknij" / "Dodaj do planu" on an existing goal. */
export async function updateDevelopmentGoalAction(input: unknown): Promise<DevelopmentGoalActionResult> {
  const viewer = await requireEmployee();
  return run("update", () => updateDevelopmentGoal(db(), viewer, input));
}

/** WF-04: the validator saves a changed goal while the document is in validation. */
export async function updateDevelopmentGoalAsValidatorAction(input: unknown): Promise<DevelopmentGoalActionResult> {
  const viewer = await requireEmployee();
  return run("validator update", () => updateDevelopmentGoalAsValidator(db(), viewer, input));
}

/** HR-07: HR corrects a goal of any document, with a required reason (HR panel). */
export async function correctDevelopmentGoalAsHrAction(input: unknown): Promise<DevelopmentGoalActionResult> {
  const viewer = await requireEmployee();
  return run("hr correction", () => correctDevelopmentGoalAsHr(db(), viewer, input));
}

/** Card trash icon - before the document is sent. */
export async function deleteDevelopmentGoalAction(input: unknown): Promise<DevelopmentGoalActionResult> {
  const viewer = await requireEmployee();
  return run("delete", () => deleteDevelopmentGoal(db(), viewer, input));
}

/** "Anuluj cel" (G3-21) - after the document has been sent. */
export async function cancelDevelopmentGoalAction(input: unknown): Promise<DevelopmentGoalActionResult> {
  const viewer = await requireEmployee();
  return run("cancel", () => cancelDevelopmentGoal(db(), viewer, input));
}
