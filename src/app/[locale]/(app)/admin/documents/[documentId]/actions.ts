"use server";

import { refresh } from "next/cache";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { correctBhpCommitmentAsHr, GroupGoalError, type GroupGoalErrorCode } from "@/server/group-goals";
import { isAccessError } from "@/server/permissions";

// Server Action of the HR-07 BHP commitment correction. The payload is untrusted: group-goals.ts
// parses it with zod, checks the reason and re-checks HR against the live row inside the write
// transaction. The viewer always comes from the session, never from the payload. The Part 2 and
// Part 3 corrections reuse the goal actions (correct*GoalAsHrAction in goal-centre).

export type BhpCorrectionErrorCode = GroupGoalErrorCode | "FORBIDDEN" | "FAILED";
export type BhpCorrectionResult = { ok: true } | { ok: false; code: BhpCorrectionErrorCode };

function failure(error: unknown): BhpCorrectionResult {
  // No refresh on NOT_ACKNOWLEDGED: the re-rendered row would drop the window before HR reads why.
  if (error instanceof GroupGoalError) return { ok: false, code: error.code };
  if (isAccessError(error)) return { ok: false, code: "FORBIDDEN" };
  // Name and Prisma code only: the raw error may echo query arguments (the commitment, the reason).
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[admin/documents] BHP correction failed: ${name} (${code})`);
  return { ok: false, code: "FAILED" };
}

/** "Zapisz korektę" of the BHP commitment: `{ documentId, templateId, commitment, reason }`. */
export async function correctBhpCommitmentAction(input: unknown): Promise<BhpCorrectionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN" };
  try {
    await correctBhpCommitmentAsHr(db(), viewer, input);
  } catch (error: unknown) {
    return failure(error);
  }
  refresh();
  return { ok: true };
}
