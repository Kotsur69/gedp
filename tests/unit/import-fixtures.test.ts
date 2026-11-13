// Keeps the generated import fixtures honest: every expected error really is in the file,
// CSVs are Excel-friendly, and the xlsx keeps Polish characters.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "tests", "fixtures", "import");

interface Expectation {
  file: string;
  xlsx: string | null;
  rows: number;
  errors: { line: number; column: string; code: string; people?: string[] }[];
  deactivated: string[];
}
const expectations = JSON.parse(readFileSync(join(DIR, "expectations.json"), "utf8")) as {
  columns: string[];
  fixtures: Expectation[];
};

function readCsv(file: string): { raw: string; lines: string[][] } {
  const raw = readFileSync(join(DIR, file), "utf8");
  const lines = raw.replace(/^﻿/, "").trimEnd().split("\r\n").map((l) => l.split(";"));
  return { raw, lines };
}

const col = (row: string[], column: string) => row[expectations.columns.indexOf(column)];

const BOOLEAN = /^(TAK|NIE)$/;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

describe("import fixtures", () => {
  it("has a fixture for every required case", () => {
    const names = expectations.fixtures.map((f) => f.file.replace(".csv", "")).sort();
    expect(names).toEqual([
      "bad-boolean", "bad-date", "deactivation", "duplicate-amei", "duplicate-email",
      "hierarchy-cycle", "missing-email", "polish-characters", "unknown-manager", "valid",
    ]);
  });

  it.each(expectations.fixtures)("$file is UTF-8 with BOM, CRLF, header + $rows rows", ({ file, rows }) => {
    const { raw, lines } = readCsv(file);
    expect(raw.startsWith("﻿")).toBe(true);
    expect(raw).toContain("\r\n");
    expect(lines[0]).toEqual(expectations.columns);
    expect(lines).toHaveLength(rows + 1);
  });

  it.each(expectations.fixtures.flatMap((f) => f.errors.map((e) => ({ ...e, file: f.file }))))(
    "$file line $line really has the $code defect",
    ({ file, line, column, code, people }) => {
      const { lines } = readCsv(file);
      const rows = lines.slice(1);
      const value = col(lines[line - 1], column);
      const others = rows.filter((_, i) => i + 2 !== line);
      if (code === "DUPLICATE_AMEI") expect(others.map((r) => col(r, "amei"))).toContain(value);
      if (code === "DUPLICATE_EMAIL") expect(others.map((r) => col(r, "email"))).toContain(value);
      if (code === "REQUIRED") expect(value).toBe("");
      if (code === "UNKNOWN_MANAGER") expect(rows.map((r) => col(r, "amei"))).not.toContain(value);
      if (code === "INVALID_BOOLEAN") expect(value).not.toMatch(BOOLEAN);
      if (code === "INVALID_DATE") expect(value).not.toMatch(ISO_DATE);
      if (code === "HIERARCHY_CYCLE") {
        const [a, b] = people!;
        const managerOf = (amei: string) => col(rows.find((r) => col(r, "amei") === amei)!, "amei_przelozonego");
        expect([managerOf(a), managerOf(b)]).toEqual([b, a]);
      }
    },
  );

  it("valid and polish-characters have no defects at all", () => {
    for (const file of ["valid.csv", "polish-characters.csv"]) {
      const rows = readCsv(file).lines.slice(1);
      const ameis = rows.map((r) => col(r, "amei"));
      expect(new Set(ameis).size).toBe(ameis.length);
      for (const r of rows) {
        expect(col(r, "white_collar")).toMatch(BOOLEAN);
        expect(col(r, "aktywny")).toMatch(BOOLEAN);
        const manager = col(r, "amei_przelozonego");
        if (manager) expect(ameis).toContain(manager);
        const hired = col(r, "data_zatrudnienia");
        if (hired) expect(hired).toMatch(ISO_DATE);
      }
    }
  });

  it("deactivation drops exactly the expected person from valid", () => {
    const valid = readCsv("valid.csv").lines.slice(1).map((r) => col(r, "amei"));
    const after = readCsv("deactivation.csv").lines.slice(1).map((r) => col(r, "amei"));
    const spec = expectations.fixtures.find((f) => f.file === "deactivation.csv")!;
    expect(valid.filter((a) => !after.includes(a))).toEqual(spec.deactivated);
  });

  it("xlsx keeps Polish characters intact", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(DIR, "polish-characters.xlsx"));
    const first = workbook.getWorksheet("Pracownicy")!.getRow(2).values as string[];
    expect(first).toContain("Łucja");
    expect(first).toContain("Śliwińska-Żółć");
    expect(first).toContain("Główny księgowy ąęłńóśźż");
  });
});
