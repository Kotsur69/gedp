import "server-only";
import ExcelJS from "exceljs";
import type { ExportFormat } from "@/domain/data-export";
import type { Cell, ExportSheet } from "./sheets";

// Export file writers (HR-08) on exceljs, the library the import already uses (never the `xlsx`
// package). .xlsx = one worksheet per data type. CSV = one data type, UTF-8 with BOM and ";" as the
// separator, so Excel with Polish regional settings opens it with Polish characters and real columns.

export const CSV_DELIMITER = ";";

export const MIME_TYPES: Readonly<Record<ExportFormat, string>> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 60;
const HEADER_FILL = "FFF2F2F2";

// CSV/formula injection (OWASP): Excel runs a cell that starts with one of these as a formula.
// Free text (goal titles, comments) is typed by employees, so such a value is prefixed with "'".
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: Cell): string | number {
  if (value === null) return "";
  if (typeof value === "number") return value;
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function columnWidth(sheet: ExportSheet, column: number): number {
  const longest = sheet.rows.reduce(
    (max, row) => Math.max(max, String(row[column] ?? "").length),
    sheet.headers[column]?.length ?? 0,
  );
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + 2));
}

function addWorksheet(workbook: ExcelJS.Workbook, sheet: ExportSheet): void {
  const worksheet = workbook.addWorksheet(sheet.name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = sheet.headers.map((header, index) => ({ header, key: header, width: columnWidth(sheet, index) }));
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  // .xlsx cells are typed: a string is stored as text, never evaluated, so no escaping is needed.
  for (const row of sheet.rows) worksheet.addRow(row);
  if (sheet.headers.length > 0) {
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.headers.length } };
  }
}

export async function buildXlsx(sheets: readonly ExportSheet[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GEDP";
  for (const sheet of sheets) addWorksheet(workbook, sheet);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function buildCsv(sheet: ExportSheet): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name);
  worksheet.addRow([...sheet.headers]);
  // Every cell becomes a string or number first: exceljs would skip null cells and shift columns.
  for (const row of sheet.rows) worksheet.addRow(row.map(escapeCsvCell));
  const buffer = await workbook.csv.writeBuffer({
    sheetName: sheet.name,
    includeEmptyRows: false,
    map: (value: unknown) => value,
    formatterOptions: { delimiter: CSV_DELIMITER, rowDelimiter: "\r\n", writeBOM: true },
  });
  return new Uint8Array(buffer);
}

export async function buildFile(format: ExportFormat, sheets: readonly ExportSheet[]): Promise<Uint8Array> {
  if (format === "xlsx") return buildXlsx(sheets);
  const [sheet] = sheets;
  if (sheets.length !== 1 || !sheet) throw new Error("CSV export takes exactly one data type");
  return buildCsv(sheet);
}
