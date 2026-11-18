import { describe, expect, it } from "vitest";
import type { DocumentStatusValue } from "@/domain/document-status";
import { updateGoalProgress } from "./goal-progress";
import { acknowledgeGroupGoal } from "./group-goals";
import {
  createPerformanceGoal,
  deletePerformanceGoal,
  PerformanceGoalError,
  updatePerformanceGoalAsValidator,
} from "./performance-goals";
import { createDevelopmentGoal, DevelopmentGoalError, updateDevelopmentGoalAsValidator } from "./development-goals";
import { ForbiddenError, NotFoundError, type Viewer } from "./permissions";
import { loadDocumentWorkflow, transitionDocument, WorkflowError, type WorkflowReader, type WorkflowWriter } from "./workflow";

// Workflow rules against an in-memory stand-in for the Prisma transaction client. It implements
// only the calls the workflow and the goal writers make, rolls back on a throw like a real
// transaction, and fails loudly on any query shape it does not understand - so a change in the
// queries shows up here instead of passing silently.

type Row = Record<string, unknown>;

interface Person {
  id: number;
  managerId: number | null;
  validatorOverrideId: number | null;
  firstName: string;
  lastName: string;
  /** Closure rows where this person is the descendant (depth >= 1), i.e. their N+1 and above. */
  ancestorIds: number[];
}

