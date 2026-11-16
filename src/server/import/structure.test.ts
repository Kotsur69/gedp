import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planStructure, type ExistingEmployee, type StructurePlan, type StructureRecord } from "./structure";
import { readTable, type RawTable } from "./table";

// Pure planning tests: every rule of HR-01..03 against the synthetic fixtures, no database.
// "Existing" employees are a snapshot built from a previous plan, as the DB loader would return them.

const DIR = join(process.cwd(), "tests", "fixtures", "import");

interface ExpectedError {
  line: number;
  column: string;
  code: string;
  people?: string[];
}
interface Expectation {
  file: string;
  xlsx: string | null;
  rows: number;
  errors: ExpectedError[];
  deactivated: string[];
}
const expectations = JSON.parse(readFileSync(join(DIR, "expectations.json"), "utf8")) as { fixtures: Expectation[] };

/** Planning without an importing actor (the SELF_LOCKOUT tests pass one explicitly). */
const planFor = (table: RawTable, existing: readonly ExistingEmployee[]): StructurePlan =>
  planStructure(table, existing, null);

const fixtureTable = (file: string): Promise<RawTable> =>
  readTable({ fileName: file, bytes: readFileSync(join(DIR, file)) });

const csvTable = (text: string): Promise<RawTable> =>
  readTable({ fileName: "inline.csv", bytes: Buffer.from(text, "utf8") });

/** valid.csv with its text transformed, e.g. one value replaced. */
const validVariant = (transform: (csv: string) => string): Promise<RawTable> =>
  csvTable(transform(readFileSync(join(DIR, "valid.csv"), "utf8")));

/** Snapshot of the DB after importing `plan` (created + changed records), ids in plan order. */
function snapshotOf(plan: StructurePlan): ExistingEmployee[] {
  return [...plan.created, ...plan.changed].map((c, i) => ({ id: i + 1, record: c.after }));
}

async function validSnapshot(): Promise<ExistingEmployee[]> {
  return snapshotOf(planFor(await fixtureTable("valid.csv"), []));
}

const comparable = (plan: StructurePlan) =>
  plan.errors
    .filter((e) => e.code !== "MANAGER_REJECTED")
    .map(({ line, column, code, people }) => (people ? { line, column, code, people } : { line, column, code }));

const codesByLine = (plan: StructurePlan) => plan.errors.map((e) => [e.line, e.code]);

describe("structure import - fixture error cases (HR-03)", () => {
  const cases = expectations.fixtures.flatMap((f) => [
    { ...f, source: f.file },
    ...(f.xlsx ? [{ ...f, source: f.xlsx }] : []),
  ]);

  it.each(cases)("$source reports exactly the expected rows and reasons", async ({ source, errors, deactivated, rows }) => {
    const existing = deactivated.length > 0 ? await validSnapshot() : [];
    const plan = planFor(await fixtureTable(source), existing);

    expect(plan.fileErrors).toEqual([]);
    expect(plan.totalRows).toBe(rows);
    expect(comparable(plan)).toEqual(errors);
    for (const error of plan.errors) {
      expect(error.line).toBeGreaterThan(1);
      expect(error.message.length).toBeGreaterThan(10);
    }
    expect(plan.deactivated.map((d) => d.key)).toEqual(deactivated);
  });

  it("names both people of a cycle in the message", async () => {
    const plan = planFor(await fixtureTable("hierarchy-cycle.csv"), []);
    const cycle = plan.errors.find((e) => e.code === "HIERARCHY_CYCLE");
    expect(cycle?.message).toBe("Hierarchy cycle: AM0090009 -> AM0090010 -> AM0090009");
    // The other member now reports to a rejected new person, so it is rejected as well.
    expect(codesByLine(plan)).toEqual([
      [10, "HIERARCHY_CYCLE"],
      [11, "MANAGER_REJECTED"],
    ]);
  });

  it("rejects the reports of a rejected new manager instead of importing them without one", async () => {
    // Line 6 (AM0090005) has no e-mail; AM0090009 and AM0090010 (lines 10, 11) report to her.
    const plan = planFor(await fixtureTable("missing-email.csv"), []);
    expect(codesByLine(plan)).toEqual([
      [6, "REQUIRED"],
      [10, "MANAGER_REJECTED"],
      [11, "MANAGER_REJECTED"],
    ]);
    expect(plan.created.map((c) => c.key)).not.toContain("AM0090009");
    expect(plan.created).toHaveLength(9);
  });

  it("keeps the report when the rejected manager already exists in the database", async () => {
    const existing = await validSnapshot();
    const plan = planFor(await fixtureTable("missing-email.csv"), existing);
    expect(codesByLine(plan)).toEqual([[6, "REQUIRED"]]);
    // Present in the file (with an error) means NOT deactivated.
    expect(plan.deactivated).toEqual([]);
  });

  it("imports Polish characters intact from CSV and XLSX", async () => {
    for (const file of ["polish-characters.csv", "polish-characters.xlsx"]) {
      const plan = planFor(await fixtureTable(file), []);
      expect(plan.created[0].after).toMatchObject({ firstName: "Łucja", lastName: "Śliwińska-Żółć", department: "Sprzedaż" });
      expect(plan.created[6].after.location).toBe("Dąbrowa Górnicza");
    }
  });
});

