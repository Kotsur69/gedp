import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { DocumentStatus } from "@/generated/prisma/enums";
import {
  closingProgress,
  type ClosingGoalState,
  type ClosingGroupGoalType,
  type ClosingInput,
  type ClosingProgress,
} from "@/domain/document-status";
import { accessSubjectSelect, permissionsFromRow, scopedEmployeesWhere, type Viewer } from "@/server/permissions";

// "Mój zespół" list (WF-20..22, plan section 6). Who appears is decided by the permission module:
// every query ANDs scopedEmployeesWhere(viewer) with the team filter, and canValidate per row comes
// from permissionsFromRow - this module never re-implements an access rule.
//
//   N+1              - direct reports only (closure depth 1, or managerId for a lagging closure)
//   N+2 and above    - the whole subtree, filterable by level (depth below the viewer)
//   override (WF-09) - people the viewer validates without being above them: level null, listed
//                      under level 1 ("validated directly"). Someone who is also below the viewer
//                      keeps their real depth and is filtered by it.
// HR's global view right does not turn HR's own team into the whole company: the team filter
// always starts from the viewer's own structure.

/** Level 1 = direct reports (and people validated through WF-09). */
export const DIRECT_LEVEL = 1;
/** Upper bound for one list; the page says when it is cut. A level filter narrows it. */
export const TEAM_LIMIT = 1000;
const LEVEL_PATTERN = /^[1-9]\d{0,2}$/;

/**
 * The `?level=` search param -> a level the viewer actually has (1..maxLevel), or null for the
 * whole structure. Anything else (missing, malformed, out of range, repeated) means null.
 */
export function parseTeamLevel(raw: unknown, maxLevel: number): number | null {
  if (typeof raw !== "string" || !LEVEL_PATTERN.test(raw)) return null;
  const level = Number(raw);
  return level <= maxLevel ? level : null;
}

function belowViewer(viewer: Viewer, depth: Prisma.IntFilter | number): Prisma.EmployeeWhereInput {
  return { ancestors: { some: { ancestorId: viewer.id, depth } } };
}

/** Employees on the viewer's team at `level` (null = every level), inside the viewer's scope. */
export function teamMembersWhere(viewer: Viewer, level: number | null): Prisma.EmployeeWhereInput {
  const overrideOnly: Prisma.EmployeeWhereInput = {
    validatorOverrideId: viewer.id,
    ancestors: { none: { ancestorId: viewer.id, depth: { gte: 1 } } },
  };
  let team: Prisma.EmployeeWhereInput;
  if (level === null) {
    team = { OR: [belowViewer(viewer, { gte: 1 }), { managerId: viewer.id }, { validatorOverrideId: viewer.id }] };
  } else if (level === DIRECT_LEVEL) {
    team = { OR: [belowViewer(viewer, DIRECT_LEVEL), { managerId: viewer.id }, overrideOnly] };
  } else {
    team = belowViewer(viewer, level);
  }
  return scopedEmployeesWhere(viewer, { AND: [{ id: { not: viewer.id } }, team] });
}

// ---------------------------------------------------------------------------
// Completion and last update, for many documents at once
// ---------------------------------------------------------------------------

export interface ClosingRules {
  minPerformanceGoals: number;
  requiredWeightSum: number;
  minDevelopmentGoals: number;
}

export interface CompletionRows {
  rules: ClosingRules;
  templates: readonly { id: number; type: ClosingGroupGoalType }[];
  acks: readonly { documentId: number; templateId: number; hsCommitment: string | null; acknowledgedAt: Date }[];
  performanceGoals: readonly { documentId: number; state: ClosingGoalState; weight: number | null; updatedAt: Date }[];
  developmentGoals: readonly { documentId: number; state: ClosingGoalState; updatedAt: Date }[];
}

export interface DocumentSummary {
  completion: ClosingProgress;
  /** Latest change to the document or anything in it (status, goal, acknowledgement). */
  lastUpdatedAt: Date;
}

function groupByDocument<T extends { documentId: number }>(rows: readonly T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const group = groups.get(row.documentId);
    if (group) group.push(row);
    else groups.set(row.documentId, [row]);
  }
  return groups;
}

function latest(first: Date, rest: readonly Date[]): Date {
  return rest.reduce((max, date) => (date > max ? date : max), first);
}

/** Pure: completion (closing conditions met / total) and last update per document. */
export function summarizeDocuments(
  documents: readonly { id: number; updatedAt: Date }[],
  rows: CompletionRows,
): Map<number, DocumentSummary> {
  const acks = groupByDocument(rows.acks);
  const performance = groupByDocument(rows.performanceGoals);
  const development = groupByDocument(rows.developmentGoals);

  return new Map(
    documents.map((document) => {
      const docAcks = acks.get(document.id) ?? [];
      const ackByTemplate = new Map(docAcks.map((ack) => [ack.templateId, ack]));
      const docPerformance = performance.get(document.id) ?? [];
      const docDevelopment = development.get(document.id) ?? [];
      const input: ClosingInput = {
        groupGoals: rows.templates.map((template) => {
          const ack = ackByTemplate.get(template.id);
          return { type: template.type, isAcknowledged: ack !== undefined, commitment: ack?.hsCommitment ?? null };
        }),
        performanceGoals: docPerformance,
        developmentGoals: docDevelopment,
        rules: rows.rules,
      };
      const lastUpdatedAt = latest(document.updatedAt, [
        ...docAcks.map((ack) => ack.acknowledgedAt),
        ...docPerformance.map((goal) => goal.updatedAt),
        ...docDevelopment.map((goal) => goal.updatedAt),
      ]);
      return [document.id, { completion: closingProgress(input), lastUpdatedAt }];
    }),
  );
}

