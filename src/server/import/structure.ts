import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ImportKind } from "@/generated/prisma/enums";
import { findManagerCycles, HIERARCHY_TX_OPTIONS, lockHierarchy, type HierarchyNode } from "@/server/hierarchy";
import type { FieldChange, ImportDb, ImportHandler, ImportIssue, ImportPlan, ImportValue, PlannedChange } from "./pipeline";
import {
  AMEI_PATTERN,
  BOOLEAN_FALSE,
  BOOLEAN_TRUE,
  MAX_EMAIL_LENGTH,
  MAX_TEXT_LENGTH,
  STRUCTURE_COLUMNS,
  STRUCTURE_FIELDS,
  type StructureColumn,
  type StructureField,
} from "./structure-columns";
import { applyStructure } from "./structure-write";
import type { RawRow, RawTable } from "./table";

// Employee-structure importer (HR-01..03) plugged into the generic pipeline.
// Planning is pure (planStructure) over a snapshot of the employee table, so every validation rule
// is unit-testable without a database. Rules:
//  - required fields, TAK/NIE booleans, ISO dates, e-mail / AMEI / text format -> row error
//  - AMEI and e-mail unique in the file (later duplicates are the error) and against the DB
//  - manager AMEI exists in the file or the DB; empty = top of the structure
//  - no cycle in the structure that would actually be written; the message names the people
//  - a valid row whose manager is only in a rejected new row is rejected too (MANAGER_REJECTED)
//  - active people missing from the file are deactivated; their documents stay (ACC-04).
//    A person whose row has errors is still "in the file" and is never deactivated.
//  - the import may not deactivate the HR user running it or take their HR rights (SELF_LOCKOUT),
//    so at least one active HR admin always remains.

export type StructureRecord = {
  amei: string;
  email: string;
  firstName: string;
  lastName: string;
  managerAmei: string | null;
  department: string | null;
  position: string | null;
  location: string | null;
  isWhiteCollar: boolean;
  isActive: boolean;
  /** ISO YYYY-MM-DD. */
  hireDate: string | null;
  isHrAdmin: boolean;
};

export type StructurePlan = ImportPlan<StructureRecord>;

export type StructureIssueCode =
  | "MISSING_COLUMN"
  | "DUPLICATE_COLUMN"
  | "NO_ROWS"
  | "SELF_LOCKOUT"
  | "REQUIRED"
  | "TOO_LONG"
  | "INVALID_TEXT"
  | "INVALID_AMEI"
  | "INVALID_EMAIL"
  | "INVALID_BOOLEAN"
  | "INVALID_DATE"
  | "DUPLICATE_AMEI"
  | "DUPLICATE_EMAIL"
  | "UNKNOWN_MANAGER"
  | "MANAGER_REJECTED"
  | "HIERARCHY_CYCLE";

// ---------------------------------------------------------------------------
// Field parsing (zod)
// ---------------------------------------------------------------------------

const isoDate = z.iso.date();
const emailFormat = z.email();
// Control characters, zero-width and bidi overrides: never legitimate in names or org units.
const HIDDEN_CHARACTERS = /[\p{Cc}​-‏‪-‮⁠-⁩﻿]/u;
const MAX_ECHOED_LENGTH = 50;

/** A cell value quoted for an error message, cut short so a huge cell cannot bloat the preview. */
function quote(value: string): string {
  return value.length > MAX_ECHOED_LENGTH ? `"${value.slice(0, MAX_ECHOED_LENGTH)}..."` : `"${value}"`;
}

