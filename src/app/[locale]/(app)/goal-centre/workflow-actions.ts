"use server";

import { refresh } from "next/cache";
import type { MissingCondition } from "@/domain/document-status";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { updateGoalProgress } from "@/server/goal-progress";
import { isAccessError } from "@/server/permissions";
import { transitionDocument, WorkflowError, type WorkflowErrorCode } from "@/server/workflow";

// Server Actions of the document workflow (WF-01..06): send / approve / return and the progress
// update on an approved document. The payload is untrusted: workflow.ts and goal-progress.ts parse
// it with zod and decide everything inside the write transaction. The viewer always comes from the
// session, never from the payload.

export type WorkflowActionErrorCode = WorkflowErrorCode | "FORBIDDEN" | "FAILED";
export type WorkflowActionResult =
  | { ok: true }
  | { ok: false; code: WorkflowActionErrorCode; missing: readonly MissingCondition[] };

/** The page shows a status that is no longer true: re-render it with the saved state. */
const STALE_PAGE_CODES: ReadonlySet<WorkflowErrorCode> = new Set([
  "ILLEGAL_TRANSITION",
  "CYCLE_NOT_OPEN",
  "CONDITIONS_NOT_MET",
  "NOT_EDITABLE",
  "GOAL_NOT_IN_PLAN",
]);

function failure(error: unknown, step: string): WorkflowActionResult {
  if (error instanceof WorkflowError) {
    if (STALE_PAGE_CODES.has(error.code)) refresh();
    return { ok: false, code: error.code, missing: error.missing };
  }
  // Not found and forbidden look the same to the browser: never reveal that a document exists.
  if (isAccessError(error)) {
    refresh();
    return { ok: false, code: "FORBIDDEN", missing: [] };
  }
  // Name and Prisma code only: the raw error may echo query arguments (the return comment).
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[workflow] ${step} failed: ${name} (${code})`);
  return { ok: false, code: "FAILED", missing: [] };
}

async function run(step: string, operation: () => Promise<unknown>): Promise<WorkflowActionResult> {
  try {
    await operation();
  } catch (error: unknown) {
    return failure(error, step);
  }
  refresh();
  return { ok: true };
}

/** "Wyślij do walidacji" / "Zatwierdź" / "Zwróć do poprawy": `{ documentId, action, comment? }`. */
export async function transitionDocumentAction(input: unknown): Promise<WorkflowActionResult> {
  const viewer = await requireEmployee();
  return run("transition", () => transitionDocument(db(), viewer, input));
}

/** Progress of a goal on an approved document: `{ part, goalId, progress }`. */
export async function updateGoalProgressAction(input: unknown): Promise<WorkflowActionResult> {
  const viewer = await requireEmployee();
  return run("update progress", () => updateGoalProgress(db(), viewer, input));
}