describe("structure import - diff (HR-02)", () => {
  it("plans every row of valid.csv as new into an empty database, with typed values", async () => {
    const plan = planFor(await fixtureTable("valid.csv"), []);
    expect(plan.errors).toEqual([]);
    expect(plan.created).toHaveLength(12);
    expect(plan.created[0]).toMatchObject({ line: 2, key: "AM0090001", before: null });
    const expected: StructureRecord = {
      amei: "AM0090008",
      email: "marcin.krol.8@example.com",
      firstName: "Marcin",
      lastName: "Krol",
      managerAmei: "AM0090004",
      department: "Produkcja",
      position: "Operator",
      location: "Oddział A",
      isWhiteCollar: false,
      isActive: true,
      hireDate: "2018-09-01",
      isHrAdmin: false,
    };
    expect(plan.created[7].after).toEqual(expected);
    expect(plan.created[10].after.hireDate).toBeNull(); // empty optional date
  });

  it("re-importing the same file changes nothing", async () => {
    const plan = planFor(await fixtureTable("valid.csv"), await validSnapshot());
    expect(plan).toMatchObject({ created: [], changed: [], deactivated: [], unchangedCount: 12, errors: [] });
  });

  it("reports field-level changes, including a manager move", async () => {
    const table = await validVariant((csv) =>
      csv.replace(
        "AM0090012;grzegorz.lewandowski.12@example.com;Grzegorz;Lewandowski;AM0090004;Produkcja",
        "AM0090012;grzegorz.lewandowski.12@example.com;Grzegorz;Lewandowski;AM0090005;Logistyka",
      ),
    );
    const plan = planFor(table, await validSnapshot());
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]).toMatchObject({ line: 13, key: "AM0090012" });
    expect(plan.changed[0].fields).toEqual([
      { field: "managerAmei", before: "AM0090004", after: "AM0090005" },
      { field: "department", before: "Produkcja", after: "Logistyka" },
    ]);
  });

  it("deactivates only ACTIVE people missing from the file", async () => {
    const existing = (await validSnapshot()).map((e) =>
      e.record.amei === "AM0090011" ? { ...e, record: { ...e.record, isActive: false } } : e,
    );
    const table = await validVariant((csv) =>
      csv
        .split("\r\n")
        .filter((l) => !/^AM009001[12];/.test(l))
        .join("\r\n"),
    );
    const plan = planFor(table, existing);
    expect(plan.deactivated.map((d) => d.key)).toEqual(["AM0090012"]);
    expect(plan.deactivated[0]).toMatchObject({ line: null, fields: [{ field: "isActive", before: true, after: false }] });
  });

  it("leaves fields of absent optional columns unchanged", async () => {
    const existing = (await validSnapshot()).map((e) => ({ ...e, record: { ...e.record, isHrAdmin: true } }));
    const header = "amei;email;imie;nazwisko;amei_przelozonego;white_collar;aktywny\r\n";
    const plan = planFor(await csvTable(`${header}AM0090001;anna.nowak.1@example.com;Anna;Nowak;;TAK;TAK\r\n`), existing);
    expect(plan.changed).toEqual([]);
    expect(plan.unchangedCount).toBe(1);
    const fresh = planFor(await csvTable(`${header}AM0000001;new.person@example.com;Jan;Nowy;;TAK;TAK\r\n`), []);
    expect(fresh.created[0].after).toMatchObject({ department: null, hireDate: null, isHrAdmin: false });
  });
});

