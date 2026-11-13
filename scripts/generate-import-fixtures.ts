// Generates the SYNTHETIC employee-structure import fixtures in tests/fixtures/import/.
// Format: "Historia wersji oraz md/Wymagania/07_Panel_HR_raporty_statystyki.md" (proposed, Q-10),
// plus the optional `hr_admin` column (our assumption, also Q-10).
// Run: npm run fixtures:import  - the output is committed; re-run after changing this file.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const OUT_DIR = join(process.cwd(), "tests", "fixtures", "import");
const BOM = "﻿";
const SEPARATOR = ";"; // Polish Excel default for CSV
const EOL = "\r\n";

const COLUMNS = [
  "amei", "email", "imie", "nazwisko", "amei_przelozonego", "dzial", "stanowisko",
  "lokalizacja", "white_collar", "aktywny", "data_zatrudnienia", "hr_admin",
] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

const ameiOf = (n: number) => `AM${String(90000 + n).padStart(7, "0")}`;

function person(
  n: number, imie: string, nazwisko: string, manager: number | null, dzial: string, stanowisko: string,
  extra: Partial<Row> = {},
): Row {
  return {
    amei: ameiOf(n),
    email: `${imie}.${nazwisko}.${n}@example.com`.toLowerCase(),
    imie,
    nazwisko,
    amei_przelozonego: manager === null ? "" : ameiOf(manager),
    dzial,
    stanowisko,
    lokalizacja: "Oddział A",
    white_collar: "TAK",
    aktywny: "TAK",
    data_zatrudnienia: `20${10 + (n % 14)}-0${1 + (n % 9)}-01`,
    hr_admin: "NIE",
    ...extra,
  };
}

// 12 people in 4 levels. Spreadsheet line = array index + 2 (line 1 is the header).
const VALID: Row[] = [
  person(1, "Anna", "Nowak", null, "Zarząd", "Dyrektor Zarządzający"),
  person(2, "Piotr", "Kowalczyk", 1, "Produkcja", "Dyrektor"),
  person(3, "Ewa", "Zielinska", 1, "HR", "Dyrektor", { hr_admin: "TAK" }),
  person(4, "Tomasz", "Wojcik", 2, "Produkcja", "Kierownik"),
  person(5, "Monika", "Krawczyk", 2, "Produkcja", "Kierownik"),
  person(6, "Adam", "Pawlak", 3, "HR", "Specjalista ds. kadr", { hr_admin: "TAK" }),
  person(7, "Joanna", "Mazur", 4, "Produkcja", "Specjalista"),
  person(8, "Marcin", "Krol", 4, "Produkcja", "Operator", { white_collar: "NIE" }),
  person(9, "Natalia", "Grabowska", 5, "Produkcja", "Specjalista"),
  person(10, "Jakub", "Michalski", 5, "Produkcja", "Specjalista", { aktywny: "NIE" }),
  person(11, "Barbara", "Wieczorek", 3, "HR", "Specjalista", { data_zatrudnienia: "" }),
  person(12, "Grzegorz", "Lewandowski", 4, "Produkcja", "Specjalista"),
];
const EXTRA_LINE = VALID.length + 2;
const withRow = (rows: Row[], index: number, patch: Partial<Row>) =>
  rows.map((r, i) => (i === index ? { ...r, ...patch } : r));

const POLISH = withRow(
  withRow(VALID, 0, { imie: "Łucja", nazwisko: "Śliwińska-Żółć", dzial: "Sprzedaż", stanowisko: "Główny księgowy ąęłńóśźż" }),
  6,
  { imie: "Bożena", nazwisko: "Źdźbło", lokalizacja: "Dąbrowa Górnicza" },
);

interface ExpectedError { line: number; column: string; code: string; people?: string[] }
interface Fixture { file: string; rows: Row[]; errors: ExpectedError[]; deactivated?: string[]; xlsx?: boolean }

const extraPerson = person(13, "Kamil", "Duplikat", 2, "Produkcja", "Specjalista");

