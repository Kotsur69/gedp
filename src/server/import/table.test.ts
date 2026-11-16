import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  cellText,
  declaredUnzippedSize,
  ImportFileError,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_LINES,
  MAX_XLSX_UNCOMPRESSED_BYTES,
  readTable,
} from "./table";

const DIR = join(process.cwd(), "tests", "fixtures", "import");
const csv = (text: string, fileName = "file.csv") => readTable({ fileName, bytes: Buffer.from(text, "utf8") });

async function xlsx(rows: ExcelJS.CellValue[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Arkusz1");
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function fileError(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImportFileError);
  return (error as ImportFileError).code;
}

describe("readTable", () => {
  it("reads the CSV fixture: BOM stripped, ';' split, values kept as strings", async () => {
    const table = await readTable({ fileName: "valid.csv", bytes: readFileSync(join(DIR, "valid.csv")) });
    expect(table.headers[0]).toBe("amei");
    expect(table.headers).toHaveLength(12);
    expect(table.rows).toHaveLength(12);
    expect(table.rows[0]).toEqual({
      line: 2,
      cells: [
        "AM0090001", "anna.nowak.1@example.com", "Anna", "Nowak", "", "Zarząd", "Dyrektor Zarządzający",
        "Oddział A", "TAK", "TAK", "2011-02-01", "NIE",
      ],
    });
  });

  it("reads the XLSX fixture into the same table as the CSV", async () => {
    const fromCsv = await readTable({ fileName: "valid.csv", bytes: readFileSync(join(DIR, "valid.csv")) });
    const fromXlsx = await readTable({ fileName: "VALID.XLSX", bytes: readFileSync(join(DIR, "valid.xlsx")) });
    expect(fromXlsx).toEqual(fromCsv);
  });

  it("handles ',' delimiters, quoted fields and blank lines without shifting line numbers", async () => {
    const table = await csv('a,b\r\n"x, y","multi\nline"\r\n\r\n , z \r\n');
    expect(table.rows).toEqual([
      { line: 2, cells: ["x, y", "multi\nline"] },
      { line: 4, cells: ["", "z"] },
    ]);
  });

  it("pads short rows with empty cells and ignores cells beyond the header", async () => {
    const table = await csv("a;b\nonly\n1;2;3\n");
    expect(table.rows.map((r) => r.cells)).toEqual([
      ["only", ""],
      ["1", "2"],
    ]);
  });

  it("rejects unsupported, oversized, non-UTF-8 and fake files", async () => {
    expect(await fileError(csv("a", "file.xls"))).toBe("UNSUPPORTED_FORMAT");
    expect(await fileError(csv("a", "no-extension"))).toBe("UNSUPPORTED_FORMAT");
    const huge = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1);
    expect(await fileError(readTable({ fileName: "big.csv", bytes: huge }))).toBe("FILE_TOO_LARGE");
    // "Łódź" in Windows-1250, a typical non-UTF-8 Excel export.
    const cp1250 = new Uint8Array([0x61, 0x0d, 0x0a, 0xa3, 0xf3, 0x64, 0x9f]);
    expect(await fileError(readTable({ fileName: "pl.csv", bytes: cp1250 }))).toBe("NOT_UTF8");
    expect(await fileError(csv("not a zip", "fake.xlsx"))).toBe("UNREADABLE");
    const brokenZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
    expect(await fileError(readTable({ fileName: "broken.xlsx", bytes: brokenZip }))).toBe("UNREADABLE");
  });

  it("rejects a file without a header line", async () => {
    expect(await fileError(csv("\r\n\r\n"))).toBe("NO_HEADER");
    expect(await fileError(readTable({ fileName: "empty.xlsx", bytes: await xlsx([]) }))).toBe("NO_HEADER");
  });

  it("turns real Excel cells (dates, numbers, links, rich text, formulas) into text", async () => {
    const bytes = await xlsx([
      ["date", "number", "link", "rich", "formula", "flag"],
      [
        new Date(Date.UTC(2019, 2, 1)),
        1234,
        { text: "jan@example.com", hyperlink: "mailto:jan@example.com" },
        { richText: [{ text: "Jan " }, { text: "Kowalski" }] },
        { formula: "1+1", result: 2 },
        true,
      ],
    ]);
    const table = await readTable({ fileName: "cells.xlsx", bytes });
    expect(table.rows[0].cells).toEqual(["2019-03-01", "1234", "jan@example.com", "Jan Kowalski", "2", "TRUE"]);
  });

  it("cellText covers the remaining value shapes", () => {
    expect(cellText(undefined)).toBe("");
    expect(cellText(null)).toBe("");
    expect(cellText(false)).toBe("FALSE");
    expect(cellText(new Date(Date.UTC(2019, 2, 1, 12, 30)))).toBe("2019-03-01T12:30:00.000Z");
    expect(cellText({ error: "#N/A" } as ExcelJS.CellErrorValue)).toBe("#N/A");
    expect(cellText({ sharedFormula: "A1", result: "x" } as ExcelJS.CellSharedFormulaValue)).toBe("x");
    expect(cellText({} as ExcelJS.CellValue)).toBe("");
  });
});