describe("structure import - validation against the database", () => {
  const header = "amei;email;imie;nazwisko;amei_przelozonego;white_collar;aktywny\r\n";
  const person = (amei: string, managerAmei: string | null): ExistingEmployee => ({
    id: Number(amei.replace(/\D/g, "")),
    record: {
      amei,
      email: `${amei.toLowerCase()}@example.com`,
      firstName: "Test",
      lastName: amei,
      managerAmei,
      department: null,
      position: null,
      location: null,
      isWhiteCollar: true,
      isActive: true,
      hireDate: null,
      isHrAdmin: false,
    },
  });

  it("accepts a manager that exists only in the database", async () => {
    const plan = planFor(await csvTable(`${header}TST002;tst002@example.com;A;B;TST001;TAK;TAK\r\n`), [person("TST001", null)]);
    expect(plan.errors).toEqual([]);
    expect(plan.created[0].after.managerAmei).toBe("TST001");
  });

  it("rejects an e-mail that belongs to another person in the database", async () => {
    const plan = planFor(await csvTable(`${header}TST002;tst001@example.com;A;B;;TAK;TAK\r\n`), [person("TST001", null)]);
    expect(plan.errors).toEqual([
      {
        line: 2,
        column: "email",
        code: "DUPLICATE_EMAIL",
        message: "E-mail tst001@example.com belongs to TST001 in the database",
      },
    ]);
  });

  it("allows two people to swap e-mails in one file", async () => {
    const existing = [person("TST001", null), person("TST002", null)];
    const csv = `${header}TST001;tst002@example.com;Test;TST001;;TAK;TAK\r\nTST002;tst001@example.com;Test;TST002;;TAK;TAK\r\n`;
    const plan = planFor(await csvTable(csv), existing);
    expect(plan.errors).toEqual([]);
    expect(plan.changed.map((c) => c.fields)).toEqual([
      [{ field: "email", before: "tst001@example.com", after: "tst002@example.com" }],
      [{ field: "email", before: "tst002@example.com", after: "tst001@example.com" }],
    ]);
  });

  it("finds a cycle through a person who is only in the database", async () => {
    // DB: TST001 reports to TST002. File: TST002 now reports to TST001 (TST001 not in the file).
    const existing = [person("TST002", null), person("TST001", "TST002")];
    const plan = planFor(await csvTable(`${header}TST002;tst002@example.com;A;B;TST001;TAK;TAK\r\n`), existing);
    expect(plan.errors).toEqual([expect.objectContaining({ line: 2, code: "HIERARCHY_CYCLE", people: ["TST002", "TST001"] })]);
  });

  it("finds a cycle created by a rejected row keeping its database manager", async () => {
    // DB: TST001 reports to TST002. File: TST002 -> TST001, and TST001's row is invalid (keeps DB manager).
    const existing = [person("TST002", null), person("TST001", "TST002")];
    const csv = `${header}TST001;tst001@example.com;A;B;;maybe;TAK\r\nTST002;tst002@example.com;A;B;TST001;TAK;TAK\r\n`;
    const plan = planFor(await csvTable(csv), existing);
    expect(codesByLine(plan)).toEqual([
      [2, "INVALID_BOOLEAN"],
      [3, "HIERARCHY_CYCLE"],
    ]);
  });

  it("treats a self-managed person as a cycle of one", async () => {
    const plan = planFor(await csvTable(`${header}TST001;tst001@example.com;A;B;TST001;TAK;TAK\r\n`), []);
    expect(plan.errors).toEqual([
      expect.objectContaining({ line: 2, code: "HIERARCHY_CYCLE", people: ["TST001"], message: "Hierarchy cycle: TST001 -> TST001" }),
    ]);
  });
});

