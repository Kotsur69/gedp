import { expect } from "vitest";
import type { DocumentStatusValue } from "@/domain/document-status";
import type { Viewer } from "@/server/permissions";
import { WorkflowError, type WorkflowReader, type WorkflowWriter } from "@/server/workflow";

// Workflow rules against an in-memory stand-in for the Prisma transaction client. It implements
// only the calls the workflow and the goal writers make, rolls back on a throw like a real
// transaction, and fails loudly on any query shape it does not understand - so a change in the
// queries shows up here instead of passing silently. Shared by the workflow test files.

type Row = Record<string, unknown>;

export interface Person {
  id: number;
  managerId: number | null;
  validatorOverrideId: number | null;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isHrAdmin: boolean;
  /** Closure rows where this person is the descendant (depth >= 1), i.e. their N+1 and above. */
  ancestorIds: number[];
}

export interface State {
  people: Person[];
  cycle: { id: number; year: number; status: string; minPerformanceGoals: number; requiredWeightSum: number; minDevelopmentGoals: number };
  documents: { id: number; employeeId: number; cycleId: number; status: DocumentStatusValue; validatorId: number | null }[];
  templates: { id: number; cycleId: number; type: string }[];
  acks: { documentId: number; templateId: number; hsCommitment: string | null }[];
  performanceGoals: {
    id: number;
    documentId: number;
    state: string;
    weight: number | null;
    progress: number;
    title?: string;
    changedByManager?: boolean;
  }[];
  developmentGoals: { id: number; documentId: number; state: string; progress: number }[];
  history: { id: number; documentId: number; fromStatus: string | null; toStatus: string; authorId: number; comment: string | null; createdAt: Date }[];
  audit: Row[];
}

// M1 manages A and B; N2 manages M1 (so is A's N+2); OV is B's override validator; HR is HR.
export const M1 = 1;
export const A = 2;
export const B = 3;
export const N2 = 4;
export const OV = 5;
export const HR = 6;
export const DOC_A = 10;
export const DOC_B = 11;

export function person(id: number, managerId: number | null, extra: Partial<Person> = {}): Person {
  return {
    id,
    managerId,
    validatorOverrideId: null,
    firstName: "Test",
    lastName: `P${id}`,
    isActive: true,
    isHrAdmin: id === HR,
    ancestorIds: [],
    ...extra,
  };
}

/** Two documents that pass every closing condition. */
export function seed(statusA: DocumentStatusValue = "SZKIC", statusB: DocumentStatusValue = "SZKIC"): State {
  return {
    people: [
      person(M1, N2, { ancestorIds: [N2] }),
      person(A, M1, { ancestorIds: [M1, N2] }),
      person(B, M1, { validatorOverrideId: OV, ancestorIds: [M1, N2] }),
      person(N2, null),
      person(OV, null),
      person(HR, null),
    ],
    cycle: { id: 1, year: 2027, status: "OTWARTY", minPerformanceGoals: 1, requiredWeightSum: 100, minDevelopmentGoals: 1 },
    documents: [
      { id: DOC_A, employeeId: A, cycleId: 1, status: statusA, validatorId: null },
      { id: DOC_B, employeeId: B, cycleId: 1, status: statusB, validatorId: null },
    ],
    templates: [
      { id: 100, cycleId: 1, type: "PRZYWODZTWO" },
      { id: 101, cycleId: 1, type: "WARTOSCI" },
      { id: 102, cycleId: 1, type: "BHP" },
    ],
    acks: [DOC_A, DOC_B].flatMap((documentId) => [
      { documentId, templateId: 100, hsCommitment: null },
      { documentId, templateId: 101, hsCommitment: null },
      { documentId, templateId: 102, hsCommitment: "Report every near miss" },
    ]),
    performanceGoals: [
      { id: 200, documentId: DOC_A, state: "W_PLANIE", weight: 60, progress: 0 },
      { id: 201, documentId: DOC_A, state: "W_PLANIE", weight: 40, progress: 50 },
      { id: 202, documentId: DOC_A, state: "SZKIC", weight: null, progress: 0 },
      { id: 210, documentId: DOC_B, state: "W_PLANIE", weight: 100, progress: 0 },
    ],
    developmentGoals: [
      { id: 300, documentId: DOC_A, state: "W_PLANIE", progress: 0 },
      { id: 310, documentId: DOC_B, state: "W_PLANIE", progress: 0 },
    ],
    history: [],
    audit: [],
  };
}

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

function unsupported(what: string, value: unknown): never {
  throw new Error(`fake db: unsupported ${what}: ${JSON.stringify(value)}`);
}

/** Field equality plus `{ not }`; anything else is unsupported. */
function fieldMatches(actual: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object") {
    if (Object.keys(condition).length === 1 && "not" in condition) return actual !== condition.not;
    return unsupported("field condition", condition);
  }
  return actual === condition;
}

type Relations = Record<string, (row: Row) => Row | undefined>;

function matches(row: Row, where: unknown, relations: Relations = {}): boolean {
  if (where === undefined) return true;
  if (where === null || typeof where !== "object") return unsupported("where", where);
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return (condition as unknown[]).every((part) => matches(row, part, relations));
    if (key === "OR") return (condition as unknown[]).some((part) => matches(row, part, relations));
    const relation = relations[key];
    if (relation) {
      const related = relation(row);
      return related !== undefined && matches(related, condition);
    }
    if (!(key in row)) return unsupported(`field "${key}"`, condition);
    return fieldMatches(row[key], condition);
  });
}

