import { describe, expect, it } from "vitest";
import { readTable } from "@/server/import/table";
import { STRUCTURE_COLUMNS } from "@/server/import/structure-columns";
import { parseExportRequest } from "./request";
import { exportHeaders, type ExportSheet } from "./sheets";
import { buildCsv, buildFile, escapeCsvCell } from "./workbook";

const UTF8_BOM = [0xef, 0xbb, 0xbf];

const sheet: ExportSheet = {
  dataType: "statusHistory",
  name: "Historia statusów",
  headers: ["amei", "imie", "komentarz", "postep_proc"],
  rows: [
    ["AM0001", "Łucja Żółkiewska", "Popraw cele; dodaj \"miernik\"\ni wagę", 40],
    ["AM0002", "Ścibor Gęślą", null, 0],
    ["AM0003", "Ewa", "=1+2", null],
  ],
};

describe("[HR-08] CSV export", () => {
  it("is UTF-8 with BOM, ';'-separated, with Polish characters intact", async () => {
    const bytes = await buildCsv(sheet);
    expect([...bytes.slice(0, 3)]).toEqual(UTF8_BOM);
    const text = new TextDecoder("utf-8").decode(bytes.slice(3));
    expect(text.split("\r\n")[0]).toBe("amei;imie;komentarz;postep_proc");
    expect(text).toContain("Łucja Żółkiewska");
    expect(text).toContain("Ścibor Gęślą");
  });

  it("round-trips through the import reader: quotes, separators, newlines and empty cells keep their columns", async () => {
    const table = await readTable({ fileName: "export.csv", bytes: await buildCsv(sheet) });
    expect(table.headers).toEqual(["amei", "imie", "komentarz", "postep_proc"]);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ["AM0001", "Łucja Żółkiewska", "Popraw cele; dodaj \"miernik\"\ni wagę", "40"],
      ["AM0002", "Ścibor Gęślą", "", "0"],
      ["AM0003", "Ewa", "'=1+2", ""],
    ]);
  });

  it("defuses cells Excel would run as formulas", () => {
    expect(["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "\rx"].map(escapeCsvCell)).toEqual([
      "'=SUM(A1)", "'+1", "'-2", "'@cmd", "'\tx", "'\rx",
    ]);
    expect(escapeCsvCell("Cel 1")).toBe("Cel 1");
    expect(escapeCsvCell(-5)).toBe(-5);
    expect(escapeCsvCell(null)).toBe("");
  });

  it("the employee sheet uses the HR-01 import headers, so it can be re-imported", () => {
    const importHeaders = Object.values(STRUCTURE_COLUMNS).map((column) => column.header);
    expect(exportHeaders("employees").slice(0, importHeaders.length)).toEqual(importHeaders);
  });

  it("refuses more than one data type in a CSV", async () => {
    await expect(buildFile("csv", [sheet, sheet])).rejects.toThrow("exactly one");
  });
});

describe("[HR-12] export request validation", () => {
  const base = { dataTypes: ["documents"], year: 2027, people: { kind: "all" }, format: "xlsx" };

  it("normalises AMEIs, drops duplicates and orders data types the fixed way", () => {
    expect(
      parseExportRequest({
        ...base,
        dataTypes: ["statusHistory", "employees"],
        people: { kind: "selected", ameis: [" am0001 ", "AM0001", "am0002"] },
      }),
    ).toEqual({
      ok: true,
      request: { ...base, dataTypes: ["employees", "statusHistory"], people: { kind: "selected", ameis: ["AM0001", "AM0002"] } },
    });
  });

  it("CSV takes exactly one data type", () => {
    expect(parseExportRequest({ ...base, format: "csv", dataTypes: ["documents", "employees"] })).toEqual({
      ok: false,
      code: "CSV_SINGLE_TYPE",
    });
    expect(parseExportRequest({ ...base, format: "csv" }).ok).toBe(true);
  });

  it("rejects anything unexpected", () => {
    const invalid = [
      { ...base, dataTypes: [] },
      { ...base, dataTypes: ["documents", "documents"] },
      { ...base, dataTypes: ["salaries"] },
      { ...base, year: 1999 },
      { ...base, year: "2027" },
      { ...base, format: "xls" },
      { ...base, people: { kind: "one", amei: "AM-1; DROP" } },
      { ...base, people: { kind: "selected", ameis: [] } },
      { ...base, people: { kind: "department", department: " " } },
      { ...base, people: { kind: "everyone" } },
      { ...base, extra: true },
      null,
    ];
    for (const raw of invalid) expect(parseExportRequest(raw)).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});