interface State {
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
const M1 = 1;
const A = 2;
const B = 3;
const N2 = 4;
const OV = 5;
const HR = 6;
const DOC_A = 10;
const DOC_B = 11;

function person(id: number, managerId: number | null, extra: Partial<Person> = {}): Person {
  return { id, managerId, validatorOverrideId: null, firstName: "Test", lastName: `P${id}`, ancestorIds: [], ...extra };
}

/** Two documents that pass every closing condition. */
function seed(statusA: DocumentStatusValue = "SZKIC", statusB: DocumentStatusValue = "SZKIC"): State {
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

interface FakeOptions {
  /** Runs right after the permission read of a document, to simulate a concurrent change. */
  afterPermissionRead?: (state: State) => void;
}

function createFakeDb(initial: State, options: FakeOptions = {}) {
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

const viewer = (id: number): Viewer => ({ id, isHrAdmin: id === HR });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

async function expectWorkflowError(promise: Promise<unknown>, code: string, status: number): Promise<WorkflowError> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(WorkflowError);
  expect(error).toMatchObject({ code, status });
  return error as WorkflowError;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transitionDocument - payload (before any database call)", () => {
  const untouchable = {
    $transaction: () => {
      throw new Error("database must not be touched");
    },
  } as unknown as WorkflowWriter;

  it("a return without a comment is refused (WF-03)", async () => {
    await expectWorkflowError(transitionDocument(untouchable, viewer(M1), { documentId: DOC_A, action: "RETURN" }), "COMMENT_REQUIRED", 400);
    await expectWorkflowError(
      transitionDocument(untouchable, viewer(M1), { documentId: DOC_A, action: "RETURN", comment: "   " }),
      "COMMENT_REQUIRED",
      400,
    );
  });

  it("refuses unknown actions, bad ids, extra keys and an over-long comment", async () => {
    const bad = [
      { documentId: DOC_A, action: "REVERT" },
      { documentId: "10", action: "SEND" },
      { documentId: 0, action: "SEND" },
      { documentId: DOC_A, action: "SEND", status: "ZATWIERDZONY" },
      null,
    ];
    for (const input of bad) {
      await expectWorkflowError(transitionDocument(untouchable, viewer(A), input), "INVALID_INPUT", 400);
    }
    await expectWorkflowError(
      transitionDocument(untouchable, viewer(M1), { documentId: DOC_A, action: "RETURN", comment: "x".repeat(2001) }),
      "COMMENT_TOO_LONG",
      400,
    );
  });

  it("a comment on an action that takes none is refused, not stored or dropped", async () => {
    for (const action of ["SEND", "APPROVE"]) {
      await expectWorkflowError(
        transitionDocument(untouchable, viewer(A), { documentId: DOC_A, action, comment: "note" }),
        "INVALID_INPUT",
        400,
      );
    }
  });
});

describe("transitionDocument - legal transitions write status, history and audit together (WF-06)", () => {
  it("SZKIC -> DO_WALIDACJI by the owner", async () => {
    const fake = createFakeDb(seed());
    const result = await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" });

    expect(result).toMatchObject({ documentId: DOC_A, from: "SZKIC", to: "DO_WALIDACJI" });
    expect(fake.state.documents[0]).toMatchObject({ status: "DO_WALIDACJI", validatorId: null });
    expect(fake.state.history).toEqual([
      expect.objectContaining({ documentId: DOC_A, fromStatus: "SZKIC", toStatus: "DO_WALIDACJI", authorId: A, comment: null }),
    ]);
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        actorId: A,
        entity: "gedp_document",
        entityId: String(DOC_A),
        action: "STATUS_SEND",
        before: { status: "SZKIC" },
        after: { status: "DO_WALIDACJI", comment: null, historyId: result.historyId },
      }),
    ]);
  });

  it("DO_WALIDACJI -> ZATWIERDZONY by N+1, recording who validated", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" });
    expect(fake.state.documents[0]).toMatchObject({ status: "ZATWIERDZONY", validatorId: M1 });
    expect(fake.state.history).toEqual([expect.objectContaining({ fromStatus: "DO_WALIDACJI", toStatus: "ZATWIERDZONY", authorId: M1 })]);
    expect(fake.state.audit).toEqual([expect.objectContaining({ action: "STATUS_APPROVE", actorId: M1 })]);
  });

  it("DO_WALIDACJI -> ZWROCONY with the trimmed comment, then the owner resends", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), {
      documentId: DOC_A,
      action: "RETURN",
      comment: "  Weights must add up to 100%  ",
    });
    expect(fake.state.documents[0]?.status).toBe("ZWROCONY");
    expect(fake.state.history.at(-1)).toMatchObject({ toStatus: "ZWROCONY", comment: "Weights must add up to 100%" });

    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" });
    expect(fake.state.documents[0]?.status).toBe("DO_WALIDACJI");
    expect(fake.state.history.map((h) => `${h.fromStatus}->${h.toStatus}`)).toEqual([
      "DO_WALIDACJI->ZWROCONY",
      "ZWROCONY->DO_WALIDACJI",
    ]);
    expect(fake.state.audit.map((a) => a.action)).toEqual(["STATUS_RETURN", "STATUS_SEND"]);
  });

  it("the HR-set override validator validates too (WF-09)", async () => {
    const fake = createFakeDb(seed("SZKIC", "DO_WALIDACJI"));
    await transitionDocument(fake.as(viewer(OV)), viewer(OV), { documentId: DOC_B, action: "APPROVE" });
    expect(fake.state.documents[1]).toMatchObject({ status: "ZATWIERDZONY", validatorId: OV });
  });
});