export interface FakeOptions {
  /** Runs right after the permission read of a document, to simulate a concurrent change. */
  afterPermissionRead?: (state: State) => void;
}

export function createFakeDb(initial: State, options: FakeOptions = {}) {
  let state = structuredClone(initial);
  let nextId = 1000;
  // The permission select filters closure rows to the viewer; the fake learns the viewer per call.
  let currentViewer = 0;
  const personById = (id: unknown) => state.people.find((p) => p.id === id);
  const documentRelations: Relations = { employee: (doc) => personById(doc.employeeId) as unknown as Row | undefined };
  const findDocuments = (where: unknown) => state.documents.filter((doc) => matches(doc, where, documentRelations));
  const goalTable = <G extends Row>(rows: () => G[]) => ({
    findMany: async ({ where }: { where: unknown }) => rows().filter((g) => matches(g, where)),
    findFirst: async ({ where }: { where: unknown }) => rows().find((g) => matches(g, where)) ?? null,
    findUnique: async ({ where }: { where: unknown }) => rows().find((g) => matches(g, where)) ?? null,
    count: async ({ where }: { where: unknown }) => rows().filter((g) => matches(g, where)).length,
    update: async ({ where, data }: { where: { id: number }; data: Row }) => {
      const goal = rows().find((g) => g.id === where.id);
      if (!goal) throw new Error(`fake db: no goal ${where.id}`);
      Object.assign(goal, data);
      return goal;
    },
  });

  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const doc = state.documents.find((d) => d.id === values[0]);
      if (!doc) return [];
      const { status, id, year } = state.cycle;
      return [{ documentStatus: doc.status, cycleStatus: status, cycleId: id, cycleYear: year }];
    },
    // The live HR check (requireActiveHrAdmin) reads the viewer's own row.
    employee: {
      findFirst: async ({ where }: { where: unknown }) => {
        const found = state.people.find((p) => matches(p as unknown as Row, where));
        return found ? { id: found.id } : null;
      },
    },
    gedpDocument: {
      findUnique: async ({ where }: { where: { id: number } }) => {
        const doc = state.documents.find((d) => d.id === where.id);
        if (!doc) return null;
        const employee = personById(doc.employeeId);
        if (!employee) throw new Error(`fake db: no person ${doc.employeeId}`);
        const result = {
          id: doc.id,
          cycleId: doc.cycleId,
          status: doc.status,
          employee: {
            id: employee.id,
            managerId: employee.managerId,
            validatorOverrideId: employee.validatorOverrideId,
            ancestors: employee.ancestorIds.includes(currentViewer) ? [{ depth: 1 }] : [],
          },
        };
        options.afterPermissionRead?.(state);
        return result;
      },
      updateMany: async ({ where, data }: { where: unknown; data: Row }) => {
        const hits = findDocuments(where);
        hits.forEach((doc) => Object.assign(doc, data));
        return { count: hits.length };
      },
    },
    cycle: { findUniqueOrThrow: async () => state.cycle },
    groupGoalTemplate: {
      findMany: async ({ where }: { where: unknown }) => state.templates.filter((t) => matches(t, where)),
      findUnique: async ({ where }: { where: { id: number } }) => state.templates.find((t) => t.id === where.id) ?? null,
    },
    groupGoalAck: {
      findMany: async ({ where }: { where: unknown }) => state.acks.filter((a) => matches(a, where)),
    },
    performanceGoal: goalTable(() => state.performanceGoals),
    // Only the default "Tekst" type: enough for a draft goal's full-replace edit.
    targetType: { findMany: async () => [{ id: 1, code: "TEKST", isNumeric: false }] },
    developmentGoal: goalTable(() => state.developmentGoals),
    documentStatusHistory: {
      create: async ({ data }: { data: Omit<State["history"][number], "id" | "createdAt"> }) => {
        const row = { ...data, id: nextId++, createdAt: new Date(Date.UTC(2027, 1, 1, 9, state.history.length)) };
        state.history.push(row);
        return { id: row.id, createdAt: row.createdAt };
      },
      count: async ({ where }: { where: unknown }) => state.history.filter((h) => matches(h, where)).length,
      findMany: async ({ where }: { where: unknown }) =>
        state.history
          .filter((h) => matches(h, where))
          .map((h) => {
            const author = personById(h.authorId);
            return { ...h, author: { firstName: author?.firstName, lastName: author?.lastName } };
          }),
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        state.audit.push(data);
        return data;
      },
    },
  };

  const db = {
    ...tx,
    $transaction: async <T,>(fn: (client: typeof tx) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(state);
      try {
        return await fn(tx);
      } catch (error: unknown) {
        state = snapshot;
        throw error;
      }
    },
  };
  return {
    as(viewer: Viewer): WorkflowWriter & WorkflowReader {
      currentViewer = viewer.id;
      return db as unknown as WorkflowWriter & WorkflowReader;
    },
    get state(): State {
      return state;
    },
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;

export const viewer = (id: number): Viewer => ({ id, isHrAdmin: id === HR });

/** A db that fails the test if anything opens a transaction: for checks that must come first. */
export const untouchable = {
  $transaction: () => {
    throw new Error("database must not be touched");
  },
} as unknown as WorkflowWriter;

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

export async function expectWorkflowError(promise: Promise<unknown>, code: string, status: number): Promise<WorkflowError> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(WorkflowError);
  expect(error).toMatchObject({ code, status });
  return error as WorkflowError;
}