describe("structure import - field and file rules", () => {
  const header = "amei;email;imie;nazwisko;amei_przelozonego;white_collar;aktywny;data_zatrudnienia;dzial\r\n";
  const row = (cells: string) => csvTable(`${header}${cells}\r\n`);

  it.each([
    ["tst001;TST1@Example.com;A;B;;tak;nie;;", null],
    ["TST001;x@example.com;A;B;;TAK;TAK;2020-02-29;", null],
    ["TST001;x@example.com;A;B;;TAK;TAK;2019-02-29;", "INVALID_DATE"],
    ["TST001;x@example.com;A;B;;TAK;TAK;2019-03-01T00:00;", "INVALID_DATE"],
    ["TST001;not-an-email;A;B;;TAK;TAK;;", "INVALID_EMAIL"],
    ["T-1;x@example.com;A;B;;TAK;TAK;;", "INVALID_AMEI"],
    ["TST001;x@example.com;;B;;TAK;TAK;;", "REQUIRED"],
    ["TST001;x@example.com;A;B;;;TAK;;", "REQUIRED"],
    [`TST001;x@example.com;A;B;;TAK;TAK;;${"x".repeat(201)}`, "TOO_LONG"],
    [`TST001;${"x".repeat(250)}@example.com;A;B;;TAK;TAK;;`, "TOO_LONG"],
  ])("%s -> %s", async (cells, code) => {
    const plan = planFor(await row(cells), []);
    expect(plan.errors.map((e) => e.code)).toEqual(code ? [code] : []);
  });

  it("normalises AMEI to upper case and e-mail to lower case", async () => {
    const plan = planFor(await row("tst001;TST1@Example.com;A;B;;tak;nie;;"), []);
    expect(plan.created[0].after).toMatchObject({ amei: "TST001", email: "tst1@example.com", isActive: false });
  });

  it("reports every bad field of a row, each with its column", async () => {
    const plan = planFor(await row("TST001;;A;B;;TAKK;yes;01.01.2020;"), []);
    expect(plan.errors.map((e) => [e.line, e.column, e.code])).toEqual([
      [2, "email", "REQUIRED"],
      [2, "white_collar", "INVALID_BOOLEAN"],
      [2, "aktywny", "INVALID_BOOLEAN"],
      [2, "data_zatrudnienia", "INVALID_DATE"],
    ]);
  });

  it("blocks the file when a required column is missing or duplicated", async () => {
    const plan = planFor(
      await csvTable("amei;email;imie;imie;white_collar;aktywny\r\nTST001;x@example.com;A;A;TAK;TAK\r\n"),
      [],
    );
    expect(plan.fileErrors.map((e) => [e.column, e.code])).toEqual([
      ["imie", "DUPLICATE_COLUMN"],
      ["nazwisko", "MISSING_COLUMN"],
      ["amei_przelozonego", "MISSING_COLUMN"],
    ]);
    expect(plan.created).toEqual([]);
  });

  it("blocks a file without rows instead of deactivating everybody", async () => {
    const plan = planFor(await csvTable(header), await validSnapshot());
    expect(plan.fileErrors.map((e) => e.code)).toEqual(["NO_ROWS"]);
    expect(plan.deactivated).toEqual([]);
  });

  it("matches headers case-insensitively and accepts comma-separated CSV", async () => {
    const plan = planFor(
      await csvTable("AMEI,Email,Imie,Nazwisko,Amei_Przelozonego,White_Collar,Aktywny\r\nTST001,x@example.com,A,B,,TAK,TAK\r\n"),
      [],
    );
    expect(plan.fileErrors).toEqual([]);
    expect(plan.created).toHaveLength(1);
  });
});