describe("transitionDocument - refusals leave no trace", () => {
  const STATUSES: DocumentStatusValue[] = ["SZKIC", "DO_WALIDACJI", "ZWROCONY", "ZATWIERDZONY"];
  const LEGAL = new Set(["SEND:SZKIC", "SEND:ZWROCONY", "APPROVE:DO_WALIDACJI", "RETURN:DO_WALIDACJI"]);
  const ACTOR = { SEND: A, APPROVE: M1, RETURN: M1 } as const;

  for (const action of ["SEND", "APPROVE", "RETURN"] as const) {
    for (const from of STATUSES.filter((status) => !LEGAL.has(`${action}:${status}`))) {
      it(`${action} from ${from} is an illegal transition (409)`, async () => {
        const fake = createFakeDb(seed(from));
        const actor = viewer(ACTOR[action]);
        await expectWorkflowError(
          transitionDocument(fake.as(actor), actor, {
            documentId: DOC_A,
            action,
            comment: action === "RETURN" ? "reason" : undefined,
          }),
          "ILLEGAL_TRANSITION",
          409,
        );
        expect(fake.state.documents[0]?.status).toBe(from);
        expect(fake.state.history).toEqual([]);
        expect(fake.state.audit).toEqual([]);
      });
    }
  }

  it("the owner cannot approve or return their own document", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    for (const action of ["APPROVE", "RETURN"] as const) {
      const comment = action === "RETURN" ? "x" : undefined;
      const error = await rejection(transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action, comment }));
      expect(error).toBeInstanceOf(ForbiddenError);
    }
    expect(fake.state.history).toEqual([]);
  });

  it("N+2 sees the document but does not validate it; HR neither (Q-05)", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    for (const id of [N2, HR]) {
      const error = await rejection(transitionDocument(fake.as(viewer(id)), viewer(id), { documentId: DOC_A, action: "APPROVE" }));
      expect(error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("only the owner sends: not the manager, not HR", async () => {
    const fake = createFakeDb(seed());
    for (const id of [M1, HR]) {
      const error = await rejection(transitionDocument(fake.as(viewer(id)), viewer(id), { documentId: DOC_A, action: "SEND" }));
      expect(error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("a document the viewer cannot see, or that does not exist, is not found", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    const invisible = await rejection(transitionDocument(fake.as(viewer(B)), viewer(B), { documentId: DOC_A, action: "SEND" }));
    expect(invisible).toBeInstanceOf(NotFoundError);
    const missing = await rejection(transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: 999, action: "SEND" }));
    expect(missing).toBeInstanceOf(NotFoundError);
  });

  it("an incomplete document is not sent and the missing conditions travel with the error", async () => {
    const initial = seed();
    initial.performanceGoals = initial.performanceGoals.map((g) => (g.id === 201 ? { ...g, state: "ANULOWANY" } : g));
    initial.acks = initial.acks.filter((ack) => !(ack.documentId === DOC_A && ack.templateId === 101));
    const fake = createFakeDb(initial);

    const error = await expectWorkflowError(
      transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }),
      "CONDITIONS_NOT_MET",
      409,
    );
    expect(error.missing).toEqual([
      { condition: "WF-C2", key: "workflow.conditions.valuesAcknowledged", params: {} },
      { condition: "WF-C4", key: "workflow.conditions.weightSum", params: { required: 100, current: 60 } },
    ]);
    expect(fake.state.documents[0]?.status).toBe("SZKIC");
    expect(fake.state.history).toEqual([]);
    expect(fake.state.audit).toEqual([]);
  });

  it("nothing moves in a cycle that is not open", async () => {
    const initial = seed("DO_WALIDACJI");
    initial.cycle.status = "ZAMKNIETY";
    const fake = createFakeDb(initial);
    await expectWorkflowError(
      transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }),
      "CYCLE_NOT_OPEN",
      409,
    );
  });

  it("a manager change between the permission read and the write is caught by the write itself", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"), {
      afterPermissionRead: (state) => {
        const owner = state.people.find((p) => p.id === A);
        if (owner) owner.managerId = N2;
      },
    });
    const error = await rejection(transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(fake.state.documents[0]?.status).toBe("DO_WALIDACJI");
    expect(fake.state.history).toEqual([]);
  });
});

