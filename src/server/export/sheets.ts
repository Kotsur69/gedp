import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ExportDataType } from "@/domain/data-export";
import { TIME_ZONE } from "@/i18n/format";
import { BOOLEAN_FALSE, BOOLEAN_TRUE, STRUCTURE_COLUMNS } from "@/server/import/structure-columns";
import {
  ExportError,
  MAX_EXPORT_ROWS,
  MAX_EXPORT_TOTAL_ROWS,
  type ExportEmployee,
  type ResolvedScope,
} from "./scope";

// One table per exported data type (HR-08). Headers are stable snake_case keys in the style of the
// import format, and values are codes (statuses, TAK/NIE, ISO dates), so the file is fit for Excel,
// Power BI and - for the employee sheet, which uses the HR-01 import headers - re-import.
//
// Scope guarantee (HR-12): every row is attached to its person through `scope.people`. A row whose
// employee is not in the resolved set is dropped, so the file can only ever hold the chosen people.

export type Cell = string | number | null;

export interface ExportSheet {
  dataType: ExportDataType;
  /** Worksheet name (Excel: at most 31 characters). */
  name: string;
  headers: readonly string[];
  rows: Cell[][];
}

export type SheetDb = Pick<
  PrismaClient,
  "gedpDocument" | "groupGoalTemplate" | "performanceGoal" | "developmentGoal" | "documentStatusHistory"
>;

export const SHEET_NAMES: Readonly<Record<ExportDataType, string>> = {
  employees: "Pracownicy",
  documents: "Dokumenty",
  groupGoals: "Cele Grupy",
  performanceGoals: "Cele wydajnościowe",
  developmentGoals: "Cele rozwojowe",
  statusHistory: "Historia statusów",
};

const PERSON_HEADERS = ["rok", "amei", "imie", "nazwisko", "dzial"] as const;
const TIMESTAMPS = ["utworzono", "ostatnia_zmiana"] as const;

const C = STRUCTURE_COLUMNS;
const HEADERS: Readonly<Record<ExportDataType, readonly string[]>> = {
  employees: [
    C.amei.header, C.email.header, C.firstName.header, C.lastName.header, C.managerAmei.header, C.department.header,
    C.position.header, C.location.header, C.isWhiteCollar.header, C.isActive.header, C.hireDate.header,
    C.isHrAdmin.header, "amei_walidatora_zastepczego",
  ],
  documents: [...PERSON_HEADERS, "status", "amei_walidatora", ...TIMESTAMPS],
  groupGoals: [...PERSON_HEADERS, "typ_celu", "tresc", "potwierdzono", "data_potwierdzenia", "zobowiazanie_bhp"],
  performanceGoals: [
    ...PERSON_HEADERS, "tytul", "opis", "mierniki", "typ_wartosci", "wartosc_docelowa", "termin", "postep_proc",
    "waga_proc", "stan", "zmieniony_przez_n1", ...TIMESTAMPS,
  ],
  developmentGoals: [
    ...PERSON_HEADERS, "obszar_rozwoju", "kompetencja", "dzialanie", "opis", "data_rozpoczecia", "data_zakonczenia",
    "postep_proc", "stan", "zmieniony_przez_n1", ...TIMESTAMPS,
  ],
  statusHistory: [...PERSON_HEADERS, "status_poprzedni", "status_nowy", "autor_amei", "autor", "komentarz", "data_zmiany"],
};

export const exportHeaders = (dataType: ExportDataType): readonly string[] => HEADERS[dataType];

const yesNo = (value: boolean): string => (value ? BOOLEAN_TRUE : BOOLEAN_FALSE);

/** Calendar-day columns (@db.Date) are stored as UTC midnight, so the UTC day is the day. */
const isoDate = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

// sv-SE formats as "2027-01-31 09:05", in company time like every date the app shows.
const timestampFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatTimestamp = (value: Date): string => timestampFormat.format(value);

function boundRows<T>(rows: T[], dataType: ExportDataType): T[] {
  if (rows.length > MAX_EXPORT_ROWS) throw new ExportError("TOO_LARGE", `Too many rows for ${dataType}`);
  return rows;
}

/** Joins rows to their person (dropping anyone outside the scope) and orders them by person. */
function byPerson<T>(scope: ResolvedScope, rows: readonly T[], employeeId: (row: T) => number) {
  const order = new Map(scope.people.map((person, index) => [person.id, { person, index }]));
  return rows
    .flatMap((row) => {
      const entry = order.get(employeeId(row));
      return entry ? [{ row, ...entry }] : [];
    })
    .sort((a, b) => a.index - b.index);
}

const personCells = (scope: ResolvedScope, person: ExportEmployee): Cell[] => [
  scope.cycle.year,
  person.amei,
  person.firstName,
  person.lastName,
  person.department,
];

function employeeRows(scope: ResolvedScope): Cell[][] {
  return scope.people.map((p) => [
    p.amei, p.email, p.firstName, p.lastName, p.manager?.amei ?? null, p.department, p.position, p.location,
    yesNo(p.isWhiteCollar), yesNo(p.isActive), isoDate(p.hireDate), yesNo(p.isHrAdmin), p.validatorOverride?.amei ?? null,
  ]);
}

async function documentRows(db: SheetDb, scope: ResolvedScope): Promise<Cell[][]> {
  const rows = await db.gedpDocument.findMany({
    where: scope.documentWhere,
    select: { employeeId: true, status: true, createdAt: true, updatedAt: true, validator: { select: { amei: true } } },
    orderBy: { id: "asc" },
    take: MAX_EXPORT_ROWS + 1,
  });
  return byPerson(scope, boundRows(rows, "documents"), (row) => row.employeeId).map(({ row, person }) => [
    ...personCells(scope, person),
    row.status,
    row.validator?.amei ?? null,
    formatTimestamp(row.createdAt),
    formatTimestamp(row.updatedAt),
  ]);
}

