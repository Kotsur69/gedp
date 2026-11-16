import "server-only";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

// Generic file reader of the import pipeline: CSV or XLSX bytes -> header + rows of plain strings.
// It knows nothing about columns or meaning; each importer (structure today, goals/documents for
// HR-11 later) maps the RawTable itself. Line numbers are the spreadsheet lines HR sees
// (header = line 1), so every validation error can point at the exact row.
// Limits are checked BEFORE the expensive work (parsing, unzipping, iterating), so a small crafted
// file cannot make the server allocate millions of rows or columns.

export interface ImportFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface RawRow {
  /** Spreadsheet line (header = 1). Blank lines are skipped but keep the numbering. */
  line: number;
  /** One trimmed string per header column; missing cells are "". */
  cells: readonly string[];
}

export interface RawTable {
  /** Header names, trimmed and lower-cased. */
  headers: readonly string[];
  rows: readonly RawRow[];
}

export type ImportFileErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | "NOT_UTF8"
  | "UNREADABLE"
  | "NO_HEADER"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_COLUMNS";

/** The file as a whole cannot be read; nothing in it is imported. */
export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportFileError";
  }
}

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;
/** Lines including blank ones; generous, but bounds the work for files full of empty lines. */
export const MAX_IMPORT_LINES = MAX_IMPORT_ROWS * 2;
export const MAX_IMPORT_COLUMNS = 100;
/** Declared size of all files inside an .xlsx (it is a ZIP); stops decompression bombs. */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const UTF8_BOM = "﻿";
const CSV_DELIMITERS = [";", ",", "\t"] as const;
const MS_PER_DAY = 86_400_000;

type FileFormat = "csv" | "xlsx";

function formatOf(fileName: string): FileFormat {
  const extension = /\.([^.\\/]+)$/.exec(fileName.toLowerCase())?.[1];
  if (extension === "csv") return "csv";
  if (extension === "xlsx") return "xlsx";
  throw new ImportFileError("UNSUPPORTED_FORMAT", `Unsupported file type "${fileName}": use .xlsx or .csv`);
}

/** Reads an uploaded CSV / XLSX file into a RawTable. Throws ImportFileError when it cannot. */
export async function readTable(file: ImportFile): Promise<RawTable> {
  const format = formatOf(file.fileName);
  if (file.bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileError("FILE_TOO_LARGE", `File is larger than ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`);
  }
  const sheet = format === "csv" ? await readCsvSheet(file.bytes) : await readXlsxSheet(file.bytes);
  return sheetToTable(sheet);
}

function tooManyColumns(): ImportFileError {
  return new ImportFileError("TOO_MANY_COLUMNS", `File has more than ${MAX_IMPORT_COLUMNS} columns`);
}

function tooManyLines(): ImportFileError {
  return new ImportFileError("TOO_MANY_ROWS", `File has more than ${MAX_IMPORT_ROWS} rows`);
}

async function readCsvSheet(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFileError("NOT_UTF8", 'CSV is not UTF-8: in Excel use "Save as > CSV UTF-8"');
  }
  if (text.startsWith(UTF8_BOM)) text = text.slice(UTF8_BOM.length);
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(header);
  if (header.split(delimiter).length > MAX_IMPORT_COLUMNS) throw tooManyColumns();
  if (text.split("\n").length - 1 > MAX_IMPORT_LINES) throw tooManyLines();
  try {
    // Identity `map` keeps every value a string (exceljs would otherwise turn "2019-03-01" into a Date).
    return await new ExcelJS.Workbook().csv.read(Readable.from([Buffer.from(text, "utf8")]), {
      map: (value: unknown) => value,
      parserOptions: { delimiter },
    });
  } catch (error: unknown) {
    throw new ImportFileError("UNREADABLE", `CSV could not be parsed: ${errorMessage(error)}`);
  }
}

/** Polish Excel writes ';', most other tools ','. The header line decides. */
function detectDelimiter(header: string): string {
  const count = (delimiter: string) => header.split(delimiter).length - 1;
  return CSV_DELIMITERS.reduce<string>((best, d) => (count(d) > count(best) ? d : best), CSV_DELIMITERS[0]);
}

// ZIP format constants (PKWARE APPNOTE 4.3.12 / 4.3.16).
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_EOCD_MIN_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const ZIP_CENTRAL_HEADER_LENGTH = 46;

/**
 * Sum of the uncompressed sizes declared in the ZIP central directory, or null when the bytes are
 * not a readable ZIP. ZIP64 markers (0xFFFFFFFF) count as their face value and fail the limit.
 */
export function declaredUnzippedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < ZIP_EOCD_MIN_LENGTH || view.getUint32(0, true) !== ZIP_LOCAL_HEADER) return null;
  const lowest = Math.max(0, bytes.byteLength - ZIP_EOCD_MIN_LENGTH - ZIP_MAX_COMMENT_LENGTH);
  for (let eocd = bytes.byteLength - ZIP_EOCD_MIN_LENGTH; eocd >= lowest; eocd -= 1) {
    if (view.getUint32(eocd, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const entries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    let total = 0;
    for (let i = 0; i < entries; i += 1) {
      if (offset + ZIP_CENTRAL_HEADER_LENGTH > eocd || view.getUint32(offset, true) !== ZIP_CENTRAL_HEADER) return null;
      total += view.getUint32(offset + 24, true);
      const variableLength = view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      offset += ZIP_CENTRAL_HEADER_LENGTH + variableLength;
    }
    return total;
  }
  return null;
}

async function readXlsxSheet(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const unzipped = declaredUnzippedSize(bytes);
  if (unzipped === null) {
    throw new ImportFileError("UNREADABLE", "File has the .xlsx extension but is not an Excel workbook");
  }
  if (unzipped > MAX_XLSX_UNCOMPRESSED_BYTES) {
    throw new ImportFileError("FILE_TOO_LARGE", "Excel workbook is too large once unpacked");
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer);
  } catch (error: unknown) {
    throw new ImportFileError("UNREADABLE", `Excel workbook could not be read: ${errorMessage(error)}`);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportFileError("NO_HEADER", "Excel workbook has no worksheet");
  return sheet;
}

function sheetToTable(sheet: ExcelJS.Worksheet): RawTable {
  const headerRow = sheet.getRow(1);
  const width = headerRow.cellCount;
  if (width > MAX_IMPORT_COLUMNS) throw tooManyColumns();
  if (sheet.rowCount > MAX_IMPORT_LINES) throw tooManyLines();
  const headers = Array.from({ length: width }, (_, i) => cellText(headerRow.getCell(i + 1).value).toLowerCase());
  if (headers.every((h) => h === "")) {
    throw new ImportFileError("NO_HEADER", "Line 1 must contain the column names");
  }
  const rows: RawRow[] = [];
  for (let line = 2; line <= sheet.rowCount; line += 1) {
    const row = sheet.getRow(line);
    const cells = Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1).value));
    if (cells.every((c) => c === "")) continue;
    if (rows.length === MAX_IMPORT_ROWS) throw tooManyLines();
    rows.push({ line, cells });
  }
  return { headers, rows };
}

/** Plain text of any exceljs cell value. Real Excel dates become ISO YYYY-MM-DD. */
export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return dateText(value);
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  if ("hyperlink" in value) return cellText(value.text as ExcelJS.CellValue);
  if ("error" in value) return String(value.error);
  if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  return "";
}

// exceljs returns Excel dates as UTC instants; a date without time is UTC midnight.
function dateText(value: Date): string {
  const iso = value.toISOString();
  return value.getTime() % MS_PER_DAY === 0 ? iso.slice(0, 10) : iso;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
