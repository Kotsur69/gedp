// HR data export (HR-08) with scope selection (HR-12): the vocabulary shared by the export screen and
// the server. Pure and client-safe; the server validates every request again (src/server/export/).

/** WHAT can be exported. Each selected type becomes one sheet of the .xlsx (or the one CSV). */
export const EXPORT_DATA_TYPES = [
  "employees",
  "documents",
  "groupGoals",
  "performanceGoals",
  "developmentGoals",
  "statusHistory",
] as const;
export type ExportDataType = (typeof EXPORT_DATA_TYPES)[number];

export const EXPORT_FORMATS = ["xlsx", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** WHO: one person, selected people, a department, or everyone. */
export const PEOPLE_SCOPE_KINDS = ["one", "selected", "department", "all"] as const;
export type PeopleScopeKind = (typeof PEOPLE_SCOPE_KINDS)[number];

export type PeopleScope =
  | { kind: "one"; amei: string }
  | { kind: "selected"; ameis: string[] }
  | { kind: "department"; department: string }
  | { kind: "all" };

export interface ExportRequestInput {
  dataTypes: ExportDataType[];
  year: number;
  people: PeopleScope;
  format: ExportFormat;
}

/** Upper bound for "selected people"; larger groups are a department or everyone. */
export const MAX_SELECTED_PEOPLE = 500;

/** A CSV file holds one table, so CSV takes exactly one data type; .xlsx takes any number. */
export function isFormatAllowed(format: ExportFormat, dataTypeCount: number): boolean {
  return format === "xlsx" || dataTypeCount === 1;
}

/** Splits pasted text ("AM1, AM2\nAM3") into upper-cased AMEIs, without duplicates, in input order. */
export function splitAmeis(text: string): string[] {
  const ameis = text
    .split(/[\s,;]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(ameis)];
}

export type ExportErrorCode =
  | "INVALID_REQUEST"
  | "CSV_SINGLE_TYPE"
  | "FORBIDDEN"
  | "NO_CYCLE"
  | "UNKNOWN_PEOPLE"
  | "NO_PEOPLE"
  | "TOO_LARGE"
  | "FAILED";

/** What the preview shows before download (HR-12): people in scope and records per selected type. */
export interface ExportPreview {
  people: number;
  records: Partial<Record<ExportDataType, number>>;
}
