"use server";

import { AnnouncementError, markStartAnnouncementSeen, type AnnouncementErrorCode } from "@/server/content";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";

// HOME-01: closing the start announcement records it as seen. The payload is untrusted and
// content.ts validates it; the person always comes from the session, never from the payload.

export type AnnouncementActionResult = { ok: true } | { ok: false; code: AnnouncementErrorCode | "FAILED" };

export async function markStartAnnouncementSeenAction(input: unknown): Promise<AnnouncementActionResult> {
  const viewer = await requireEmployee();
  try {
    await markStartAnnouncementSeen(db(), viewer.id, input);
  } catch (error: unknown) {
    if (error instanceof AnnouncementError) return { ok: false, code: error.code };
    // Name and Prisma code only: the raw error may echo query arguments.
    const name = error instanceof Error ? error.name : typeof error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
    console.error(`[start-announcement] recording seen failed: ${name} (${code})`);
    return { ok: false, code: "FAILED" };
  }
  return { ok: true };
}
