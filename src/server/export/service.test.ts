import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/server/permissions";
import { parseExportRequest, type ExportRequest } from "./request";
import { ExportError } from "./scope";
import { AUDIT_ACTION, AUDIT_ENTITY, exportData, previewExport, type ExportDb } from "./service";

// HR-08 + HR-12 against an in-memory stand-in for Prisma. The employee query is evaluated for real
// (unknown filter shapes fail loudly); the data queries are ADVERSARIAL: they return every row of
// every person whatever the filter, so the tests prove the export itself keeps to the chosen scope.

const HR = { id: 1, isHrAdmin: true };
const CYCLE = { id: 7, year: 2027 };
const NOW = new Date("2027-01-31T08:05:00Z");

const person = (id: number, amei: string, firstName: string, lastName: string, department: string) => ({
  id, amei, email: `${amei.toLowerCase()}@example.com`, firstName, lastName, department, position: "Specjalista",
  location: "Oddział A", hireDate: new Date("2019-03-01T00:00:00Z"), isWhiteCollar: true, isActive: true,
  isHrAdmin: false, manager: null, validatorOverride: null,
});

const PEOPLE = [
  person(11, "AM0001", "Łucja", "Żółkiewska", "Sprzedaż"),
  person(12, "AM0002", "Bartosz", "Nowak", "Sprzedaż"),
  person(13, "AM0003", "Ścibor", "Gęślą", "Produkcja"),
  person(14, "AM0004", "Dorota", "Kowalska", "Produkcja"),
];

const goal = (employeeId: number, title: string) => ({
  title, description: "Opis zadania", measures: null, targetValue: "100", dueDate: new Date("2027-06-30T00:00:00Z"),
  progress: 10, weight: 50, state: "W_PLANIE", changedByManager: false, createdAt: NOW, updatedAt: NOW,
  targetType: { code: "PROCENT" }, document: { employeeId },
});

const PERFORMANCE_GOALS = [
  goal(11, "Zwiększyć sprzedaż o 5%"),
  goal(11, "=HYPERLINK(\"http://evil\")"),
  goal(12, "Cel Bartosza"),
  goal(13, "Wdrożyć nową linię"),
  goal(14, "Cel Doroty"),
];

type Where = Record<string, unknown>;

function matches(row: (typeof PEOPLE)[number], where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Where[]).every((part) => matches(row, part));
    if (key === "amei" && typeof value === "string") return row.amei === value;
    if (key === "amei" && Array.isArray((value as { in?: unknown }).in)) return (value as { in: string[] }).in.includes(row.amei);
    if (key === "department") return row.department === value;
    throw new Error(`fake db: unsupported employee filter ${JSON.stringify({ [key]: value })}`);
  });
}

function fakeDb({ liveHr = true, auditFails = false } = {}) {
  const db = {
    employee: {
      findFirst: vi.fn().mockResolvedValue(liveHr ? { id: HR.id } : null),
      // Mirrors the real orderBy (last name first).
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        PEOPLE.filter((p) => matches(p, where)).sort((a, b) => a.lastName.localeCompare(b.lastName, "pl")),
      ),
    },
    cycle: { findUnique: vi.fn(async ({ where }: { where: { year: number } }) => (where.year === CYCLE.year ? CYCLE : null)) },
    gedpDocument: {
      findMany: vi.fn(async () =>
        PEOPLE.map((p) => ({
          employeeId: p.id, status: "SZKIC", createdAt: NOW, updatedAt: NOW, validator: null,
          groupGoalAcks: p.id === 11 ? [{ templateId: 1, acknowledgedAt: NOW, hsCommitment: null }] : [],
        })),
      ),
    },
    groupGoalTemplate: {
      findMany: vi.fn().mockResolvedValue([
        { id: 1, type: "PRZYWODZTWO", contentPl: "Przywództwo" },
        { id: 2, type: "BHP", contentPl: "Bezpieczeństwo" },
      ]),
    },
    performanceGoal: { findMany: vi.fn().mockResolvedValue(PERFORMANCE_GOALS) },
    developmentGoal: { findMany: vi.fn().mockResolvedValue([]) },
    documentStatusHistory: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn(async () => (auditFails ? Promise.reject(new Error("audit down")) : {})) },
  };
  return { db, client: db as unknown as ExportDb };
}

