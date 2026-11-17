import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";

// Start announcement (HOME-01, HOME-03). HR publishes versions of the KOMUNIKAT_STARTOWY content
// block; each person sees a version once, and closing the dialog records announcement_seen for
// that version. A blank newest version switches the dialog off (it never falls back to an older one).
// The client db is injected so the rules are testable without Postgres.

export type ContentDb = Pick<PrismaClient, "contentBlock" | "announcementSeen">;

export const START_ANNOUNCEMENT_KEY = "KOMUNIKAT_STARTOWY";

export interface StartAnnouncement {
  version: number;
  /** Untrusted HR markdown: render it with the sanitising renderer only. */
  markdown: string;
}

/**
 * The newest published start announcement in the given language, or null when there is none,
 * its text is blank, or this person already closed this version.
 */
export async function loadUnseenStartAnnouncement(
  db: ContentDb,
  employeeId: number,
  locale: Locale,
  now: Date = new Date(),
): Promise<StartAnnouncement | null> {
  const block = await db.contentBlock.findFirst({
    where: { key: START_ANNOUNCEMENT_KEY, publishedAt: { not: null, lte: now } },
    orderBy: { version: "desc" },
    select: { version: true, contentPl: true, contentEn: true },
  });
  if (!block) return null;
  const markdown = locale === "en" ? block.contentEn : block.contentPl;
  if (markdown.trim() === "") return null;

  const seen = await db.announcementSeen.findUnique({
    where: { employeeId_contentVersion: { employeeId, contentVersion: block.version } },
    select: { seenAt: true },
  });
  return seen ? null : { version: block.version, markdown };
}

export type AnnouncementErrorCode = "INVALID_INPUT" | "NOT_PUBLISHED";

export class AnnouncementError extends Error {
  constructor(readonly code: AnnouncementErrorCode) {
    super(`Start announcement: ${code}`);
    this.name = "AnnouncementError";
  }
}

const SeenInputSchema = z.strictObject({ version: z.number().int().positive() });

/**
 * Records that the person closed the given version. The version comes from the browser, so it must
 * be a published version of the start announcement. Idempotent: a second close (another tab) is a no-op.
 */
export async function markStartAnnouncementSeen(
  db: ContentDb,
  employeeId: number,
  input: unknown,
  now: Date = new Date(),
): Promise<void> {
  const parsed = SeenInputSchema.safeParse(input);
  if (!parsed.success) throw new AnnouncementError("INVALID_INPUT");
  const { version } = parsed.data;

  const block = await db.contentBlock.findFirst({
    where: { key: START_ANNOUNCEMENT_KEY, version, publishedAt: { not: null, lte: now } },
    select: { id: true },
  });
  if (!block) throw new AnnouncementError("NOT_PUBLISHED");

  // ON CONFLICT DO NOTHING: two tabs closing at once must not fail on the primary key.
  await db.announcementSeen.createMany({
    data: [{ employeeId, contentVersion: version }],
    skipDuplicates: true,
  });
}
