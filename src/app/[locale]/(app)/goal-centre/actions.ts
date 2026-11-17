"use server";

import { refresh } from "next/cache";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import {
  acknowledgeGroupGoal,
  GroupGoalError,
  saveBhpCommitment,
  type GroupGoalErrorCode,
} from "@/server/group-goals";
import { isAccessError } from "@/server/permissions";

// Server Actions of Goal Centre Part 1. The payload is untrusted: group-goals.ts validates it with
// zod and checks permission, document status and cycle inside the write transaction. The viewer
// always comes from the session, never from the payload.

export type GroupGoalActionErrorCode = GroupGoalErrorCode | "FORBIDDEN" | "FAILED";
export type GroupGoalActionResult = { ok: true } | { ok: false; code: GroupGoalActionErrorCode };

function failure(error: unknown, step: string): GroupGoalActionResult {
  if (error instanceof GroupGoalError) {
    // The page is stale (sent in another tab, already acknowledged): re-render it with the saved state.
    if (error.code === "NOT_EDITABLE" || error.code === "ALREADY_ACKNOWLEDGED") refresh();
    return { ok: false, code: error.code };
  }
  // Not found and forbidden look the same to the browser: never reveal that a document exists.
  if (isAccessError(error)) return { ok: false, code: "FORBIDDEN" };
  // Name and Prisma code only: the raw error may echo query arguments (the person's commitment).
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[group-goals] ${step} failed: ${name} (${code})`);
  return { ok: false, code: "FAILED" };
}

/** "Potwierdzam zapoznanie" on Leadership / Company values. */
export async function acknowledgeGroupGoalAction(input: unknown): Promise<GroupGoalActionResult> {
  const viewer = await requireEmployee();
  try {
    await acknowledgeGroupGoal(db(), viewer, input);
  } catch (error: unknown) {
    return failure(error, "acknowledge");
  }
  refresh();
  return { ok: true };
}

/** Saves the BHP commitment ("Moje zobowiązanie to:"); the first save acknowledges the goal. */
export async function saveBhpCommitmentAction(input: unknown): Promise<GroupGoalActionResult> {
  const viewer = await requireEmployee();
  try {
    await saveBhpCommitment(db(), viewer, input);
  } catch (error: unknown) {
    return failure(error, "save BHP commitment");
  }
  refresh();
  return { ok: true };
}