type CompletionReader = Pick<
  PrismaClient,
  "cycle" | "groupGoalTemplate" | "groupGoalAck" | "performanceGoal" | "developmentGoal"
>;

async function loadCompletionRows(
  db: CompletionReader,
  cycleId: number,
  documentIds: readonly number[],
): Promise<CompletionRows> {
  const inDocuments = { documentId: { in: [...documentIds] } };
  const [rules, templates, acks, performanceGoals, developmentGoals] = await Promise.all([
    db.cycle.findUniqueOrThrow({
      where: { id: cycleId },
      select: { minPerformanceGoals: true, requiredWeightSum: true, minDevelopmentGoals: true },
    }),
    db.groupGoalTemplate.findMany({ where: { cycleId }, select: { id: true, type: true } }),
    db.groupGoalAck.findMany({
      where: inDocuments,
      select: { documentId: true, templateId: true, hsCommitment: true, acknowledgedAt: true },
    }),
    db.performanceGoal.findMany({
      where: inDocuments,
      select: { documentId: true, state: true, weight: true, updatedAt: true },
    }),
    db.developmentGoal.findMany({ where: inDocuments, select: { documentId: true, state: true, updatedAt: true } }),
  ]);
  return { rules, templates, acks, performanceGoals, developmentGoals };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export type TeamReader = Pick<PrismaClient, "employee" | "employeeHierarchy"> & CompletionReader;

export interface TeamMemberDocument extends DocumentSummary {
  id: number;
  status: DocumentStatus;
}

export interface TeamMember {
  employeeId: number;
  /** Display name, "First Last". */
  name: string;
  /** "Last First": the list order, same as the database order the TEAM_LIMIT cut uses. */
  sortName: string;
  position: string | null;
  department: string | null;
  isActive: boolean;
  /** Depth below the viewer (1 = direct report); null = validated through WF-09 only. */
  level: number | null;
  /** Live rule from the permission module: N+1 or the HR-set override validator. */
  canValidate: boolean;
  /** Null when the person has not opened the cycle yet. */
  document: TeamMemberDocument | null;
}

export interface TeamView {
  members: TeamMember[];
  /** Deepest level below the viewer; 1 = N+1 only, so no level filter. */
  maxLevel: number;
  /** The level the list is filtered to, null = whole structure. */
  level: number | null;
  /** More people match than TEAM_LIMIT; the list holds the first TEAM_LIMIT by name. */
  isTruncated: boolean;
}

/** Deepest level of the viewer's subtree (at least 1: the page is only open to people with a team). */
export async function teamDepth(db: Pick<PrismaClient, "employeeHierarchy">, viewer: Viewer): Promise<number> {
  const result = await db.employeeHierarchy.aggregate({
    where: { ancestorId: viewer.id, depth: { gte: 1 } },
    _max: { depth: true },
  });
  return Math.max(result._max.depth ?? DIRECT_LEVEL, DIRECT_LEVEL);
}

/** Level first (WF-09-only people last), then surname and first name, Polish collation. */
export function compareMembers(a: TeamMember, b: TeamMember): number {
  const levelA = a.level ?? Number.MAX_SAFE_INTEGER;
  const levelB = b.level ?? Number.MAX_SAFE_INTEGER;
  return levelA - levelB || a.sortName.localeCompare(b.sortName, "pl");
}

/**
 * The viewer's team for one cycle. `rawLevel` is the untrusted `?level=` value; it is parsed
 * against the viewer's own depth here, so a caller cannot ask for a level outside it.
 */
export async function listTeam(db: TeamReader, viewer: Viewer, cycleId: number, rawLevel: unknown): Promise<TeamView> {
  const maxLevel = await teamDepth(db, viewer);
  const level = parseTeamLevel(rawLevel, maxLevel);

  const rows = await db.employee.findMany({
    where: teamMembersWhere(viewer, level),
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: TEAM_LIMIT + 1,
    select: {
      ...accessSubjectSelect(viewer),
      firstName: true,
      lastName: true,
      position: true,
      department: true,
      isActive: true,
      documents: { where: { cycleId }, select: { id: true, status: true, updatedAt: true }, take: 1 },
    },
  });
  const isTruncated = rows.length > TEAM_LIMIT;
  const kept = rows.slice(0, TEAM_LIMIT);

  const documents = kept.flatMap((row) => row.documents);
  const summaries =
    documents.length === 0
      ? new Map<number, DocumentSummary>()
      : summarizeDocuments(documents, await loadCompletionRows(db, cycleId, documents.map((d) => d.id)));

  const members = kept.map((row): TeamMember => {
    const document = row.documents[0];
    const summary = document ? summaries.get(document.id) : undefined;
    // A lagging closure still knows a direct report through managerId.
    const level = row.ancestors[0]?.depth ?? (row.managerId === viewer.id ? DIRECT_LEVEL : null);
    return {
      employeeId: row.id,
      name: `${row.firstName} ${row.lastName}`,
      sortName: `${row.lastName} ${row.firstName}`,
      position: row.position,
      department: row.department,
      isActive: row.isActive,
      level,
      canValidate: permissionsFromRow(viewer, row).validate,
      document: document && summary ? { id: document.id, status: document.status, ...summary } : null,
    };
  });

  return { members: members.toSorted(compareMembers), maxLevel, level, isTruncated };
}