function fieldSchema(column: StructureColumn) {
  return z.string().transform((raw, ctx): ImportValue => {
    const fail = (code: StructureIssueCode, message: string) => {
      ctx.addIssue({ code: "custom", message, params: { importCode: code } });
      return z.NEVER;
    };
    const value = raw.trim();
    if (value === "") {
      if (column.valueRequired) return fail("REQUIRED", `"${column.header}" is required`);
      return column.kind === "boolean" ? false : null;
    }
    switch (column.kind) {
      case "amei": {
        const amei = value.toUpperCase();
        return AMEI_PATTERN.test(amei) ? amei : fail("INVALID_AMEI", `${quote(value)} is not a valid AMEI`);
      }
      case "email": {
        const lower = value.toLowerCase();
        if (lower.length > MAX_EMAIL_LENGTH) return fail("TOO_LONG", `E-mail is longer than ${MAX_EMAIL_LENGTH} characters`);
        return emailFormat.safeParse(lower).success ? lower : fail("INVALID_EMAIL", `${quote(value)} is not a valid e-mail`);
      }
      case "boolean": {
        const upper = value.toUpperCase();
        if (upper === BOOLEAN_TRUE) return true;
        if (upper === BOOLEAN_FALSE) return false;
        return fail("INVALID_BOOLEAN", `${quote(value)} must be ${BOOLEAN_TRUE} or ${BOOLEAN_FALSE}`);
      }
      case "date":
        return isoDate.safeParse(value).success
          ? value
          : fail("INVALID_DATE", `${quote(value)} is not a date in the format YYYY-MM-DD`);
      case "text":
        if (value.length > MAX_TEXT_LENGTH) {
          return fail("TOO_LONG", `"${column.header}" is longer than ${MAX_TEXT_LENGTH} characters`);
        }
        return HIDDEN_CHARACTERS.test(value)
          ? fail("INVALID_TEXT", `"${column.header}" contains line breaks or invisible control characters`)
          : value;
    }
  });
}

const FIELD_SCHEMAS = Object.fromEntries(
  STRUCTURE_FIELDS.map((field) => [field, fieldSchema(STRUCTURE_COLUMNS[field])]),
) as Record<StructureField, ReturnType<typeof fieldSchema>>;

type ColumnIndex = Partial<Record<StructureField, number>>;

interface ParsedRow {
  line: number;
  /** AMEI as written (trimmed, upper-cased), even when invalid: marks the person as present. */
  rawAmei: string;
  values: Partial<Record<StructureField, ImportValue>>;
  issues: ImportIssue[];
}

function issue(
  line: number | null,
  field: StructureField | null,
  code: StructureIssueCode,
  message: string,
  people?: string[],
): ImportIssue {
  const column = field === null ? null : STRUCTURE_COLUMNS[field].header;
  return people ? { line, column, code, message, people } : { line, column, code, message };
}

function mapColumns(headers: readonly string[]): { index: ColumnIndex; fileErrors: ImportIssue[] } {
  const index: ColumnIndex = {};
  const fileErrors: ImportIssue[] = [];
  for (const field of STRUCTURE_FIELDS) {
    const { header, columnRequired } = STRUCTURE_COLUMNS[field];
    const positions = headers.flatMap((h, i) => (h === header ? [i] : []));
    if (positions.length > 1) {
      fileErrors.push(issue(1, field, "DUPLICATE_COLUMN", `Column "${header}" appears more than once`));
    } else if (positions.length === 1) {
      index[field] = positions[0];
    } else if (columnRequired) {
      fileErrors.push(issue(1, field, "MISSING_COLUMN", `Required column "${header}" is missing`));
    }
  }
  return { index, fileErrors };
}

function parseRow(row: RawRow, index: ColumnIndex): ParsedRow {
  const values: Partial<Record<StructureField, ImportValue>> = {};
  const issues: ImportIssue[] = [];
  for (const field of STRUCTURE_FIELDS) {
    const position = index[field];
    if (position === undefined) continue;
    const result = FIELD_SCHEMAS[field].safeParse(row.cells[position] ?? "");
    if (result.success) {
      values[field] = result.data;
      continue;
    }
    // Every failure of fieldSchema is a custom issue carrying our code.
    const first = result.error.issues[0];
    const code = first.code === "custom" ? (first.params?.importCode as StructureIssueCode) : "REQUIRED";
    issues.push(issue(row.line, field, code, first.message));
  }
  const rawAmei = index.amei === undefined ? "" : (row.cells[index.amei] ?? "").trim().toUpperCase();
  return { line: row.line, rawAmei, values, issues };
}

// ---------------------------------------------------------------------------
// Cross-row validation
// ---------------------------------------------------------------------------

export interface ExistingEmployee {
  id: number;
  record: StructureRecord;
}