function request(raw: Record<string, unknown>): ExportRequest {
  const parsed = parseExportRequest({ year: 2027, format: "xlsx", ...raw });
  if (!parsed.ok) throw new Error(`invalid test request: ${parsed.code}`);
  return parsed.request;
}

const TWO_PEOPLE_ONE_TYPE = { dataTypes: ["performanceGoals"], people: { kind: "selected", ameis: ["am0001", "AM0003"] } };

async function readXlsx(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return workbook;
}

function allText(workbook: ExcelJS.Workbook): string {
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    parts.push(sheet.name);
    sheet.eachRow((row) => row.eachCell((cell) => parts.push(String(cell.value))));
  });
  return parts.join("\n");
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error);
}

describe("[HR-12] export scope: 2 selected people + 1 data type", () => {
  it("the file holds exactly one sheet with only those two people's rows, nothing else", async () => {
    const { client } = fakeDb();
    const file = await exportData(client, HR, request(TWO_PEOPLE_ONE_TYPE), NOW);
    const workbook = await readXlsx(file.bytes);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Cele wydajnościowe"]);
    const sheet = workbook.worksheets[0]!;
    const ameiColumn = (sheet.getRow(1).values as unknown[]).indexOf("amei");
    const ameis = sheet.getRows(2, sheet.rowCount - 1)!.map((row) => row.getCell(ameiColumn).value);
    expect(ameis).toEqual(["AM0003", "AM0001", "AM0001"]);

    const text = allText(workbook);
    for (const outsider of ["AM0002", "AM0004", "Bartosz", "Dorota", "Cel Bartosza", "Cel Doroty"]) {
      expect(text).not.toContain(outsider);
    }
    expect(file.preview).toEqual({ people: 2, records: { performanceGoals: 3 } });
  });

  it("stores a formula-looking goal title as text in the .xlsx, never as a formula", async () => {
    const { client } = fakeDb();
    const file = await exportData(client, HR, request(TWO_PEOPLE_ONE_TYPE), NOW);
    const sheet = (await readXlsx(file.bytes)).worksheets[0]!;
    const titleColumn = (sheet.getRow(1).values as unknown[]).indexOf("tytul");
    const cells = sheet.getRows(2, sheet.rowCount - 1)!.map((row) => row.getCell(titleColumn));
    const hyperlink = cells.find((cell) => String(cell.value).startsWith("=HYPERLINK"));
    expect(hyperlink?.type).toBe(ExcelJS.ValueType.String);
    expect(cells.every((cell) => cell.formula === undefined)).toBe(true);
  });

  it("queries only the chosen data type, filtered by cycle and the chosen people", async () => {
    const { db, client } = fakeDb();
    await exportData(client, HR, request(TWO_PEOPLE_ONE_TYPE), NOW);
    expect(db.gedpDocument.findMany).not.toHaveBeenCalled();
    expect(db.developmentGoal.findMany).not.toHaveBeenCalled();
    expect(db.documentStatusHistory.findMany).not.toHaveBeenCalled();
    const [{ where }] = db.performanceGoal.findMany.mock.calls[0] as [{ where: { document: Where } }];
    expect(where.document).toMatchObject({ cycleId: CYCLE.id });
    expect(JSON.stringify(where.document.employee)).toContain('"in":["AM0001","AM0003"]');
  });

  it("preview counts are the rows the file holds", async () => {
    const { client } = fakeDb();
    const all = request({ dataTypes: ["employees", "documents", "groupGoals", "performanceGoals"], people: { kind: "all" } });
    const preview = await previewExport(client, HR, all);
    const file = await exportData(client, HR, all, NOW);
    const workbook = await readXlsx(file.bytes);
    expect(preview).toEqual({ people: 4, records: { employees: 4, documents: 4, groupGoals: 8, performanceGoals: 5 } });
    expect(workbook.worksheets.map((sheet) => sheet.rowCount - 1)).toEqual([4, 4, 8, 5]);
  });

  it("a department scope takes that department only; Group goals list every template, acknowledged or not", async () => {
    const { client } = fakeDb();
    const file = await exportData(client, HR, request({ dataTypes: ["groupGoals"], people: { kind: "department", department: "Sprzedaż" } }), NOW);
    const sheet = (await readXlsx(file.bytes)).worksheets[0]!;
    const rows = sheet.getRows(2, sheet.rowCount - 1)!.map((row) => (row.values as unknown[]).slice(2, 10));
    expect(rows.map((row) => [row[0], row[4], row[6]])).toEqual([
      ["AM0002", "PRZYWODZTWO", "NIE"],
      ["AM0002", "BHP", "NIE"],
      ["AM0001", "PRZYWODZTWO", "TAK"],
      ["AM0001", "BHP", "NIE"],
    ]);
  });
});