describe("edit locks (WF-02, WF-05)", () => {
  it("in validation and after approval the owner cannot add, delete or acknowledge anything", async () => {
    for (const status of ["DO_WALIDACJI", "ZATWIERDZONY"] as const) {
      const fake = createFakeDb(seed(status));
      const db = fake.as(viewer(A)) as never;
      // Started one at a time, so each refusal is awaited before the next write begins.
      const writes = [
        () => createPerformanceGoal(db, viewer(A), { documentId: DOC_A, mode: "DRAFT", goal: { title: "New goal" } }),
        () => deletePerformanceGoal(db, viewer(A), { goalId: 202 }),
        () =>
          createDevelopmentGoal(db, viewer(A), {
            documentId: DOC_A,
            mode: "DRAFT",
            goal: { competencyId: 1, actionTitle: "New action" },
          }),
        () => acknowledgeGroupGoal(db, viewer(A), { documentId: DOC_A, templateId: 100 }),
      ];
      for (const write of writes) {
        expect(await rejection(write())).toMatchObject({ code: "NOT_EDITABLE" });
      }
      expect(fake.state.audit).toEqual([]);
    }
  });

  it("an approved document still takes progress updates on goals in the plan, audited", async () => {
    const fake = createFakeDb(seed("ZATWIERDZONY"));
    const db = fake.as(viewer(A));
    await expect(updateGoalProgress(db, viewer(A), { part: "PERFORMANCE", goalId: 200, progress: "UKONCZONY" })).resolves.toEqual({
      goalId: 200,
      progress: "UKONCZONY",
    });
    await updateGoalProgress(db, viewer(A), { part: "DEVELOPMENT", goalId: 300, progress: "W_TRAKCIE" });

    expect(fake.state.performanceGoals.find((g) => g.id === 200)?.progress).toBe(100);
    expect(fake.state.developmentGoals.find((g) => g.id === 300)?.progress).toBe(50);
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        entity: "performance_goal",
        entityId: "200",
        action: "UPDATE_PROGRESS",
        before: { documentId: DOC_A, progress: "DO_ROZPOCZECIA" },
        after: { documentId: DOC_A, progress: "UKONCZONY" },
      }),
      expect.objectContaining({ entity: "development_goal", entityId: "300", action: "UPDATE_PROGRESS" }),
    ]);
  });

  it("an unchanged progress writes nothing", async () => {
    const fake = createFakeDb(seed("ZATWIERDZONY"));
    await updateGoalProgress(fake.as(viewer(A)), viewer(A), { part: "PERFORMANCE", goalId: 201, progress: "W_TRAKCIE" });
    expect(fake.state.audit).toEqual([]);
  });

  it("progress is refused while in validation, for a goal not in the plan, and for anyone but the owner", async () => {
    // A draft changes progress through the goal form; in validation nothing changes.
    for (const status of ["SZKIC", "DO_WALIDACJI", "ZWROCONY"] as const) {
      const notApproved = createFakeDb(seed(status));
      await expectWorkflowError(
        updateGoalProgress(notApproved.as(viewer(A)), viewer(A), { part: "PERFORMANCE", goalId: 200, progress: "W_TRAKCIE" }),
        "NOT_EDITABLE",
        409,
      );
    }

    const approved = createFakeDb(seed("ZATWIERDZONY"));
    await expectWorkflowError(
      updateGoalProgress(approved.as(viewer(A)), viewer(A), { part: "PERFORMANCE", goalId: 202, progress: "W_TRAKCIE" }),
      "GOAL_NOT_IN_PLAN",
      409,
    );
    const byManager = await rejection(
      updateGoalProgress(approved.as(viewer(M1)), viewer(M1), { part: "PERFORMANCE", goalId: 200, progress: "UKONCZONY" }),
    );
    expect(byManager).toBeInstanceOf(ForbiddenError);
    const unknownGoal = await rejection(
      updateGoalProgress(approved.as(viewer(A)), viewer(A), { part: "PERFORMANCE", goalId: 999, progress: "UKONCZONY" }),
    );
    expect(unknownGoal).toBeInstanceOf(NotFoundError);
    await expectWorkflowError(
      updateGoalProgress(approved.as(viewer(A)), viewer(A), { part: "PERFORMANCE", goalId: 200, progress: "DONE" }),
      "INVALID_INPUT",
      400,
    );
    expect(approved.state.audit).toEqual([]);
  });
});

