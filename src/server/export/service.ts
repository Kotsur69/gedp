import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ExportPreview } from "@/domain/data-export";
import { writeAudit } from "@/server/audit";
import { requireActiveHrAdmin, type Viewer } from "@/server/permissions";
import type { ExportRequest } from "./request";
import { ExportError, resolveScope } from "./scope";
import { loadSheets, type ExportSheet } from "./sheets";
import { buildFile, MIME_TYPES } from "./workbook";

// HR data export (HR-08 + HR-12): preview, then download. HR only, re-checked against the live row
// on every call. Preview and download go through the SAME scope and loaders, so the counts HR sees
// are the rows the file holds (counted again at download). Every download is audited (who, what,
// the filter AND the resolved AMEIs, how many rows)
// before the file is handed out: if the audit write fails, no file leaves the server.

export const AUDIT_ENTITY = "data_export";
export const AUDIT_ACTION = "EXPORT";

export type ExportDb = Pick<
  PrismaClient,
  | "employee"
  | "cycle"
  | "gedpDocument"
  | "groupGoalTemplate"
  | "performanceGoal"
  | "developmentGoal"
  | "documentStatusHistory"
  | "auditLog"
>;

export interface ExportFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  preview: ExportPreview;
}

async function load(db: ExportDb, viewer: Viewer, request: ExportRequest) {
  await requireActiveHrAdmin(db, viewer);
  const scope = await resolveScope(db, viewer, request);
  const sheets = await loadSheets(db, scope, request.dataTypes);
  return { scope, sheets };
}

function toPreview(people: number, sheets: readonly ExportSheet[]): ExportPreview {
  return { people, records: Object.fromEntries(sheets.map((sheet) => [sheet.dataType, sheet.rows.length])) };
}

/** Counts only; writes nothing. */
export async function previewExport(db: ExportDb, viewer: Viewer, request: ExportRequest): Promise<ExportPreview> {
  const { scope, sheets } = await load(db, viewer, request);
  return toPreview(scope.people.length, sheets);
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** ASCII only, so every browser and OS keeps the name: gedp-eksport-2027-20270131-0905.xlsx */
export function exportFileName(request: ExportRequest, now: Date): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  const type = request.format === "csv" ? `-${request.dataTypes[0]}` : "";
  return `gedp-eksport-${request.year}${type}-${stamp}.${request.format}`;
}

export async function exportData(
  db: ExportDb,
  viewer: Viewer,
  request: ExportRequest,
  now: Date = new Date(),
): Promise<ExportFile> {
  const { scope, sheets } = await load(db, viewer, request);
  if (scope.people.length === 0) throw new ExportError("NO_PEOPLE", "Nobody in the chosen scope");

  const preview = toPreview(scope.people.length, sheets);
  const fileName = exportFileName(request, now);
  const bytes = await buildFile(request.format, sheets);

  await writeAudit(db, {
    actorId: viewer.id,
    entity: AUDIT_ENTITY,
    entityId: request.year,
    action: AUDIT_ACTION,
    after: {
      fileName,
      format: request.format,
      year: request.year,
      dataTypes: request.dataTypes,
      people: request.people,
      peopleCount: preview.people,
      // The resolved people, not only the filter: a department or "all" means other people later.
      exportedAmeis: scope.people.map((person) => person.amei),
      records: preview.records,
    },
  });
  return { fileName, mimeType: MIME_TYPES[request.format], bytes, preview };
}