const isAccepted = (row: ParsedRow): boolean => row.issues.length === 0;
const text = (row: ParsedRow, field: StructureField): string | null => (row.values[field] as string | null) ?? null;

/** Later duplicates of an AMEI / e-mail in the file are errors; returns the first row per AMEI. */
function checkFileDuplicates(rows: readonly ParsedRow[]): Map<string, ParsedRow> {
  const firstByAmei = new Map<string, ParsedRow>();
  const firstByEmail = new Map<string, ParsedRow>();
  for (const row of rows) {
    const amei = text(row, "amei");
    const email = text(row, "email");
    const ameiOwner = amei ? firstByAmei.get(amei) : undefined;
    const emailOwner = email ? firstByEmail.get(email) : undefined;
    if (ameiOwner) {
      row.issues.push(issue(row.line, "amei", "DUPLICATE_AMEI", `AMEI ${amei} is already on line ${ameiOwner.line}`));
    } else if (amei) {
      firstByAmei.set(amei, row);
    }
    if (emailOwner) {
      row.issues.push(issue(row.line, "email", "DUPLICATE_EMAIL", `E-mail ${email} is already on line ${emailOwner.line}`));
    } else if (email) {
      firstByEmail.set(email, row);
    }
  }
  return firstByAmei;
}

interface CrossContext {
  rows: readonly ParsedRow[];
  firstByAmei: ReadonlyMap<string, ParsedRow>;
  existingByAmei: ReadonlyMap<string, ExistingEmployee>;
  existingByEmail: ReadonlyMap<string, ExistingEmployee>;
  /** Rows by their manager's AMEI, for cascading rejections. */
  reportsOf: ReadonlyMap<string, readonly ParsedRow[]>;
}

function groupReports(rows: readonly ParsedRow[]): Map<string, ParsedRow[]> {
  const reportsOf = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const manager = text(row, "managerAmei");
    if (manager) reportsOf.set(manager, [...(reportsOf.get(manager) ?? []), row]);
  }
  return reportsOf;
}

function checkManagersExist({ rows, firstByAmei, existingByAmei }: CrossContext): void {
  for (const row of rows) {
    const manager = text(row, "managerAmei");
    if (manager && !firstByAmei.has(manager) && !existingByAmei.has(manager)) {
      const message = `Manager ${manager} is neither in the file nor in the database`;
      row.issues.push(issue(row.line, "managerAmei", "UNKNOWN_MANAGER", message));
    }
  }
}

/** True when a rejected row takes a NEW person out of the import (an existing one stays in the DB). */
function removesPerson(row: ParsedRow, ctx: CrossContext): boolean {
  const amei = text(row, "amei");
  return amei !== null && ctx.firstByAmei.get(amei) === row && !ctx.existingByAmei.has(amei);
}

/**
 * Rejects the valid reports (transitively) of every rejected new person - one worklist pass,
 * linear in the number of rows. Returns true when it rejected something.
 */
function cascadeRejections(ctx: CrossContext): boolean {
  const queue = ctx.rows.filter((r) => !isAccepted(r) && removesPerson(r, ctx));
  let rejected = false;
  for (let next = queue.pop(); next; next = queue.pop()) {
    for (const report of ctx.reportsOf.get(text(next, "amei") ?? "") ?? []) {
      if (!isAccepted(report)) continue;
      const message = `Manager ${text(next, "amei")} (line ${next.line}) has errors and is not imported`;
      report.issues.push(issue(report.line, "managerAmei", "MANAGER_REJECTED", message));
      rejected = true;
      if (removesPerson(report, ctx)) queue.push(report);
    }
  }
  return rejected;
}

/** An e-mail held in the DB by someone else is free only if that person's valid row changes it. */
function rejectTakenEmails({ rows, firstByAmei, existingByEmail }: CrossContext): boolean {
  let rejected = false;
  for (const row of rows.filter(isAccepted)) {
    const email = text(row, "email");
    const holder = email ? existingByEmail.get(email) : undefined;
    if (!email || !holder || holder.record.amei === text(row, "amei")) continue;
    const holderRow = firstByAmei.get(holder.record.amei);
    const released = holderRow !== undefined && isAccepted(holderRow) && text(holderRow, "email") !== email;
    if (!released) {
      const message = `E-mail ${email} belongs to ${holder.record.amei} in the database`;
      row.issues.push(issue(row.line, "email", "DUPLICATE_EMAIL", message));
      rejected = true;
    }
  }
  return rejected;
}

