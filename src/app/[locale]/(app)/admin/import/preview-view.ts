import "server-only";
import type { ImportIssue, ImportPreview, PlannedChange } from "@/server/import/pipeline";
import type { StructureRecord } from "@/server/import/structure";

// Trims a full import preview to what the HR screen shows. Full records stay on the server; the
// browser gets counts for the whole file and a bounded number of rows per table.

/** Rows sent to the browser per table; the counts always cover the whole file. */
export const MAX_PREVIEW_ROWS = 200;
/** Error rows are what HR fixes in the source file, so more of them are shown. */
export const MAX_PREVIEW_ERRORS = 1000;

/**
 * An issue as the screen needs it. The English `message` stays on the server: the UI translates
 * `code`, and the message can quote cell contents.
 */
export type PreviewIssue = Pick<ImportIssue, "line" | "column" | "code" | "people">;

export interface PreviewRow {
  line: number | null;
  key: string;
  name: string;
  fields: readonly { field: string; before: string; after: string }[];
}

export interface PreviewView {
  fileName: string;
  fingerprint: string;
  totalRows: number;
  unchangedCount: number;
  /** Distinct rows with at least one error (one row may have several reasons). */
  errorRowCount: number;
  counts: { created: number; changed: number; deactivated: number; errors: number };
  created: readonly PreviewRow[];
  changed: readonly PreviewRow[];
  deactivated: readonly PreviewRow[];
  errors: readonly PreviewIssue[];
  /** Problems that block the whole file; confirm is refused while any exist. */
  fileErrors: readonly PreviewIssue[];
}

const display = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

/** `withFields`: only the "changed" table shows field values; the others send none. */
function toRow(change: PlannedChange<StructureRecord>, withFields: boolean): PreviewRow {
  return {
    line: change.line,
    key: change.key,
    name: `${change.after.firstName} ${change.after.lastName}`.trim(),
    fields: withFields
      ? change.fields.map((f) => ({ field: f.field, before: display(f.before), after: display(f.after) }))
      : [],
  };
}

function toIssue({ line, column, code, people }: ImportIssue): PreviewIssue {
  return people ? { line, column, code, people } : { line, column, code };
}

const rows = (changes: readonly PlannedChange<StructureRecord>[], withFields: boolean): PreviewRow[] =>
  changes.slice(0, MAX_PREVIEW_ROWS).map((c) => toRow(c, withFields));

/** Pure. */
export function toPreviewView(preview: ImportPreview<StructureRecord>): PreviewView {
  return {
    fileName: preview.fileName,
    fingerprint: preview.fingerprint,
    totalRows: preview.totalRows,
    unchangedCount: preview.unchangedCount,
    errorRowCount: preview.errorRowCount,
    counts: {
      created: preview.created.length,
      changed: preview.changed.length,
      deactivated: preview.deactivated.length,
      errors: preview.errors.length,
    },
    created: rows(preview.created, false),
    changed: rows(preview.changed, true),
    deactivated: rows(preview.deactivated, false),
    errors: preview.errors.slice(0, MAX_PREVIEW_ERRORS).map(toIssue),
    fileErrors: preview.fileErrors.map(toIssue),
  };
}
