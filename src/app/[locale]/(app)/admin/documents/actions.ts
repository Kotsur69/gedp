"use server";

import { refresh } from "next/cache";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { isAccessError } from "@/server/permissions";
import { revertDocumentStatus, WorkflowError, type WorkflowErrorCode } from "@/server/workflow";

// Server Action of "Cofnij status" (WF-08). The payload is untrusted: workflow.ts parses it with
// zod and re-checks HR against the live row inside the write transaction. The viewer always comes
// from the session, never from the payload.

export type RevertActionErrorCode = WorkflowErrorCode | "FORBIDDEN" | "FAILED";
export type RevertActionResult = { ok: true } | { ok: false; code: RevertActionErrorCode };

/** The list shows a status that is no longer true: re-render it with the saved state. */
const STALE_PAGE_CODES: ReadonlySet<WorkflowErrorCode> = new Set(["STATUS_CHANGED", "CYCLE_NOT_OPEN", "ILLEGAL_TRANSITION"]);

function failure(error: unknown): RevertActionResult {
  if (error instanceof WorkflowError) {
    if (STALE_PAGE_CODES.has(error.code)) refresh();
    return { ok: false, code: error.code };
  }
  if (isAccessError(error)) return { ok: false, code: "FORBIDDEN" };
  // Name and Prisma code only: the raw error may echo query arguments (the reason).
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[admin/documents] revert failed: ${name} (${code})`);
  return { ok: false, code: "FAILED" };
}

/** "Cofnij status": `{ documentId, from, to, reason }`. */
export async function revertDocumentStatusAction(input: unknown): Promise<RevertActionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN" };
  try {
    await revertDocumentStatus(db(), viewer, input);
  } catch (error: unknown) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}