const FIXTURES: Fixture[] = [
  { file: "valid", rows: VALID, errors: [], xlsx: true },
  {
    file: "duplicate-amei",
    rows: [...VALID, { ...extraPerson, amei: VALID[3].amei }],
    errors: [{ line: EXTRA_LINE, column: "amei", code: "DUPLICATE_AMEI" }],
  },
  {
    file: "duplicate-email",
    rows: [...VALID, { ...extraPerson, email: VALID[3].email }],
    errors: [{ line: EXTRA_LINE, column: "email", code: "DUPLICATE_EMAIL" }],
  },
  { file: "missing-email", rows: withRow(VALID, 4, { email: "" }), errors: [{ line: 6, column: "email", code: "REQUIRED" }] },
  {
    file: "unknown-manager",
    rows: withRow(VALID, 5, { amei_przelozonego: "AM0099999" }),
    errors: [{ line: 7, column: "amei_przelozonego", code: "UNKNOWN_MANAGER" }],
  },
  {
    // AM0090009 -> AM0090010 -> AM0090009
    file: "hierarchy-cycle",
    rows: withRow(withRow(VALID, 8, { amei_przelozonego: VALID[9].amei }), 9, { amei_przelozonego: VALID[8].amei }),
    errors: [{ line: 10, column: "amei_przelozonego", code: "HIERARCHY_CYCLE", people: [VALID[8].amei, VALID[9].amei] }],
  },
  {
    file: "bad-boolean",
    rows: withRow(withRow(VALID, 5, { white_collar: "TAKK" }), 6, { aktywny: "yes" }),
    errors: [
      { line: 7, column: "white_collar", code: "INVALID_BOOLEAN" },
      { line: 8, column: "aktywny", code: "INVALID_BOOLEAN" },
    ],
  },
  {
    file: "bad-date",
    rows: withRow(withRow(VALID, 7, { data_zatrudnienia: "2019-13-01" }), 8, { data_zatrudnienia: "01.03.2019" }),
    errors: [
      { line: 9, column: "data_zatrudnienia", code: "INVALID_DATE" },
      { line: 10, column: "data_zatrudnienia", code: "INVALID_DATE" },
    ],
  },
  { file: "polish-characters", rows: POLISH, errors: [], xlsx: true },
  {
    // Imported on top of valid: the active person AM0090012 is missing -> deactivated, documents kept (ACC-04).
    file: "deactivation",
    rows: VALID.filter((r) => r.amei !== ameiOf(12)),
    errors: [],
    deactivated: [ameiOf(12)],
  },
];

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: Row[]): string {
  const lines = [COLUMNS.join(SEPARATOR), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(SEPARATOR))];
  return BOM + lines.join(EOL) + EOL;
}

async function writeXlsx(path: string, rows: Row[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pracownicy");
  sheet.addRow([...COLUMNS]);
  for (const r of rows) sheet.addRow(COLUMNS.map((c) => r[c]));
  sheet.getRow(1).font = { bold: true };
  await workbook.xlsx.writeFile(path);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of FIXTURES) {
    writeFileSync(join(OUT_DIR, `${f.file}.csv`), toCsv(f.rows), "utf8");
    if (f.xlsx) await writeXlsx(join(OUT_DIR, `${f.file}.xlsx`), f.rows);
  }
  const expectations = {
    _comment:
      "Generated by scripts/generate-import-fixtures.ts. CSV: UTF-8 with BOM, ';' separator, CRLF. " +
      "`line` is the spreadsheet line (header = 1). deactivation is meant to be imported on top of valid.",
    columns: COLUMNS,
    fixtures: FIXTURES.map((f) => ({
      file: `${f.file}.csv`,
      xlsx: f.xlsx ? `${f.file}.xlsx` : null,
      rows: f.rows.length,
      errors: f.errors,
      deactivated: f.deactivated ?? [],
    })),
  };
  writeFileSync(join(OUT_DIR, "expectations.json"), JSON.stringify(expectations, null, 2) + "\n", "utf8");
  console.info(`Wrote ${FIXTURES.length} CSV fixtures and their xlsx variants to ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error("Fixture generation failed:", error);
  process.exit(1);
});
