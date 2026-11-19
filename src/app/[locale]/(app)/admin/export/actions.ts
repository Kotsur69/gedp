"use server";

import type { ExportErrorCode, ExportPreview } from "@/domain/data-export";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { parseExportRequest } from "@/server/export/request";
import { ExportError } from "@/server/export/scope";
import { exportData, previewExport } from "@/server/export/service";
import { isAccessError } from "@/server/permissions";

// Server Actions of the HR export screen (HR-08, HR-12). The payload is untrusted and parsed here;
// HR is checked here and again in the service against the live row. The file goes back as base64
// in the action response (a POST with Next's origin check), never through a GET URL that a link,
// prefetch or image tag could trigger - so every download is a deliberate, audited request.

export type ExportFailure = { ok: false; code: ExportErrorCode; ameis?: string[] };
export type PreviewResult = { ok: true; preview: ExportPreview } | ExportFailure;
export type DownloadResult =
  | { ok: true; fileName: string; mimeType: string; base64: string; preview: ExportPreview }
  | ExportFailure;

function failure(error: unknown, step: string): ExportFailure {
  if (isAccessError(error)) return { ok: false, code: "FORBIDDEN" };
  if (error instanceof ExportError) {
    return error.ameis.length > 0 ? { ok: false, code: error.code, ameis: [...error.ameis] } : { ok: false, code: error.code };
  }
  console.error(`[export] ${step} failed`, error);
  return { ok: false, code: "FAILED" };
}

/** Counts people and records in the chosen scope. Writes nothing. */
export async function previewExportAction(raw: unknown): Promise<PreviewResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN" };
  const parsed = parseExportRequest(raw);
  if (!parsed.ok) return parsed;
  try {
    return { ok: true, preview: await previewExport(db(), viewer, parsed.request) };
  } catch (error: unknown) {
    return failure(error, "preview");
  }
}

/** Builds the file and records the export in the audit log before returning it. */
export async function downloadExportAction(raw: unknown): Promise<DownloadResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN" };
  const parsed = parseExportRequest(raw);
  if (!parsed.ok) return parsed;
  try {
    const file = await exportData(db(), viewer, parsed.request);
    return {
      ok: true,
      fileName: file.fileName,
      mimeType: file.mimeType,
      base64: Buffer.from(file.bytes).toString("base64"),
      preview: file.preview,
    };
  } catch (error: unknown) {
    return failure(error, "download");
  }
}
