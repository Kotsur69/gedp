import { z } from "zod";

// HR-07: HR corrects any document (any status, any cycle) and every correction carries a reason,
// stored in the audit row next to the before / after values. Shared by the server writers and the
// correction forms, so the browser and the server refuse the same reasons.

export const HR_CORRECTION_REASON_MAX_LENGTH = 1000;

/** Audit action of every HR-07 correction; the audit entity says what was corrected. */
export const HR_CORRECTION_AUDIT_ACTION = "UPDATE_BY_HR";

export const HR_CORRECTION_REASON_ERROR_CODES = ["REASON_REQUIRED", "REASON_TOO_LONG"] as const;
export type HrCorrectionReasonErrorCode = (typeof HR_CORRECTION_REASON_ERROR_CODES)[number];

/** Trimmed, required, at most HR_CORRECTION_REASON_MAX_LENGTH characters, no NUL (Postgres text). */
export const hrCorrectionReasonSchema = z
  .string("REASON_REQUIRED")
  .trim()
  .min(1, "REASON_REQUIRED")
  .max(HR_CORRECTION_REASON_MAX_LENGTH, "REASON_TOO_LONG")
  .refine((value) => !value.includes("\u0000"), "REASON_REQUIRED");

export type HrCorrectionReasonResult =
  | { ok: true; reason: string }
  | { ok: false; code: HrCorrectionReasonErrorCode };

export function parseHrCorrectionReason(value: unknown): HrCorrectionReasonResult {
  const parsed = hrCorrectionReasonSchema.safeParse(value);
  if (parsed.success) return { ok: true, reason: parsed.data };
  const code = parsed.error.issues[0]?.message === "REASON_TOO_LONG" ? "REASON_TOO_LONG" : "REASON_REQUIRED";
  return { ok: false, code };
}

export const isHrCorrectionReasonErrorCode = (code: string): code is HrCorrectionReasonErrorCode =>
  (HR_CORRECTION_REASON_ERROR_CODES as readonly string[]).includes(code);

/** Who edits in a goal window: the owner, the validator in validation (WF-04) or HR (HR-07). */
export type GoalEditor = "owner" | "validator" | "hr";
