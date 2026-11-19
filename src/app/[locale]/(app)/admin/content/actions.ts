"use server";

import { refresh } from "next/cache";
import type { ContentErrorCode, ContentFieldErrors, LatestContent } from "@/domain/content-block";
import { ContentAdminError, publishContent } from "@/server/content-admin";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { isAccessError } from "@/server/permissions";

// Server Action of the HR content panel (HR-06). The payload is untrusted: content-admin.ts
// validates it with the shared zod schema and re-checks HR against the live row inside the write
// transaction. The viewer always comes from the session, never from the payload.

export type ContentActionErrorCode = ContentErrorCode | "FORBIDDEN" | "FAILED";
export type ContentActionResult =
  | { ok: true; changed: boolean; version: number | null }
  | { ok: false; code: ContentActionErrorCode; fieldErrors: ContentFieldErrors; latest: LatestContent | null };

function failure(
  code: ContentActionErrorCode,
  fieldErrors: ContentFieldErrors = {},
  latest: LatestContent | null = null,
): ContentActionResult {
  return { ok: false, code, fieldErrors, latest };
}

export async function publishContentAction(input: unknown): Promise<ContentActionResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return failure("FORBIDDEN");
  try {
    const result = await publishContent(db(), viewer, input);
    // Re-render the panel (and the header links) with the published version.
    if (result.changed) refresh();
    return { ok: true, ...result };
  } catch (error: unknown) {
    // STALE carries the other HR user's version; the form shows it and lets HR choose. No refresh
    // here: the form keeps the version it was opened on until HR has made that choice.
    if (error instanceof ContentAdminError) return failure(error.code, error.fieldErrors, error.latest);
    if (isAccessError(error)) return failure("FORBIDDEN");
    // Name and Prisma code only: the raw error may echo query arguments.
    const name = error instanceof Error ? error.name : typeof error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
    console.error(`[admin/content] publish failed: ${name} (${code})`);
    return failure("FAILED");
  }
}
