import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImportKind, Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import { ForbiddenError, type Viewer } from "@/server/permissions";
import { readTable, type ImportFile, type RawTable } from "./table";

// Generic import pipeline (HR-01..03, reused by the goals/documents import HR-11):
//
//   read file -> handler.plan (parse + validate + diff, READ-ONLY) -> preview for HR
//   -> HR confirms ("import valid rows" or "reject all")
//   -> in ONE transaction: re-plan against the current DB, check the preview fingerprint,
//      import_batch row, handler.apply (writes + per-record audit), batch audit row.
//
// Nothing is written before confirm, and confirm only writes what HR saw: the plan is recomputed
// inside the write transaction and its fingerprint must equal the one returned by the preview, so a
// different file or a database change in between makes confirm fail instead of writing a surprise.
// Callers (server actions) pass the viewer from requireEmployee(); only HR may preview or import.

/** Values a planned record may hold; plain JSON so plans hash and audit cleanly. */
export type ImportValue = string | number | boolean | null;
export type ImportRecord = Readonly<Record<string, ImportValue>>;

export interface ImportIssue {
  /** Spreadsheet line (header = 1); null for problems with the file as a whole. */
  line: number | null;
  /** Header of the offending column, if one column is to blame. */
  column: string | null;
  /** Stable machine code, translated by the UI. */
  code: string;
  /** Human-readable reason (English, for logs and as a fallback). */
  message: string;
  /** People involved, e.g. the members of a hierarchy cycle. */
  people?: readonly string[];
}

export interface FieldChange {
  field: string;
  before: ImportValue;
  after: ImportValue;
}

export interface PlannedChange<TRecord extends ImportRecord> {
  /** Source line; null for records not in the file (deactivations). */
  line: number | null;
  /** Business key, e.g. AMEI. */
  key: string;
  before: TRecord | null;
  after: TRecord;
  /** Field-level difference; for new records every field of `after`. */
  fields: readonly FieldChange[];
}

export interface ImportPlan<TRecord extends ImportRecord> {
  kind: ImportKind;
  totalRows: number;
  created: readonly PlannedChange<TRecord>[];
  changed: readonly PlannedChange<TRecord>[];
  deactivated: readonly PlannedChange<TRecord>[];
  unchangedCount: number;
  /** Row errors; those rows are never written. Sorted by line. */
  errors: readonly ImportIssue[];
  /** Problems that block the whole file (missing column, no rows...). */
  fileErrors: readonly ImportIssue[];
}

export interface ImportPreview<TRecord extends ImportRecord> extends ImportPlan<TRecord> {
  fileName: string;
  /** Number of distinct rows with at least one error. */
  errorRowCount: number;
  /** Pass back to confirmImport; it changes whenever the file or the planned changes change. */
  fingerprint: string;
}

/** Read access a handler needs for planning: the root client or a transaction client. */
export type ImportDb = Prisma.TransactionClient;

export interface PlanContext {
  /** The HR user running the import (verified active HR in the database). */
  actorId: number;
}

export interface ApplyContext {
  actorId: number;
  batchId: number;
}

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeout?: number;
  maxWait?: number;
}

/** One kind of import. Plug a new parser in by implementing this. */
export interface ImportHandler<TRecord extends ImportRecord> {
  readonly kind: ImportKind;
  /** Options for the confirm transaction (e.g. HIERARCHY_TX_OPTIONS for structure imports). */
  readonly txOptions?: TransactionOptions;
  /**
   * Called first in the confirm transaction: lock whatever the plan is computed from, so no other
   * change commits between planning and writing.
   */
  lockForWrite?(tx: Prisma.TransactionClient): Promise<void>;
  /** Parses, validates and diffs against the database. MUST NOT write. */
  plan(db: ImportDb, table: RawTable, ctx: PlanContext): Promise<ImportPlan<TRecord>>;
  /** Writes created / changed / deactivated records and audits each one. Runs in the confirm tx. */
  apply(tx: Prisma.TransactionClient, plan: ImportPlan<TRecord>, ctx: ApplyContext): Promise<void>;
}

export type ConfirmMode = "IMPORT_VALID_ROWS" | "REJECT_ALL";

const MAX_SCOPE_JSON_LENGTH = 10_000;
const MAX_FILE_NAME_LENGTH = 255;

const confirmRequestSchema = z.object({
  mode: z.enum(["IMPORT_VALID_ROWS", "REJECT_ALL"]),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  scope: z
    .json()
    .refine((value) => JSON.stringify(value).length <= MAX_SCOPE_JSON_LENGTH, "Import scope is too large")
    .optional(),
});
export type ConfirmRequest = z.input<typeof confirmRequestSchema>;

export interface ImportCounts {
  newCount: number;
  changedCount: number;
  deactivatedCount: number;
  errorCount: number;
}

