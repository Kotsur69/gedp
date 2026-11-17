import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DocumentStatus } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/config";

// Start page data (HOME-11, HOME-13, HOME-14). Everything here is per person, so the page that
// uses it renders dynamically. The client db is injected so the rules are testable without Postgres.

export type HomeDb = Pick<PrismaClient, "contentBlock" | "gedpDocument">;

/** HR-edited content blocks shown on the start page (seeded in prisma/seed-data.ts). */
export type ContentBlockKey = "KOMUNIKAT_STARTOWY" | "TEKST_POWITALNY";

/**
 * Newest published version of a content block in the given language, or null when HR has not
 * published one yet or the text is blank. The text is untrusted markdown: render it sanitised.
 */
export async function loadPublishedContent(
  db: HomeDb,
  key: ContentBlockKey,
  locale: Locale,
  now: Date = new Date(),
): Promise<string | null> {
  const block = await db.contentBlock.findFirst({
    where: { key, publishedAt: { not: null, lte: now } },
    orderBy: { version: "desc" },
    select: { contentPl: true, contentEn: true },
  });
  if (!block) return null;
  const text = locale === "en" ? block.contentEn : block.contentPl;
  return text.trim() === "" ? null : text;
}

export interface OwnDocumentSummary {
  status: DocumentStatus;
  updatedAt: Date;
}

/** The signed-in person's own document of the given cycle year (null until Goal Centre creates it). */
export async function loadOwnDocumentSummary(
  db: HomeDb,
  employeeId: number,
  year: number,
): Promise<OwnDocumentSummary | null> {
  return db.gedpDocument.findFirst({
    where: { employeeId, cycle: { year } },
    select: { status: true, updatedAt: true },
  });
}

// More kinds arrive with the workflow (WF): DOCUMENT_RETURNED, DOCUMENTS_TO_VALIDATE.
export type HomeTaskKind = "FILL_GOALS";

export interface HomeTask {
  kind: HomeTaskKind;
  href: string;
  /** Null when the underlying record does not exist yet. */
  updatedAt: Date | null;
}

export interface HomeTaskInput {
  cycle: { year: number; isReadOnly: boolean } | null;
  document: OwnDocumentSummary | null;
}

/**
 * "Moje zadania" (HOME-14). Only an open cycle produces tasks. "Fill in goals" stays until the
 * document leaves SZKIC; before the first Goal Centre visit there is no document yet, which is
 * the same to-do.
 */
export function buildHomeTasks({ cycle, document }: HomeTaskInput): HomeTask[] {
  if (!cycle || cycle.isReadOnly) return [];
  if (document === null || document.status === "SZKIC") {
    return [{ kind: "FILL_GOALS", href: "/goal-centre", updatedAt: document?.updatedAt ?? null }];
  }
  return [];
}
