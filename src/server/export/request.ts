import "server-only";
import { z } from "zod";
import { MAX_CYCLE_YEAR, MIN_CYCLE_YEAR } from "@/domain/cycle-config";
import {
  EXPORT_DATA_TYPES,
  EXPORT_FORMATS,
  isFormatAllowed,
  MAX_SELECTED_PEOPLE,
  type ExportDataType,
  type ExportErrorCode,
  type ExportFormat,
  type PeopleScope,
} from "@/domain/data-export";
import { AMEI_PATTERN } from "@/server/import/structure-columns";

// Validation of an export request (HR-08, HR-12). The payload comes from the browser, so nothing in it
// is trusted: data types, year, people and format are all checked here before any query runs.

const MAX_DEPARTMENT_LENGTH = 200;

const ameiSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(AMEI_PATTERN));

const peopleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("one"), amei: ameiSchema }),
  z.object({
    kind: z.literal("selected"),
    ameis: z
      .array(ameiSchema)
      .min(1)
      .max(MAX_SELECTED_PEOPLE)
      .transform((ameis) => [...new Set(ameis)]),
  }),
  z.object({ kind: z.literal("department"), department: z.string().trim().min(1).max(MAX_DEPARTMENT_LENGTH) }),
  z.object({ kind: z.literal("all") }),
]);

const CSV_SINGLE_TYPE = "CSV_SINGLE_TYPE";

const exportRequestSchema = z
  .object({
    dataTypes: z
      .array(z.enum(EXPORT_DATA_TYPES))
      .min(1)
      .max(EXPORT_DATA_TYPES.length)
      .refine((types) => new Set(types).size === types.length),
    year: z.number().int().min(MIN_CYCLE_YEAR).max(MAX_CYCLE_YEAR),
    people: peopleSchema,
    format: z.enum(EXPORT_FORMATS),
  })
  .strict()
  .refine((request) => isFormatAllowed(request.format, request.dataTypes.length), {
    message: CSV_SINGLE_TYPE,
    path: ["format"],
  });

export interface ExportRequest {
  /** Always in the fixed EXPORT_DATA_TYPES order, so sheets come out the same way every time. */
  dataTypes: ExportDataType[];
  year: number;
  people: PeopleScope;
  format: ExportFormat;
}

export type ParsedExportRequest = { ok: true; request: ExportRequest } | { ok: false; code: ExportErrorCode };

export function parseExportRequest(raw: unknown): ParsedExportRequest {
  const parsed = exportRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const csvRule = parsed.error.issues.some((issue) => issue.message === CSV_SINGLE_TYPE);
    return { ok: false, code: csvRule ? "CSV_SINGLE_TYPE" : "INVALID_REQUEST" };
  }
  const { dataTypes, year, people, format } = parsed.data;
  const ordered = EXPORT_DATA_TYPES.filter((type) => dataTypes.includes(type));
  return { ok: true, request: { dataTypes: ordered, year, people, format } };
}