/**
 * Looks for cycles in the structure that would be written: valid rows use the file's manager,
 * everyone else keeps the database manager. Rejects the earliest valid row of every cycle.
 */
function rejectCycles({ firstByAmei, existingByAmei }: CrossContext): boolean {
  const managerOf = new Map<string, string | null>();
  for (const [amei, e] of existingByAmei) managerOf.set(amei, e.record.managerAmei);
  for (const [amei, row] of firstByAmei) {
    if (isAccepted(row)) managerOf.set(amei, text(row, "managerAmei"));
  }
  const ameis = [...managerOf.keys()];
  const idOf = new Map(ameis.map((amei, i) => [amei, i]));
  const nodes: HierarchyNode[] = ameis.map((amei, i) => {
    const manager = managerOf.get(amei);
    return { id: i, managerId: manager ? (idOf.get(manager) ?? null) : null, label: amei };
  });

  const lineOf = (amei: string): number => {
    const row = firstByAmei.get(amei);
    return row && isAccepted(row) ? row.line : Number.POSITIVE_INFINITY;
  };
  let rejected = false;
  for (const cycle of findManagerCycles(nodes)) {
    const start = cycle.reduce((best, node, i) => (lineOf(node.label) < lineOf(cycle[best].label) ? i : best), 0);
    const people = [...cycle.slice(start), ...cycle.slice(0, start)].map((n) => n.label);
    const row = firstByAmei.get(people[0]);
    // A loop with no valid file row is not caused by this file; rebuildHierarchy reports it on confirm.
    if (!row || !isAccepted(row)) continue;
    const loop = [...people, people[0]].join(" -> ");
    row.issues.push(issue(row.line, "managerAmei", "HIERARCHY_CYCLE", `Hierarchy cycle: ${loop}`, people));
    rejected = true;
  }
  return rejected;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const DEFAULTS: StructureRecord = {
  amei: "",
  email: "",
  firstName: "",
  lastName: "",
  managerAmei: null,
  department: null,
  position: null,
  location: null,
  isWhiteCollar: true,
  isActive: true,
  hireDate: null,
  isHrAdmin: false,
};

/** File values for the columns present; absent optional columns keep the DB value (or default). */
function toRecord(row: ParsedRow, current: StructureRecord | undefined, index: ColumnIndex): StructureRecord {
  const base = current ?? DEFAULTS;
  const entries = STRUCTURE_FIELDS.map((f) => [f, index[f] === undefined ? base[f] : row.values[f]]);
  return Object.fromEntries(entries) as StructureRecord;
}

function fieldChanges(before: StructureRecord | null, after: StructureRecord): FieldChange[] {
  return STRUCTURE_FIELDS.filter((f) => before === null || before[f] !== after[f]).map((f) => ({
    field: f,
    before: before === null ? null : before[f],
    after: after[f],
  }));
}

function deactivations(existing: readonly ExistingEmployee[], rows: readonly ParsedRow[]): PlannedChange<StructureRecord>[] {
  const present = new Set(rows.map((r) => r.rawAmei));
  return existing
    .filter((e) => e.record.isActive && !present.has(e.record.amei))
    .map((e) => {
      const after = { ...e.record, isActive: false };
      return { line: null, key: e.record.amei, before: e.record, after, fields: fieldChanges(e.record, after) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The importing HR user must stay active and HR, or nobody may be left to fix the structure. */
function selfLockout(
  actorId: number | null,
  existing: readonly ExistingEmployee[],
  changes: readonly PlannedChange<StructureRecord>[],
): ImportIssue[] {
  const actor = existing.find((e) => e.id === actorId);
  const after = actor && changes.find((c) => c.key === actor.record.amei)?.after;
  if (!actor || !after || (after.isActive && after.isHrAdmin)) return [];
  const message = `The import would deactivate you (${actor.record.amei}) or remove your HR rights`;
  return [issue(null, null, "SELF_LOCKOUT", message, [actor.record.amei])];
}

/**
 * Validates and diffs a parsed file against a snapshot of the employee table. Pure.
 * `actorId` is the importing HR user (null in tests that do not care).
 */
export function planStructure(table: RawTable, existing: readonly ExistingEmployee[], actorId: number | null): StructurePlan {
  const base = {
    kind: ImportKind.STRUKTURA,
    totalRows: table.rows.length,
    created: [],
    changed: [],
    deactivated: [],
    unchangedCount: 0,
    errors: [],
  };
  const { index, fileErrors } = mapColumns(table.headers);
  if (fileErrors.length > 0) return { ...base, fileErrors };
  // An empty file would deactivate everybody.
  if (table.rows.length === 0) return { ...base, fileErrors: [issue(null, null, "NO_ROWS", "The file has no employee rows")] };

  const rows = table.rows.map((r) => parseRow(r, index));
  const firstByAmei = checkFileDuplicates(rows);
  const ctx: CrossContext = {
    rows,
    firstByAmei,
    existingByAmei: new Map(existing.map((e) => [e.record.amei, e])),
    existingByEmail: new Map(existing.map((e) => [e.record.email.toLowerCase(), e])),
    reportsOf: groupReports([...firstByAmei.values()]),
  };
  checkManagersExist(ctx);
  // Every pass that returns true rejects at least one more row, so the loop ends. Each pass is
  // linear and rejects all it can find, so in practice it runs only a few times.
  let rejectedMore = true;
  while (rejectedMore) {
    const cascaded = cascadeRejections(ctx);
    rejectedMore = rejectTakenEmails(ctx) || cascaded || rejectCycles(ctx);
  }

  const created: PlannedChange<StructureRecord>[] = [];
  const changed: PlannedChange<StructureRecord>[] = [];
  let unchangedCount = 0;
  for (const row of rows.filter(isAccepted)) {
    const current = ctx.existingByAmei.get(text(row, "amei") ?? "")?.record;
    const after = toRecord(row, current, index);
    const change = { line: row.line, key: after.amei, before: current ?? null, after, fields: fieldChanges(current ?? null, after) };
    if (!current) created.push(change);
    else if (change.fields.length > 0) changed.push(change);
    else unchangedCount += 1;
  }
  const deactivated = deactivations(existing, rows);
  const errors = rows.flatMap((r) => r.issues);
  const blocking = selfLockout(actorId, existing, [...changed, ...deactivated]);
  return { ...base, created, changed, deactivated, unchangedCount, errors, fileErrors: blocking };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Snapshot of every employee (active or not) in import shape. */
export async function loadExistingEmployees(db: ImportDb): Promise<ExistingEmployee[]> {
  const rows = await db.employee.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      amei: true,
      email: true,
      firstName: true,
      lastName: true,
      department: true,
      position: true,
      location: true,
      isWhiteCollar: true,
      isActive: true,
      hireDate: true,
      isHrAdmin: true,
      manager: { select: { amei: true } },
    },
  });
  return rows.map(({ id, manager, hireDate, ...rest }) => ({
    id,
    record: {
      ...rest,
      managerAmei: manager?.amei ?? null,
      hireDate: hireDate ? hireDate.toISOString().slice(0, 10) : null,
    },
  }));
}

/**
 * Row locks first (so another writer holding a row and waiting for the hierarchy lock can finish),
 * then the hierarchy lock, which also serialises against people being created elsewhere.
 */
async function lockStructure(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT id FROM employee FOR UPDATE`;
  await lockHierarchy(tx);
}

// One import writes up to MAX_IMPORT_ROWS people row by row, so it gets more time than a single rebuild.
const STRUCTURE_IMPORT_TIMEOUT_MS = 5 * 60_000;

export const structureImport: ImportHandler<StructureRecord> = {
  kind: ImportKind.STRUKTURA,
  txOptions: { ...HIERARCHY_TX_OPTIONS, timeout: STRUCTURE_IMPORT_TIMEOUT_MS },
  lockForWrite: lockStructure,
  plan: async (db, table, ctx) => planStructure(table, await loadExistingEmployees(db), ctx.actorId),
  apply: applyStructure,
};
