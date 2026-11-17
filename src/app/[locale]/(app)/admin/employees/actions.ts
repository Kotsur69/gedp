"use server";

import { refresh } from "next/cache";
import type { EmployeeEditErrorCode, EmployeeEditFieldErrors } from "@/domain/employee-edit";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { EmployeeAdminError, updateEmployee } from "@/server/employee-admin";
import { isAccessError } from "@/server/permissions";

// Server Action of the HR employee edit (HR-04). The payload is untrusted: employee-admin.ts
// validates it with the shared zod schema and re-checks HR against the live row inside the write
// transaction. The viewer always comes from the session, never from the payload.

export type EmployeeEditActionErrorCode = EmployeeEditErrorCode | "FORBIDDEN" | "FAILED";
export type EmployeeEditActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: EmployeeEditActionErrorCode; fieldErrors: EmployeeEditFieldErrors };

/** Codes that mean the list shows outdated data: re-render it with the saved state. */
const STALE_PAGE_CODES: ReadonlySet<EmployeeEditErrorCode> = new Set(["STALE", "NOT_FOUND"]);

function failure(error: unknown): EmployeeEditActionResult {
  if (error instanceof EmployeeAdminError) {
    if (STALE_PAGE_CODES.has(error.code)) refresh();
    return { ok: false, code: error.code, fieldErrors: error.fieldErrors };
  }
  if (isAccessError(error)) return { ok: false, code: "FORBIDDEN", fieldErrors: {} };
  // Name and Prisma code only: the raw error may echo query arguments (personal data).
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  console.error(`[admin/employees] update failed: ${name} (${code})`);
  return { ok: false, code: "FAILED", fieldErrors: {} };
}

/** "Zapisz" in the employee edit window. */
export async function updateEmployeeAction(input: unknown): Promise<EmployeeEditActionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN", fieldErrors: {} };
  let changed: boolean;
  try {
    const result = await updateEmployee(db(), viewer, input);
    changed = result.changes.length > 0;
  } catch (error: unknown) {
    return failure(error);
  }
  if (changed) refresh();
  return { ok: true, changed };
}