describe("readTable - limits checked before the expensive work", () => {
  it("rejects a file name without an extension", async () => {
    expect(await fileError(csv("a", "csv"))).toBe("UNSUPPORTED_FORMAT");
  });

  it("rejects too many columns in CSV and XLSX", async () => {
    expect(await fileError(csv(`${"c;".repeat(MAX_IMPORT_COLUMNS)}c\n1\n`))).toBe("TOO_MANY_COLUMNS");
    const wide = new ExcelJS.Workbook();
    wide.addWorksheet("A").getCell("XFD1").value = "far away";
    const bytes = new Uint8Array(await wide.xlsx.writeBuffer());
    expect(await fileError(readTable({ fileName: "wide.xlsx", bytes }))).toBe("TOO_MANY_COLUMNS");
  });

  it("rejects files that are mostly blank lines, in CSV and XLSX", async () => {
    expect(await fileError(csv(`a;b\n${"\n".repeat(MAX_IMPORT_LINES)}`))).toBe("TOO_MANY_ROWS");
    const tall = new ExcelJS.Workbook();
    const sheet = tall.addWorksheet("A");
    sheet.getCell("A1").value = "a";
    sheet.getCell(`A${MAX_IMPORT_LINES + 5}`).value = "x";
    const bytes = new Uint8Array(await tall.xlsx.writeBuffer());
    expect(await fileError(readTable({ fileName: "tall.xlsx", bytes }))).toBe("TOO_MANY_ROWS");
  });

  it("rejects an .xlsx whose declared unpacked size is too large, without unpacking it", async () => {
    const bytes = new Uint8Array(await xlsx([["a"], ["b"]]));
    expect(declaredUnzippedSize(bytes)).toBeGreaterThan(0);
    // Patch the uncompressed size (offset 24) of the first central-directory entry to ~4 GB.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = bytes.findIndex((_, i) => i + 4 <= bytes.length && view.getUint32(i, true) === 0x02014b50);
    view.setUint32(central + 24, 0xfffffff0, true);
    expect(declaredUnzippedSize(bytes)).toBeGreaterThan(MAX_XLSX_UNCOMPRESSED_BYTES);
    expect(await fileError(readTable({ fileName: "bomb.xlsx", bytes }))).toBe("FILE_TOO_LARGE");
  });

  it("declaredUnzippedSize returns null for anything that is not a well-formed ZIP", () => {
    expect(declaredUnzippedSize(new Uint8Array(10))).toBeNull();
    const noDirectory = new Uint8Array(64);
    new DataView(noDirectory.buffer).setUint32(0, 0x04034b50, true);
    expect(declaredUnzippedSize(noDirectory)).toBeNull();
    const badEntry = new Uint8Array(64);
    const view = new DataView(badEntry.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint32(40, 0x06054b50, true); // EOCD claiming 1 entry at offset 4 that is not a central header
    view.setUint16(50, 1, true);
    view.setUint32(56, 4, true);
    expect(declaredUnzippedSize(badEntry)).toBeNull();
  });
});
