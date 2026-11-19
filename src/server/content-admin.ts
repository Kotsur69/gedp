import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  CONTENT_KEYS,
  contentFieldErrors,
  publishContentSchema,
  type ContentErrorCode,
  type ContentFieldErrors,
  type ContentKey,
  type LatestContent,
} from "@/domain/content-block";
import { writeAudit } from "@/server/audit";
import { requireActiveHrAdmin, type Viewer } from "@/server/permissions";

// HR panel, content (HR-06, HOME-02): HR edits the start announcement, the home intro text and the
// header link addresses in PL and EN. "Publish" appends a new content_block version (published at
// once), so a new start announcement version is unseen by everyone and shows again (HOME-01).
// Readers always take the newest published version, per request, so no redeploy is needed.
//
// Every publish: zod check of the untrusted payload, then ONE transaction that re-checks HR
// against the live row, refuses an editor opened on an older version (STALE: another HR user
// published meanwhile; their version goes back to the editor, which lets HR choose between it and
// their own text), inserts the version and appends an audit row with before / after.
// Two publishes racing for the same version number hit the (key, version) unique key -> STALE.

export const CONTENT_AUDIT_ENTITY = "content_block";

export type ContentAdminDb = Pick<PrismaClient, "$transaction">;
export type ContentReadDb = Pick<PrismaClient, "contentBlock" | "employee">;

export type { LatestContent };

export class ContentAdminError extends Error {
  constructor(
    readonly code: ContentErrorCode,
    readonly fieldErrors: ContentFieldErrors = {},
    /** STALE: what the other HR user published meanwhile. */
    readonly latest: LatestContent | null = null,
  ) {
    super(`Content block: ${code}`);
    this.name = "ContentAdminError";
  }
}

export interface ContentBlockView {
  key: ContentKey;
  /** null while nothing was published for this key. */
  version: number | null;
  contentPl: string;
  contentEn: string;
  publishedAt: Date | null;
}

const VERSION_SELECT = { key: true, version: true, contentPl: true, contentEn: true, publishedAt: true } as const;

/** Newest version of every editable block, in CONTENT_KEYS order (HR only, live row check). */
export async function loadContentForAdmin(db: ContentReadDb, viewer: Viewer): Promise<ContentBlockView[]> {
  await requireActiveHrAdmin(db, viewer);
  const rows = await db.contentBlock.findMany({
    where: { key: { in: [...CONTENT_KEYS] } },
    orderBy: [{ key: "asc" }, { version: "desc" }],
    distinct: ["key"],
    select: VERSION_SELECT,
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return CONTENT_KEYS.map((key) => {
    const row = byKey.get(key);
    return row
      ? { key, version: row.version, contentPl: row.contentPl, contentEn: row.contentEn, publishedAt: row.publishedAt }
      : { key, version: null, contentPl: "", contentEn: "", publishedAt: null };
  });
}

export interface PublishResult {
  changed: boolean;
  version: number | null;
}

const toLatest = ({ version, contentPl, contentEn }: LatestContent): LatestContent => ({ version, contentPl, contentEn });

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Publishes a new version of one block. Unchanged text is a no-op (the announcement does not
 * reappear for a click on "Publish" without edits).
 */
export async function publishContent(
  db: ContentAdminDb,
  viewer: Viewer,
  input: unknown,
  now: Date = new Date(),
): Promise<PublishResult> {
  const parsed = publishContentSchema.safeParse(input);
  if (!parsed.success) throw new ContentAdminError("INVALID_INPUT", contentFieldErrors(parsed.error));
  const { key, baseVersion, contentPl, contentEn } = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      await requireActiveHrAdmin(tx, viewer);
      const latest = await tx.contentBlock.findFirst({
        where: { key },
        orderBy: { version: "desc" },
        select: VERSION_SELECT,
      });
      if ((latest?.version ?? null) !== baseVersion) throw new ContentAdminError("STALE", {}, latest && toLatest(latest));
      if (latest && latest.publishedAt !== null && latest.contentPl === contentPl && latest.contentEn === contentEn) {
        return { changed: false, version: latest.version };
      }

      const created = await tx.contentBlock.create({
        data: { key, version: (latest?.version ?? 0) + 1, contentPl, contentEn, publishedAt: now },
        select: VERSION_SELECT,
      });
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: CONTENT_AUDIT_ENTITY,
        entityId: key,
        action: "PUBLISH",
        before: latest,
        after: created,
      });
      return { changed: true, version: created.version };
    });
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the race for the version number: report the version that won.
    const latest = await db.$transaction((tx) =>
      tx.contentBlock.findFirst({ where: { key }, orderBy: { version: "desc" }, select: VERSION_SELECT }),
    );
    throw new ContentAdminError("STALE", {}, latest && toLatest(latest));
  }
}