describe("N+1 changes goals during validation (WF-04)", () => {
  /** A's document in `status`, with draft goal 202 titled "Draft" and not yet flagged. */
  function wf04Seed(status: DocumentStatusValue): State {
    const initial = seed(status);
    initial.performanceGoals = initial.performanceGoals.map((g) =>
      g.id === 202 ? { ...g, title: "Draft", changedByManager: false } : g,
    );
    return initial;
  }
  const edit = { goalId: 202, goal: { title: "Clarified by N+1" } };

  it("the validator changes a goal: state kept, flag set, audit has the previous and the new values", async () => {
    const fake = createFakeDb(wf04Seed("DO_WALIDACJI"));
    const updated = await updatePerformanceGoalAsValidator(fake.as(viewer(M1)), viewer(M1), edit);
    expect(updated).toMatchObject({ id: 202, title: "Clarified by N+1", state: "SZKIC", changedByManager: true });
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        actorId: M1,
        entity: "performance_goal",
        entityId: "202",
        action: "UPDATE_BY_MANAGER",
        before: expect.objectContaining({ documentId: DOC_A, title: "Draft", state: "SZKIC", changedByManager: false }),
        after: expect.objectContaining({ documentId: DOC_A, title: "Clarified by N+1", state: "SZKIC", changedByManager: true }),
      }),
    ]);

    // Saving the same content again writes nothing.
    await updatePerformanceGoalAsValidator(fake.as(viewer(M1)), viewer(M1), edit);
    expect(fake.state.audit).toHaveLength(1);
  });

  it("the HR-set override validator edits too; a goal in the plan stays in the plan (WF-09)", async () => {
    const fake = createFakeDb(seed("SZKIC", "DO_WALIDACJI"));
    const goal = {
      title: "Ship line 3",
      description: "Commission line 3.",
      measures: "Line running",
      dueDate: "2027-11-30",
      progress: "DO_ROZPOCZECIA",
      targetTypeId: 1,
      target: "Running",
      weight: 100,
    };
    const updated = await updatePerformanceGoalAsValidator(fake.as(viewer(OV)), viewer(OV), { goalId: 210, goal });
    expect(updated).toMatchObject({ state: "W_PLANIE", title: "Ship line 3", changedByManager: true });
    expect(fake.state.audit).toEqual([expect.objectContaining({ actorId: OV, action: "UPDATE_BY_MANAGER" })]);
    // The override validates in addition to the direct manager (permissions.ts), so N+1 may edit too.
    const byManager = await updatePerformanceGoalAsValidator(fake.as(viewer(M1)), viewer(M1), {
      goalId: 210,
      goal: { ...goal, weight: 90 },
    });
    expect(byManager).toMatchObject({ weight: 90, changedByManager: true });
    expect(fake.state.audit.map((row) => row.actorId)).toEqual([OV, M1]);
  });

  it("the edit button is offered to the validator only, and only while the document is in validation", async () => {
    const inValidation = createFakeDb(wf04Seed("DO_WALIDACJI"));
    const canEdit = async (fake: ReturnType<typeof createFakeDb>, id: number, cycle: "OTWARTY" | "ZAMKNIETY" = "OTWARTY") =>
      (await loadDocumentWorkflow(fake.as(viewer(id)), viewer(id), DOC_A, cycle)).canValidatorEditGoals;
    expect(await canEdit(inValidation, M1)).toBe(true);
    expect(await canEdit(inValidation, M1, "ZAMKNIETY")).toBe(false);
    for (const id of [A, N2, HR]) expect(await canEdit(inValidation, id)).toBe(false);
    expect(await canEdit(createFakeDb(wf04Seed("ZWROCONY")), M1)).toBe(false);
  });

  it("only the validator: not the owner, N+2, HR or someone who cannot see the document", async () => {
    const fake = createFakeDb(wf04Seed("DO_WALIDACJI"));
    for (const id of [A, N2, HR]) {
      expect(await rejection(updatePerformanceGoalAsValidator(fake.as(viewer(id)), viewer(id), edit))).toBeInstanceOf(ForbiddenError);
      const development = updateDevelopmentGoalAsValidator(fake.as(viewer(id)), viewer(id), {
        goalId: 300,
        goal: { competencyId: 1, actionTitle: "x" },
      });
      expect(await rejection(development)).toBeInstanceOf(ForbiddenError);
    }
    expect(await rejection(updatePerformanceGoalAsValidator(fake.as(viewer(B)), viewer(B), edit))).toBeInstanceOf(NotFoundError);
    expect(fake.state.performanceGoals.find((g) => g.id === 202)).toMatchObject({ title: "Draft", changedByManager: false });
    expect(fake.state.audit).toEqual([]);
  });

  it("only during validation and in an open cycle (409 NOT_EDITABLE otherwise)", async () => {
    const closed = wf04Seed("DO_WALIDACJI");
    closed.cycle.status = "ZAMKNIETY";
    const cases = [wf04Seed("SZKIC"), wf04Seed("ZWROCONY"), wf04Seed("ZATWIERDZONY"), closed];
    for (const initial of cases) {
      const fake = createFakeDb(initial);
      const performance = await rejection(updatePerformanceGoalAsValidator(fake.as(viewer(M1)), viewer(M1), edit));
      expect(performance).toBeInstanceOf(PerformanceGoalError);
      expect(performance).toMatchObject({ code: "NOT_EDITABLE", status: 409 });
      const development = await rejection(
        updateDevelopmentGoalAsValidator(fake.as(viewer(M1)), viewer(M1), { goalId: 300, goal: { competencyId: 1, actionTitle: "x" } }),
      );
      expect(development).toBeInstanceOf(DevelopmentGoalError);
      expect(development).toMatchObject({ code: "NOT_EDITABLE", status: 409 });
      expect(fake.state.audit).toEqual([]);
    }
  });

  it("a cancelled goal stays frozen; a state or save mode in the payload is refused", async () => {
    const initial = wf04Seed("DO_WALIDACJI");
    initial.performanceGoals = initial.performanceGoals.map((g) => (g.id === 202 ? { ...g, state: "ANULOWANY" } : g));
    const fake = createFakeDb(initial);
    const cancelled = await rejection(updatePerformanceGoalAsValidator(fake.as(viewer(M1)), viewer(M1), edit));
    expect(cancelled).toMatchObject({ code: "GOAL_CANCELLED", status: 409 });
    for (const input of [{ ...edit, mode: "PLAN" }, { goalId: 202, goal: { title: "x", state: "W_PLANIE" } }]) {
      const refused = await rejection(updatePerformanceGoalAsValidator(fake.as(viewer(M1)), viewer(M1), input));
      expect(refused).toMatchObject({ code: "INVALID_INPUT", status: 400 });
    }
  });
});