describe("structure import - review hardening", () => {
  const header = "amei;email;imie;nazwisko;amei_przelozonego;white_collar;aktywny;hr_admin\r\n";
  const line = (n: number, manager: string, extra = "TAK;TAK;NIE") =>
    `TST${String(n).padStart(6, "0")};p${n}@example.com;A;B;${manager};${extra}`;

  it("[SELF_LOCKOUT] blocks an import that deactivates or demotes the importing HR user", async () => {
    const existing = await validSnapshot(); // AM0090003 (id 3) is HR
    const demoted = await validVariant((csv) => csv.replace("2013-04-01;TAK", "2013-04-01;NIE"));
    expect(planStructure(demoted, existing, 3).fileErrors).toEqual([
      expect.objectContaining({ code: "SELF_LOCKOUT", people: ["AM0090003"] }),
    ]);
    const missing = await validVariant((csv) =>
      csv
        .split("\r\n")
        .filter((l) => !l.startsWith("AM0090003;"))
        .join("\r\n"),
    );
    expect(planStructure(missing, existing, 3).fileErrors.map((e) => e.code)).toEqual(["SELF_LOCKOUT"]);
    // Somebody else losing HR rights is a normal change.
    expect(planStructure(demoted, existing, 6).fileErrors).toEqual([]);
  });

  it("rejects line breaks and invisible characters in text fields", async () => {
    const plan = planFor(await csvTable(`${header}TST001;x@example.com;"Jan\nNowak";B;;TAK;TAK;NIE\r\nTST002;y@example.com;A‮b;B;;TAK;TAK;NIE\r\n`), []);
    expect(plan.errors.map((e) => [e.line, e.column, e.code])).toEqual([
      [2, "imie", "INVALID_TEXT"],
      [3, "imie", "INVALID_TEXT"],
    ]);
  });

  it("cuts long cell values short in messages", async () => {
    const plan = planFor(await csvTable(`${header}TST001;x@example.com;A;B;;${"Y".repeat(5000)};TAK;NIE\r\n`), []);
    expect(plan.errors[0].message).toBe(`"${"Y".repeat(50)}..." must be TAK or NIE`);
  });

  it("reports every independent cycle of a file in one plan", async () => {
    const rows = [line(1, "TST000002"), line(2, "TST000001"), line(3, "TST000004"), line(4, "TST000003")];
    const plan = planFor(await csvTable(`${header}${rows.join("\r\n")}\r\n`), []);
    expect(codesByLine(plan)).toEqual([
      [2, "HIERARCHY_CYCLE"],
      [3, "MANAGER_REJECTED"],
      [4, "HIERARCHY_CYCLE"],
      [5, "MANAGER_REJECTED"],
    ]);
  });

  it("stays fast on adversarial files (many cycles, a deep chain listed bottom-up)", async () => {
    const PAIRS = 10_000;
    const cycles = Array.from({ length: PAIRS }, (_, i) => [line(2 * i + 1, `TST${String(2 * i + 2).padStart(6, "0")}`), line(2 * i + 2, `TST${String(2 * i + 1).padStart(6, "0")}`)]).flat();
    // Chain TST1 <- TST2 <- ... with an invalid top, listed from the bottom up.
    const DEPTH = 20_000;
    const chain = Array.from({ length: DEPTH }, (_, i) => DEPTH - i).map((n) =>
      n === 1 ? line(1, "", "maybe;TAK;NIE") : line(n, `TST${String(n - 1).padStart(6, "0")}`),
    );
    const started = performance.now();
    const cyclePlan = planFor(await csvTable(`${header}${cycles.join("\r\n")}\r\n`), []);
    const chainPlan = planFor(await csvTable(`${header}${chain.join("\r\n")}\r\n`), []);
    expect(cyclePlan.errors.filter((e) => e.code === "HIERARCHY_CYCLE")).toHaveLength(PAIRS);
    expect(chainPlan.created).toEqual([]);
    expect(chainPlan.errors).toHaveLength(DEPTH);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