export type ConfirmResult = { status: "REJECTED" } | { status: "IMPORTED"; batchId: number; counts: ImportCounts };

/** Confirm refused: the preview HR saw no longer matches (other file, or the data changed). */
export class ImportStaleError extends Error {
  constructor() {
    super("The data changed since the preview; preview the file again before confirming");
    this.name = "ImportStaleError";
  }
}

/** Confirm refused: the file has errors that block it as a whole. */
export class ImportBlockedError extends Error {
  constructor(readonly issues: readonly ImportIssue[]) {
    super(`The file cannot be imported: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "ImportBlockedError";
  }
}

// Arbitrary constant that identifies imports among advisory locks (hierarchy.ts uses 2027_0001).
const IMPORT_LOCK_KEY = 2027_0002;

function requireHr(actor: Viewer): void {
  if (!actor.isHrAdmin) throw new ForbiddenError("edit", "Only HR may import data");
}

/** Re-checks the viewer against the database: a demoted or deactivated HR user may not import. */
async function requireActiveHr(db: ImportDb, actor: Viewer): Promise<void> {
  requireHr(actor);
  const current = await db.employee.findFirst({
    where: { id: actor.id, isActive: true, isHrAdmin: true },
    select: { id: true },
  });
  if (!current) throw new ForbiddenError("edit", "Only active HR may import data");
}

/** Keeps only the base name (no client path), capped, for import_batch and the audit. */
function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  return base.replace(/\p{Cc}/gu, "").slice(-MAX_FILE_NAME_LENGTH);
}

/** Step 1: read and plan the file, write nothing. */
export async function previewImport<TRecord extends ImportRecord>(
  db: PrismaClient,
  handler: ImportHandler<TRecord>,
  actor: Viewer,
  file: ImportFile,
): Promise<ImportPreview<TRecord>> {
  await requireActiveHr(db, actor);
  const table = await readTable(file);
  return toPreview(file, await handler.plan(db, table, { actorId: actor.id }));
}

/** Step 2: HR's decision. REJECT_ALL writes nothing; IMPORT_VALID_ROWS writes the valid rows. */
export async function confirmImport<TRecord extends ImportRecord>(
  db: PrismaClient,
  handler: ImportHandler<TRecord>,
  actor: Viewer,
  file: ImportFile,
  request: ConfirmRequest,
): Promise<ConfirmResult> {
  requireHr(actor);
  const { mode, fingerprint, scope } = confirmRequestSchema.parse(request);
  if (mode === "REJECT_ALL") return { status: "REJECTED" };

  const table = await readTable(file);
  const fileName = safeFileName(file.fileName);
  return db.$transaction(async (tx) => {
    // One import at a time, so two HR users cannot both apply a plan computed on the same state.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_KEY})`;
    await handler.lockForWrite?.(tx);
    await requireActiveHr(tx, actor);
    const preview = toPreview(file, await handler.plan(tx, table, { actorId: actor.id }));
    if (preview.fingerprint !== fingerprint) throw new ImportStaleError();
    if (preview.fileErrors.length > 0) throw new ImportBlockedError(preview.fileErrors);

    const counts = countsOf(preview);
    const batch = await tx.importBatch.create({
      data: {
        fileName,
        authorId: actor.id,
        kind: handler.kind,
        scope: (scope ?? undefined) as Prisma.InputJsonValue | undefined,
        ...counts,
      },
      select: { id: true },
    });
    await handler.apply(tx, preview, { actorId: actor.id, batchId: batch.id });
    await writeAudit(tx, {
      actorId: actor.id,
      entity: "import_batch",
      entityId: batch.id,
      action: "IMPORT",
      after: { fileName, kind: handler.kind, fileSha256: sha256(file.bytes), ...counts },
    });
    return { status: "IMPORTED" as const, batchId: batch.id, counts };
  }, handler.txOptions);
}

function countsOf(preview: ImportPreview<ImportRecord>): ImportCounts {
  return {
    newCount: preview.created.length,
    changedCount: preview.changed.length,
    deactivatedCount: preview.deactivated.length,
    errorCount: preview.errorRowCount,
  };
}

/** Adds the file name, error-row count and fingerprint to a plan. Pure. */
export function toPreview<TRecord extends ImportRecord>(
  file: ImportFile,
  plan: ImportPlan<TRecord>,
): ImportPreview<TRecord> {
  const errorRowCount = new Set(plan.errors.map((e) => e.line)).size;
  // Plans are built deterministically, so JSON of the same plan is byte-identical.
  const fingerprint = createHash("sha256").update(sha256(file.bytes)).update(JSON.stringify(plan)).digest("hex");
  return { ...plan, fileName: safeFileName(file.fileName), errorRowCount, fingerprint };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
