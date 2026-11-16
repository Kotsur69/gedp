import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportPreview } from "@/server/import/pipeline";
import type { StructureRecord } from "@/server/import/structure";

const requireEmployee = vi.fn();
vi.mock("@/server/current-employee", () => ({ requireEmployee }));

const fakeDb = { marker: "db" };
vi.mock("@/server/db", () => ({ db: () => fakeDb }));

const previewImport = vi.fn();
const confirmImport = vi.fn();
vi.mock("@/server/import/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/import/pipeline")>()),
  previewImport,
  confirmImport,
}));

const { previewStructureImport, confirmStructureImport } = await import("./actions");
const { ImportBlockedError, ImportStaleError } = await import("@/server/import/pipeline");
const { ImportFileError, MAX_IMPORT_FILE_BYTES } = await import("@/server/import/table");
const { ForbiddenError } = await import("@/server/permissions");
const { MAX_PREVIEW_ERRORS, MAX_PREVIEW_ROWS, toPreviewView } = await import("./preview-view");

const HR = { id: 1, firstName: "Hanna", lastName: "Kadrowa", isHrAdmin: true };
const EMPLOYEE = { id: 2, firstName: "Jan", lastName: "Testowy", isHrAdmin: false };
const FINGERPRINT = "a".repeat(64);

function csvFile(name = "struktura.csv", content = "amei;email\nAB12345;jan@example.com\n"): File {
  return new File([content], name, { type: "text/csv" });
}