describe("loadDocumentWorkflow", () => {
  it("the owner of a draft gets the send button and the missing conditions", async () => {
    const initial = seed();
    initial.developmentGoals = [];
    const fake = createFakeDb(initial);
    const view = await loadDocumentWorkflow(fake.as(viewer(A)), viewer(A), DOC_A, "OTWARTY");
    expect(view).toMatchObject({ status: "SZKIC", isOwner: true, actions: ["SEND"] });
    expect(view.missing).toEqual([
      { condition: "WF-C5", key: "workflow.conditions.minDevelopmentGoals", params: { min: 1, current: 0 } },
    ]);
  });

  it("the validator gets approve and return; history comes oldest first with the author's name", async () => {
    const fake = createFakeDb(seed());
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" });
    const view = await loadDocumentWorkflow(fake.as(viewer(M1)), viewer(M1), DOC_A, "OTWARTY");
    expect(view).toMatchObject({ status: "DO_WALIDACJI", isOwner: false, actions: ["APPROVE", "RETURN"], missing: [] });
    expect(view.history).toEqual([
      expect.objectContaining({ fromStatus: "SZKIC", toStatus: "DO_WALIDACJI", authorName: `Test P${A}`, comment: null }),
    ]);
  });

  it("no buttons in a read-only cycle; N+2 only views", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    expect((await loadDocumentWorkflow(fake.as(viewer(M1)), viewer(M1), DOC_A, "ZAMKNIETY")).actions).toEqual([]);
    expect((await loadDocumentWorkflow(fake.as(viewer(N2)), viewer(N2), DOC_A, "OTWARTY")).actions).toEqual([]);
  });
});