describe("[HR-08] audit and access", () => {
  it("audits who exported what, for which people, with the row counts", async () => {
    const { db, client } = fakeDb();
    const file = await exportData(client, HR, request(TWO_PEOPLE_ONE_TYPE), NOW);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create.mock.calls[0]).toEqual([
      {
        data: expect.objectContaining({
          actorId: HR.id,
          entity: AUDIT_ENTITY,
          entityId: "2027",
          action: AUDIT_ACTION,
          after: {
            fileName: file.fileName,
            format: "xlsx",
            year: 2027,
            dataTypes: ["performanceGoals"],
            people: { kind: "selected", ameis: ["AM0001", "AM0003"] },
            peopleCount: 2,
            exportedAmeis: ["AM0003", "AM0001"],
            records: { performanceGoals: 3 },
          },
        }),
      },
    ]);
    expect(file.fileName).toBe("gedp-eksport-2027-20270131-0805.xlsx");
  });

  it("hands out no file when the audit cannot be written", async () => {
    const { client } = fakeDb({ auditFails: true });
    await expect(exportData(client, HR, request(TWO_PEOPLE_ONE_TYPE), NOW)).rejects.toThrow("audit down");
  });

  it("the preview writes nothing", async () => {
    const { db, client } = fakeDb();
    await previewExport(client, HR, request(TWO_PEOPLE_ONE_TYPE));
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses non-HR and a demoted HR session before reading any data", async () => {
    for (const [viewer, liveHr] of [[{ id: 2, isHrAdmin: false }, true], [HR, false]] as const) {
      const { db, client } = fakeDb({ liveHr });
      expect(await rejection(exportData(client, viewer, request(TWO_PEOPLE_ONE_TYPE)))).toBeInstanceOf(ForbiddenError);
      expect(db.employee.findMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    }
  });
});

describe("[HR-12] scope errors", () => {
  it("names AMEIs that match nobody instead of exporting fewer people", async () => {
    const { db, client } = fakeDb();
    const error = await rejection(
      exportData(client, HR, request({ dataTypes: ["employees"], people: { kind: "selected", ameis: ["AM0001", "AM9999"] } })),
    );
    expect(error).toBeInstanceOf(ExportError);
    expect(error).toMatchObject({ code: "UNKNOWN_PEOPLE", ameis: ["AM9999"] });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses a Group goal sheet that would exceed the row limit before building it", async () => {
    const { db, client } = fakeDb();
    // 4 documents x 25 001 templates > MAX_EXPORT_ROWS.
    db.groupGoalTemplate.findMany.mockResolvedValue(
      Array.from({ length: 25_001 }, (_, index) => ({ id: index + 1, type: "BHP", contentPl: "x" })),
    );
    const error = await rejection(previewExport(client, HR, request({ dataTypes: ["groupGoals"], people: { kind: "all" } })));
    expect(error).toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses a year without a cycle and an empty scope", async () => {
    const { client } = fakeDb();
    const noCycle = await rejection(exportData(client, HR, { ...request({ dataTypes: ["employees"], people: { kind: "all" } }), year: 2030 }));
    expect(noCycle).toMatchObject({ code: "NO_CYCLE" });
    const nobody = request({ dataTypes: ["employees"], people: { kind: "department", department: "Brak" } });
    expect(await previewExport(client, HR, nobody)).toEqual({ people: 0, records: { employees: 0 } });
    expect(await rejection(exportData(client, HR, nobody))).toMatchObject({ code: "NO_PEOPLE" });
  });
});
