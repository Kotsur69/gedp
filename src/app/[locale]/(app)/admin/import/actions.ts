"use server";

import { z } from "zod";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import {
  confirmImport,
  ImportBlockedError,
  ImportStaleError,
  previewImport,
  type ImportCounts,
} from "@/server/import/pipeline";
import { structureImport } from "@/server/import/structure";
import { ImportFileError, MAX_IMPORT_FILE_BYTES, type ImportFileErrorCode } from "@/server/import/table";
import { isAccessError } from "@/server/permissions";
import { toPreviewView, type PreviewView } from "./preview-view";

// Server Actions of the HR import screen (HR-01..03). Both check HR here and again inside the
// pipeline against the live database row; the browser only holds the file and the preview
// fingerprint. previewStructureImport writes NOTHING. confirmStructureImport writes only after the
// pipeline re-plans the same file and its fingerprint matches what HR saw. "Odrzuć całość" needs
// no action: nothing was written, so the screen just discards the preview.

const ALLOWED_EXTENSION = /\.(xlsx|csv)$/i;

const fileSchema = z
  .instanceof(File, { message: "NO_FILE" })
  .refine((file) => file.size > 0, "NO_FILE")
  .refine((file) => file.size <= MAX_IMPORT_FILE_BYTES, "FILE_TOO_LARGE")
  .refine((file) => ALLOWED_EXTENSION.test(file.name), "UNSUPPORTED_FORMAT");

const previewSchema = z.object({ file: fileSchema });
const confirmSchema = z.object({
  file: fileSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "INVALID_REQUEST"),
});

export type ImportActionErrorCode =
  | ImportFileErrorCode
  | "NO_FILE"
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "STALE"
  | "BLOCKED"
  | "FAILED";

export type PreviewResult = { ok: true; preview: PreviewView } | { ok: false; code: ImportActionErrorCode };
export type ConfirmResult = { ok: true; counts: ImportCounts } | { ok: false; code: ImportActionErrorCode };

const VALIDATION_CODES: readonly ImportActionErrorCode[] = ["NO_FILE", "FILE_TOO_LARGE", "UNSUPPORTED_FORMAT"];

function validationCode(error: z.ZodError): ImportActionErrorCode {
  const message = error.issues[0]?.message;
  return VALIDATION_CODES.find((code) => code === message) ?? "INVALID_REQUEST";
}

/** Maps the errors the pipeline is expected to throw; anything else is logged and reported as FAILED. */
function failureCode(error: unknown, step: string): ImportActionErrorCode {
  if (isAccessError(error)) return "FORBIDDEN";
  if (error instanceof ImportFileError) return error.code;
  if (error instanceof ImportStaleError) return "STALE";
  if (error instanceof ImportBlockedError) return "BLOCKED";
  console.error(`[import] ${step} failed`, error);
  return "FAILED";
}

async function readFile(file: File) {
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Step 1: parse, validate and diff the uploaded file. Writes nothing. */
export async function previewStructureImport(formData: FormData): Promise<PreviewResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN" };
  const parsed = previewSchema.safeParse({ file: formData.get("file") });
  if (!parsed.success) return { ok: false, code: validationCode(parsed.error) };
  try {
    const preview = await previewImport(db(), structureImport, viewer, await readFile(parsed.data.file));
    return { ok: true, preview: toPreviewView(preview) };
  } catch (error: unknown) {
    return { ok: false, code: failureCode(error, "preview") };
  }
}

/** Step 2, "Zatwierdź import": writes the valid rows of the same file HR previewed. */
export async function confirmStructureImport(formData: FormData): Promise<ConfirmResult> {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) return { ok: false, code: "FORBIDDEN" };
  const parsed = confirmSchema.safeParse({ file: formData.get("file"), fingerprint: formData.get("fingerprint") });
  if (!parsed.success) return { ok: false, code: validationCode(parsed.error) };
  try {
    const result = await confirmImport(db(), structureImport, viewer, await readFile(parsed.data.file), {
      mode: "IMPORT_VALID_ROWS",
      fingerprint: parsed.data.fingerprint,
    });
    // IMPORT_VALID_ROWS never yields REJECTED; guard so a pipeline change cannot report a fake success.
    if (result.status !== "IMPORTED") return { ok: false, code: "FAILED" };
    return { ok: true, counts: result.counts };
  } catch (error: unknown) {
    return { ok: false, code: failureCode(error, "confirm") };
  }
}