function form(entries: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const RECORD: StructureRecord = {
  amei: "AB12345",
  email: "jan@example.com",
  firstName: "Jan",
  lastName: "Testowy",
  managerAmei: null,
  department: null,
  position: null,
  location: null,
  isWhiteCollar: true,
  isActive: true,
  hireDate: "2020-01-15",
  isHrAdmin: false,
};

function preview(overrides: Partial<ImportPreview<StructureRecord>> = {}): ImportPreview<StructureRecord> {
  return {
    kind: "STRUKTURA",
    totalRows: 3,
    created: [{ line: 2, key: "AB12345", before: null, after: RECORD, fields: [{ field: "amei", before: null, after: "AB12345" }] }],
    changed: [],
    deactivated: [],
    unchangedCount: 0,
    errors: [
      { line: 3, column: "email", code: "INVALID_EMAIL", message: '"x" is not a valid e-mail' },
      { line: 4, column: "manager_amei", code: "UNKNOWN_MANAGER", message: "Manager ZZ99999 is unknown" },
    ],
    fileErrors: [],
    fileName: "struktura.csv",
    errorRowCount: 2,
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

beforeEach(() => {
  requireEmployee.mockReset().mockResolvedValue(HR);
  previewImport.mockReset().mockResolvedValue(preview());
  confirmImport.mockReset().mockResolvedValue({
    status: "IMPORTED",
    batchId: 9,
    counts: { newCount: 1, changedCount: 0, deactivatedCount: 0, errorCount: 2 },
  });
});

describe("[HR-01] previewStructureImport", () => {
  it("refuses a non-HR user before reading the file or touching the pipeline (403)", async () => {
    requireEmployee.mockResolvedValue(EMPLOYEE);
    await expect(previewStructureImport(form({ file: csvFile() }))).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    expect(previewImport).not.toHaveBeenCalled();
  });

  it("maps a pipeline ForbiddenError (e.g. HR rights revoked meanwhile) to FORBIDDEN", async () => {
    previewImport.mockRejectedValue(new ForbiddenError("edit", "Only active HR may import data"));
    await expect(previewStructureImport(form({ file: csvFile() }))).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("previews only: never calls confirm, so nothing is written", async () => {
    const result = await previewStructureImport(form({ file: csvFile() }));
    expect(result.ok).toBe(true);
    expect(confirmImport).not.toHaveBeenCalled();
    const [db, , viewer, file] = previewImport.mock.calls[0];
    expect(db).toBe(fakeDb);
    expect(viewer).toEqual(HR);
    expect(file.fileName).toBe("struktura.csv");
    expect(new TextDecoder().decode(file.bytes)).toContain("AB12345");
  });

  it("returns every error with its row number and reason code", async () => {
    const result = await previewStructureImport(form({ file: csvFile() }));
    if (!result.ok) throw new Error("expected a preview");
    expect(result.preview.errors.map(({ line, column, code }) => ({ line, column, code }))).toEqual([
      { line: 3, column: "email", code: "INVALID_EMAIL" },
      { line: 4, column: "manager_amei", code: "UNKNOWN_MANAGER" },
    ]);
    expect(result.preview.errorRowCount).toBe(2);
    expect(result.preview.fingerprint).toBe(FINGERPRINT);
  });

  it.each([
    ["missing file", form({}), "NO_FILE"],
    ["file field is text", form({ file: "not a file" }), "NO_FILE"],
    ["empty file", form({ file: csvFile("a.csv", "") }), "NO_FILE"],
    ["wrong extension", form({ file: csvFile("struktura.pdf") }), "UNSUPPORTED_FORMAT"],
    ["too large", form({ file: csvFile("big.csv", "x".repeat(MAX_IMPORT_FILE_BYTES + 1)) }), "FILE_TOO_LARGE"],
  ])("rejects %s with zod before the pipeline", async (_name, data, code) => {
    await expect(previewStructureImport(data)).resolves.toEqual({ ok: false, code });
    expect(previewImport).not.toHaveBeenCalled();
  });

  it("passes file-level read errors through as their code", async () => {
    previewImport.mockRejectedValue(new ImportFileError("NOT_UTF8", "CSV is not UTF-8"));
    await expect(previewStructureImport(form({ file: csvFile() }))).resolves.toEqual({ ok: false, code: "NOT_UTF8" });
  });

  it("reports unexpected failures as FAILED and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    previewImport.mockRejectedValue(new Error("connection reset"));
    await expect(previewStructureImport(form({ file: csvFile() }))).resolves.toEqual({ ok: false, code: "FAILED" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("[HR-02] confirmStructureImport", () => {
  it("refuses a non-HR user without writing (403)", async () => {
    requireEmployee.mockResolvedValue(EMPLOYEE);
    const result = await confirmStructureImport(form({ file: csvFile(), fingerprint: FINGERPRINT }));
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(confirmImport).not.toHaveBeenCalled();
  });

  it("imports the valid rows of the previewed file, pinned to the preview fingerprint", async () => {
    const result = await confirmStructureImport(form({ file: csvFile(), fingerprint: FINGERPRINT }));
    expect(result).toEqual({ ok: true, counts: { newCount: 1, changedCount: 0, deactivatedCount: 0, errorCount: 2 } });
    const [, , viewer, , request] = confirmImport.mock.calls[0];
    expect(viewer).toEqual(HR);
    expect(request).toEqual({ mode: "IMPORT_VALID_ROWS", fingerprint: FINGERPRINT });
  });

  it.each(["", "abc", "A".repeat(64), `${FINGERPRINT}0`])("rejects a malformed fingerprint %j", async (fingerprint) => {
    const result = await confirmStructureImport(form({ file: csvFile(), fingerprint }));
    expect(result).toEqual({ ok: false, code: "INVALID_REQUEST" });
    expect(confirmImport).not.toHaveBeenCalled();
  });

  it.each([
    [new ImportStaleError(), "STALE"],
    [new ImportBlockedError([]), "BLOCKED"],
    [new ImportFileError("UNREADABLE", "broken"), "UNREADABLE"],
  ])("maps %s", async (error, code) => {
    confirmImport.mockRejectedValue(error);
    const result = await confirmStructureImport(form({ file: csvFile(), fingerprint: FINGERPRINT }));
    expect(result).toEqual({ ok: false, code });
  });

  it("never reports success unless the pipeline says IMPORTED", async () => {
    confirmImport.mockResolvedValue({ status: "REJECTED" });
    const result = await confirmStructureImport(form({ file: csvFile(), fingerprint: FINGERPRINT }));
    expect(result).toEqual({ ok: false, code: "FAILED" });
  });
});

describe("toPreviewView", () => {
  it("keeps full counts but caps the rows sent to the browser", () => {
    const many = Array.from({ length: MAX_PREVIEW_ROWS + 5 }, (_, i) => ({
      line: i + 2,
      key: `AB${String(i).padStart(5, "0")}`,
      before: null,
      after: RECORD,
      fields: [],
    }));
    const errors = Array.from({ length: MAX_PREVIEW_ERRORS + 1 }, (_, i) => ({
      line: i + 2,
      column: null,
      code: "REQUIRED",
      message: "required",
    }));
    const view = toPreviewView(preview({ created: many, errors }));
    expect(view.counts).toEqual({ created: MAX_PREVIEW_ROWS + 5, changed: 0, deactivated: 0, errors: MAX_PREVIEW_ERRORS + 1 });
    expect(view.created).toHaveLength(MAX_PREVIEW_ROWS);
    expect(view.errors).toHaveLength(MAX_PREVIEW_ERRORS);
  });

  it("sends field values only for changed rows, as display strings", () => {
    const change = {
      line: 5,
      key: "AB12345",
      before: RECORD,
      after: { ...RECORD, department: "Finanse" },
      fields: [
        { field: "department", before: null, after: "Finanse" },
        { field: "isActive", before: true, after: false },
      ],
    };
    const deactivation = { ...change, line: null, after: { ...RECORD, isActive: false } };
    const view = toPreviewView(preview({ changed: [change], deactivated: [deactivation] }));
    expect(view.changed).toEqual([
      {
        line: 5,
        key: "AB12345",
        name: "Jan Testowy",
        fields: [
          { field: "department", before: "", after: "Finanse" },
          { field: "isActive", before: "true", after: "false" },
        ],
      },
    ]);
    expect(view.deactivated).toEqual([{ line: null, key: "AB12345", name: "Jan Testowy", fields: [] }]);
    expect(view.created.every((row) => row.fields.length === 0)).toBe(true);
  });

  it("drops the server-side English message from issues but keeps the people of a cycle", () => {
    const cycle = { line: 7, column: "manager_amei", code: "HIERARCHY_CYCLE", message: "Hierarchy cycle: A -> B -> A", people: ["A", "B"] };
    const view = toPreviewView(preview({ errors: [cycle], fileErrors: [{ line: null, column: null, code: "NO_ROWS", message: "x" }] }));
    expect(view.errors).toEqual([{ line: 7, column: "manager_amei", code: "HIERARCHY_CYCLE", people: ["A", "B"] }]);
    expect(view.fileErrors).toEqual([{ line: null, column: null, code: "NO_ROWS" }]);
  });
});