/** One row per document and Group goal of the cycle, acknowledged or not (RPT-02 needs the gaps). */
async function groupGoalRows(db: SheetDb, scope: ResolvedScope): Promise<Cell[][]> {
  const [templates, documents] = await Promise.all([
    db.groupGoalTemplate.findMany({
      where: { cycleId: scope.cycle.id },
      select: { id: true, type: true, contentPl: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.gedpDocument.findMany({
      where: scope.documentWhere,
      select: {
        employeeId: true,
        groupGoalAcks: { select: { templateId: true, acknowledgedAt: true, hsCommitment: true } },
      },
      orderBy: { id: "asc" },
      take: MAX_EXPORT_ROWS + 1,
    }),
  ]);
  // documents x templates rows: bounded BEFORE they are built.
  if (documents.length * templates.length > MAX_EXPORT_ROWS) {
    throw new ExportError("TOO_LARGE", "Too many rows for groupGoals");
  }
  return byPerson(scope, documents, (row) => row.employeeId).flatMap(({ row, person }) =>
    templates.map((template): Cell[] => {
      const ack = row.groupGoalAcks.find((candidate) => candidate.templateId === template.id);
      return [
        ...personCells(scope, person),
        template.type,
        template.contentPl,
        yesNo(ack !== undefined),
        ack ? formatTimestamp(ack.acknowledgedAt) : null,
        ack?.hsCommitment ?? null,
      ];
    }),
  );
}

async function performanceGoalRows(db: SheetDb, scope: ResolvedScope): Promise<Cell[][]> {
  const rows = await db.performanceGoal.findMany({
    where: { document: scope.documentWhere },
    select: {
      title: true, description: true, measures: true, targetValue: true, dueDate: true, progress: true, weight: true,
      state: true, changedByManager: true, createdAt: true, updatedAt: true,
      targetType: { select: { code: true } },
      document: { select: { employeeId: true } },
    },
    orderBy: { id: "asc" },
    take: MAX_EXPORT_ROWS + 1,
  });
  return byPerson(scope, boundRows(rows, "performanceGoals"), (row) => row.document.employeeId).map(({ row, person }) => [
    ...personCells(scope, person),
    row.title, row.description, row.measures, row.targetType?.code ?? null, row.targetValue, isoDate(row.dueDate),
    row.progress, row.weight, row.state, yesNo(row.changedByManager),
    formatTimestamp(row.createdAt), formatTimestamp(row.updatedAt),
  ]);
}

async function developmentGoalRows(db: SheetDb, scope: ResolvedScope): Promise<Cell[][]> {
  const rows = await db.developmentGoal.findMany({
    where: { document: scope.documentWhere },
    select: {
      actionTitle: true, actionDescription: true, startDate: true, endDate: true, progress: true, state: true,
      changedByManager: true, createdAt: true, updatedAt: true,
      developmentArea: { select: { namePl: true } },
      competency: { select: { namePl: true } },
      document: { select: { employeeId: true } },
    },
    orderBy: { id: "asc" },
    take: MAX_EXPORT_ROWS + 1,
  });
  return byPerson(scope, boundRows(rows, "developmentGoals"), (row) => row.document.employeeId).map(({ row, person }) => [
    ...personCells(scope, person),
    row.developmentArea?.namePl ?? null, row.competency?.namePl ?? null, row.actionTitle, row.actionDescription,
    isoDate(row.startDate), isoDate(row.endDate), row.progress, row.state, yesNo(row.changedByManager),
    formatTimestamp(row.createdAt), formatTimestamp(row.updatedAt),
  ]);
}

async function statusHistoryRows(db: SheetDb, scope: ResolvedScope): Promise<Cell[][]> {
  const rows = await db.documentStatusHistory.findMany({
    where: { document: scope.documentWhere },
    select: {
      fromStatus: true, toStatus: true, comment: true, createdAt: true,
      author: { select: { amei: true, firstName: true, lastName: true } },
      document: { select: { employeeId: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS + 1,
  });
  return byPerson(scope, boundRows(rows, "statusHistory"), (row) => row.document.employeeId).map(({ row, person }) => [
    ...personCells(scope, person),
    row.fromStatus, row.toStatus, row.author.amei, `${row.author.firstName} ${row.author.lastName}`, row.comment,
    formatTimestamp(row.createdAt),
  ]);
}

const LOADERS: Readonly<Record<ExportDataType, (db: SheetDb, scope: ResolvedScope) => Cell[][] | Promise<Cell[][]>>> = {
  employees: (_db, scope) => employeeRows(scope),
  documents: documentRows,
  groupGoals: groupGoalRows,
  performanceGoals: performanceGoalRows,
  developmentGoals: developmentGoalRows,
  statusHistory: statusHistoryRows,
};

/** Loads the selected data types, one sheet each, in the order given. */
export async function loadSheets(
  db: SheetDb,
  scope: ResolvedScope,
  dataTypes: readonly ExportDataType[],
): Promise<ExportSheet[]> {
  // One after another: the pool is capped at a few connections per process (src/server/db.ts).
  const sheets: ExportSheet[] = [];
  let totalRows = 0;
  for (const dataType of dataTypes) {
    const rows = await LOADERS[dataType](db, scope);
    totalRows += rows.length;
    if (totalRows > MAX_EXPORT_TOTAL_ROWS) throw new ExportError("TOO_LARGE", "Too many rows for one file");
    sheets.push({ dataType, name: SHEET_NAMES[dataType], headers: HEADERS[dataType], rows });
  }
  return sheets;
}
