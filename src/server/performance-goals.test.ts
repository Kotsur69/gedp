import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import {
  canAddToPlan,
  goalFieldErrors,
  performanceGoalCounters,
  performanceGoalSchema,
  progressFromPercent,
  progressToPercent,
  type CountableGoal,
  type PerformanceGoalContext,
} from "@/domain/performance-goal";
import { ensureOwnDocument } from "./group-goals";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import {
  cancelPerformanceGoal,
  createPerformanceGoal,
  deletePerformanceGoal,
  loadPerformanceGoals,
  MAX_GOALS_PER_DOCUMENT,
  performanceGoalHttpStatus,
  PerformanceGoalError,
  updatePerformanceGoal,
  updatePerformanceGoalAsValidator,
} from "./performance-goals";
import { ForbiddenError, NotFoundError, type Viewer } from "./permissions";

// Synthetic target types: ids are fixed here; the DB tests use the real ids.
const CONTEXT: PerformanceGoalContext = {
  cycleYear: 2027,
  targetTypes: [
    { id: 1, code: "LICZBA", namePl: "Liczba", nameEn: "Number", isNumeric: true },
    { id: 2, code: "TEKST", namePl: "Tekst", nameEn: "Text", isNumeric: false },
    { id: 3, code: "PROCENT", namePl: "Procent", nameEn: "Percent", isNumeric: true },
  ],
};

const FULL_GOAL = {
  title: "Reduce unplanned downtime",
  description: "Cut unplanned downtime on line 2.",
  measures: "Hours of downtime per quarter",
  dueDate: "2027-11-30",
  progress: "W_TRAKCIE",
  targetTypeId: 1,
  target: 120,
  weight: 40,
};

const BAD_WEIGHTS = [0, 101, -5, 12.5];

function errorsOf(mode: "DRAFT" | "PLAN", goal: unknown, context: PerformanceGoalContext = CONTEXT) {
  const parsed = performanceGoalSchema(mode, context).safeParse(goal);
  return parsed.success ? {} : goalFieldErrors(parsed.error);
}

describe("shared goal schema - weight (G2-17, G2-23)", () => {
  it.each(BAD_WEIGHTS)("rejects weight %s in both save modes", (weight) => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, weight })).toEqual({ weight: "WEIGHT_INVALID" });
    expect(errorsOf("DRAFT", { title: "Draft", weight })).toEqual({ weight: "WEIGHT_INVALID" });
  });

  it("accepts the bounds 1 and 100 and refuses a numeric string", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, weight: 1 })).toEqual({});
    expect(errorsOf("PLAN", { ...FULL_GOAL, weight: 100 })).toEqual({});
    expect(errorsOf("PLAN", { ...FULL_GOAL, weight: "30" })).toEqual({ weight: "WEIGHT_INVALID" });
  });
});

describe("shared goal schema - due date (G2-13)", () => {
  it("rejects a date outside the cycle year", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, dueDate: "2026-12-31" })).toEqual({ dueDate: "DATE_OUTSIDE_CYCLE" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, dueDate: "2028-01-01" })).toEqual({ dueDate: "DATE_OUTSIDE_CYCLE" });
    expect(errorsOf("DRAFT", { title: "Draft", dueDate: "2026-06-01" })).toEqual({ dueDate: "DATE_OUTSIDE_CYCLE" });
  });

  it("accepts the first and last day of the cycle year", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, dueDate: "2027-01-01" })).toEqual({});
    expect(errorsOf("PLAN", { ...FULL_GOAL, dueDate: "2027-12-31" })).toEqual({});
  });

  it("rejects malformed and impossible dates ('Please provide a valid date')", () => {
    for (const dueDate of ["2027-02-30", "30.11.2027", "2027-13-01", "tomorrow", 20271130]) {
      expect(errorsOf("PLAN", { ...FULL_GOAL, dueDate })).toEqual({ dueDate: "DATE_INVALID" });
    }
  });

  it("a malformed date reports DATE_INVALID only, not also 'outside the cycle'", () => {
    const parsed = performanceGoalSchema("PLAN", CONTEXT).safeParse({ ...FULL_GOAL, dueDate: "2027-02-30" });
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual(["DATE_INVALID"]);
  });
});

describe("shared goal schema - save modes (G2-20, G2-21)", () => {
  it("PLAN requires every field (Q-16: title, description and weight too)", () => {
    expect(errorsOf("PLAN", { title: " " })).toEqual({
      title: "TITLE_REQUIRED",
      description: "DESCRIPTION_REQUIRED",
      measures: "MEASURES_REQUIRED",
      dueDate: "DATE_REQUIRED",
      target: "TARGET_REQUIRED",
      weight: "WEIGHT_REQUIRED",
    });
  });

  it("DRAFT accepts partial data but still needs a title", () => {
    expect(errorsOf("DRAFT", { title: "Only a title", description: "", dueDate: "", weight: null })).toEqual({});
    expect(errorsOf("DRAFT", {})).toEqual({ title: "TITLE_REQUIRED" });
  });

  it("defaults progress to DO_ROZPOCZECIA and the target type to Tekst", () => {
    expect(performanceGoalSchema("DRAFT", CONTEXT).parse({ title: "  Draft  " })).toEqual({
      title: "Draft",
      description: null,
      measures: null,
      dueDate: null,
      progress: "DO_ROZPOCZECIA",
      targetTypeId: 2,
      target: null,
      weight: null,
    });
  });

  it("canAddToPlan mirrors the PLAN validation", () => {
    expect(canAddToPlan(FULL_GOAL, CONTEXT)).toBe(true);
    expect(canAddToPlan({ ...FULL_GOAL, measures: "" }, CONTEXT)).toBe(false);
  });

  it("refuses unknown keys, so state or ownership cannot be smuggled in", () => {
    expect(performanceGoalSchema("PLAN", CONTEXT).safeParse({ ...FULL_GOAL, state: "W_PLANIE" }).success).toBe(false);
  });

  it("refuses an unknown progress value and an unknown target type", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, progress: "DONE" })).toEqual({ progress: "PROGRESS_INVALID" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, targetTypeId: 99 })).toEqual({ targetTypeId: "TARGET_TYPE_INVALID" });
  });

  it("refuses text the database or the audit log cannot store (NUL, lone surrogate)", () => {
    expect(errorsOf("DRAFT", { title: "a\u0000b" })).toEqual({ title: "INVALID_INPUT" });
    expect(errorsOf("DRAFT", { title: `broken ${String.fromCharCode(0xd800)}` })).toEqual({ title: "INVALID_INPUT" });
  });

  it("refuses over-long text", () => {
    expect(errorsOf("DRAFT", { title: "x".repeat(201) })).toEqual({ title: "TEXT_TOO_LONG" });
  });
});

describe("shared goal schema - target (G2-15, G2-16)", () => {
  const plan = performanceGoalSchema("PLAN", CONTEXT);

  it("numeric types need a number; a decimal comma is stored with a dot", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, target: "a lot" })).toEqual({ target: "TARGET_NOT_NUMBER" });
    expect(plan.parse({ ...FULL_GOAL, target: "12,5" }).target).toBe("12.5");
    expect(plan.parse({ ...FULL_GOAL, targetTypeId: 3, target: 7.5 }).target).toBe("7.5");
  });

  it("a JS number in exponent form or with too many digits is refused like typed text", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, target: 1e21 })).toEqual({ target: "TARGET_NOT_NUMBER" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, target: 1e-7 })).toEqual({ target: "TARGET_NOT_NUMBER" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, target: "1".repeat(16) })).toEqual({ target: "TARGET_NOT_NUMBER" });
  });

  it("Tekst keeps free text as typed", () => {
    expect(plan.parse({ ...FULL_GOAL, targetTypeId: 2, target: "Procedure live, v1,2" }).target).toBe("Procedure live, v1,2");
  });

  it("an empty target in PLAN mode is 'Please define a target'", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, target: "  " })).toEqual({ target: "TARGET_REQUIRED" });
  });
});

describe("progress mapping and counters (G2-04, G2-05, G2-08)", () => {
  it("maps stored percent to the three statuses and keeps an unchanged value", () => {
    expect([0, 1, 75, 100].map(progressFromPercent)).toEqual(["DO_ROZPOCZECIA", "W_TRAKCIE", "W_TRAKCIE", "UKONCZONY"]);
    expect(progressToPercent("W_TRAKCIE", 75)).toBe(75);
    expect(progressToPercent("W_TRAKCIE", 0)).toBe(50);
    expect(progressToPercent("UKONCZONY")).toBe(100);
  });

  it("counts states, N+1 changes, progress and the in-plan weight; cancelled goals only in 'Anulowane'", () => {
    const goal = (over: Partial<CountableGoal>): CountableGoal => ({
      state: "W_PLANIE",
      progress: "DO_ROZPOCZECIA",
      weight: 10,
      changedByManager: false,
      ...over,
    });
    expect(
      performanceGoalCounters([
        goal({ weight: 60, progress: "W_TRAKCIE" }),
        goal({ weight: 30, changedByManager: true }),
        goal({ state: "SZKIC", weight: null }),
        goal({ state: "ANULOWANY", weight: 50, progress: "UKONCZONY", changedByManager: true }),
      ]),
    ).toEqual({
      notInPlan: 1,
      inPlan: 2,
      changedByManager: 1,
      cancelled: 1,
      progress: { DO_ROZPOCZECIA: 2, W_TRAKCIE: 1, UKONCZONY: 0 },
      totalWeightInPlan: 90,
    });
  });
});

describe("server operations - an invalid payload is a 400 before any database call (G2-24)", () => {
  // A db whose every use fails the test: proves validation runs first.
  const untouchable = {
    $transaction: () => {
      throw new Error("database must not be touched");
    },
  } as unknown as Parameters<typeof createPerformanceGoal>[0];
  const viewer: Viewer = { id: 1, isHrAdmin: false };

  async function caught(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => null,
      (thrown: unknown) => thrown,
    );
  }

  async function expect400(promise: Promise<unknown>, code: string): Promise<void> {
    const error = await caught(promise);
    expect(error).toBeInstanceOf(PerformanceGoalError);
    expect(error).toMatchObject({ code, status: 400 });
    expect(performanceGoalHttpStatus(error)).toBe(400);
  }

  it.each(BAD_WEIGHTS)("weight %s is refused on create and update", async (weight) => {
    await expect400(
      createPerformanceGoal(untouchable, viewer, { documentId: 1, mode: "PLAN", goal: { ...FULL_GOAL, weight } }),
      "WEIGHT_INVALID",
    );
    await expect400(
      updatePerformanceGoal(untouchable, viewer, { goalId: 1, mode: "DRAFT", goal: { title: "x", weight } }),
      "WEIGHT_INVALID",
    );
    await expect400(updatePerformanceGoalAsValidator(untouchable, viewer, { goalId: 1, goal: { title: "x", weight } }), "WEIGHT_INVALID");
  });

  it("[WF-04] the validator's payload carries no save mode, state or flag", async () => {
    await expect400(updatePerformanceGoalAsValidator(untouchable, viewer, { goalId: 1, mode: "PLAN", goal: FULL_GOAL }), "INVALID_INPUT");
    await expect400(
      updatePerformanceGoalAsValidator(untouchable, viewer, { goalId: 1, goal: { ...FULL_GOAL, changedByManager: false } }),
      "INVALID_INPUT",
    );
  });

  it("a malformed envelope or goal is refused", async () => {
    await expect400(createPerformanceGoal(untouchable, viewer, null), "INVALID_INPUT");
    await expect400(createPerformanceGoal(untouchable, viewer, { documentId: 1, mode: "SEND", goal: FULL_GOAL }), "INVALID_INPUT");
    await expect400(deletePerformanceGoal(untouchable, viewer, { goalId: "1" }), "INVALID_INPUT");
    await expect400(cancelPerformanceGoal(untouchable, viewer, { goalId: 1, state: "W_PLANIE" }), "INVALID_INPUT");
    await expect400(
      createPerformanceGoal(untouchable, viewer, { documentId: 1, mode: "PLAN", goal: { ...FULL_GOAL, dueDate: "2027-02-30" } }),
      "DATE_INVALID",
    );
    await expect400(
      createPerformanceGoal(untouchable, viewer, { documentId: 1, mode: "PLAN", goal: { ...FULL_GOAL, documentId: 7 } }),
      "INVALID_INPUT",
    );
  });

  it("field issues travel with the error, for the form", async () => {
    const error = await caught(createPerformanceGoal(untouchable, viewer, { documentId: 1, mode: "PLAN", goal: { title: "x" } }));
    expect(error).toBeInstanceOf(PerformanceGoalError);
    expect((error as PerformanceGoalError).issues.map((issue) => issue.field)).toEqual([
      "description",
      "measures",
      "dueDate",
      "target",
      "weight",
    ]);
  });

  it("maps access errors to 404 / 403, rule conflicts to 409 and anything else to 500", () => {
    expect(performanceGoalHttpStatus(new NotFoundError())).toBe(404);
    expect(performanceGoalHttpStatus(new ForbiddenError("edit"))).toBe(403);
    expect(performanceGoalHttpStatus(new PerformanceGoalError("NOT_EDITABLE"))).toBe(409);
    expect(performanceGoalHttpStatus(new Error("boom"))).toBe(500);
  });
});

describe.skipIf(!hasTestDb)("performance goals - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  let cycleId: number;
  let numericTypeId: number;

  const id = (amei: string): number => {
    const value = ids.get(amei);
    if (value === undefined) throw new Error(`unknown test person ${amei}`);
    return value;
  };
  const as = (amei: string): Viewer => ({ id: id(amei), isHrAdmin: amei === "HR" });
  const planGoal = () => ({ ...FULL_GOAL, targetTypeId: numericTypeId });

  async function ownDocument(amei: string): Promise<number> {
    const doc = await ensureOwnDocument(db, as(amei), { id: cycleId, status: "OTWARTY" });
    if (!doc) throw new Error("document expected in an open cycle");
    return doc.id;
  }

  /** Send + return by N+1: the document has been sent and is editable again. */
  async function sendAndReturn(documentId: number): Promise<void> {
    await db.documentStatusHistory.createMany({
      data: [
        { documentId, fromStatus: "SZKIC", toStatus: "DO_WALIDACJI", authorId: id("A") },
        { documentId, fromStatus: "DO_WALIDACJI", toStatus: "ZWROCONY", authorId: id("M1") },
      ],
    });
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "ZWROCONY" } });
  }

  async function expectCode(promise: Promise<unknown>, code: string, status: number): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(PerformanceGoalError);
    await expect(promise).rejects.toMatchObject({ code, status });
  }

  // M1 -> {A, B}; HR is admin and nobody's manager.
  beforeEach(async () => {
    await resetTestDb(db);
    ids = await insertPeople(db, [
      { amei: "M1", managerAmei: null },
      { amei: "A", managerAmei: "M1" },
      { amei: "B", managerAmei: "M1" },
      { amei: "HR", managerAmei: null },
    ]);
    await db.employee.update({ where: { id: id("HR") }, data: { isHrAdmin: true } });
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);
    cycleId = (await db.cycle.create({ data: { year: 2027, status: "OTWARTY" } })).id;

    // HR-05: target types belong to the cycle, so resetTestDb's cycle truncate clears them too.
    const createType = (code: string, isNumeric: boolean) =>
      db.targetType.create({ data: { cycleId, code, namePl: code, nameEn: code, isNumeric } });
    numericTypeId = (await createType("LICZBA", true)).id;
    await createType("TEKST", false);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("[G2-20] 'Zapisz i zamknij' stores a partial draft with defaults; 'Dodaj do planu' stores W_PLANIE; both audited", async () => {
    const documentId = await ownDocument("A");
    const draft = await createPerformanceGoal(db, as("A"), { documentId, mode: "DRAFT", goal: { title: "Draft" } });
    expect(draft).toMatchObject({ state: "SZKIC", progress: "DO_ROZPOCZECIA", targetTypeCode: "TEKST", weight: null });

    const planned = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    expect(planned).toMatchObject({ state: "W_PLANIE", dueDate: "2027-11-30", target: "120", weight: 40 });
    expect((await db.performanceGoal.findUniqueOrThrow({ where: { id: planned.id } })).progress).toBe(50);

    const view = await loadPerformanceGoals(db, as("A"), documentId, "OTWARTY");
    expect(view.canChange).toBe(true);
    expect(view.counters).toMatchObject({ notInPlan: 1, inPlan: 1, totalWeightInPlan: 40 });
    expect(await db.auditLog.count({ where: { entity: "performance_goal", action: "CREATE" } })).toBe(2);
  });

  it("[G2-13] a date outside the cycle is refused with 400 and nothing is written", async () => {
    const documentId = await ownDocument("A");
    await expectCode(
      createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: { ...planGoal(), dueDate: "2026-12-31" } }),
      "DATE_OUTSIDE_CYCLE",
      400,
    );
    expect(await db.performanceGoal.count()).toBe(0);
  });

  it("[G2-16] a non-numeric target for a numeric type is refused with 400", async () => {
    const documentId = await ownDocument("A");
    await expectCode(
      createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: { ...planGoal(), target: "many" } }),
      "TARGET_NOT_NUMBER",
      400,
    );
  });

  it("update moves a draft into the plan, audits before/after and skips unchanged saves", async () => {
    const documentId = await ownDocument("A");
    const draft = await createPerformanceGoal(db, as("A"), { documentId, mode: "DRAFT", goal: { title: "Draft" } });
    const planned = await updatePerformanceGoal(db, as("A"), { goalId: draft.id, mode: "PLAN", goal: planGoal() });
    expect(planned).toMatchObject({ id: draft.id, state: "W_PLANIE", title: FULL_GOAL.title });
    await updatePerformanceGoal(db, as("A"), { goalId: draft.id, mode: "PLAN", goal: planGoal() });

    const audit = await db.auditLog.findMany({ where: { entity: "performance_goal", action: "UPDATE" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toMatchObject({ documentId, title: "Draft", state: "SZKIC" });
    expect(audit[0]?.after).toMatchObject({ documentId, state: "W_PLANIE", weight: 40 });
  });

  it("'Zapisz i zamknij' on a goal already in the plan keeps it in the plan and still needs every field", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });

    const saved = await updatePerformanceGoal(db, as("A"), {
      goalId: goal.id,
      mode: "DRAFT",
      goal: { ...planGoal(), title: "Renamed" },
    });
    expect(saved).toMatchObject({ state: "W_PLANIE", title: "Renamed" });
    await expectCode(
      updatePerformanceGoal(db, as("A"), { goalId: goal.id, mode: "DRAFT", goal: { title: "Renamed" } }),
      "DESCRIPTION_REQUIRED",
      400,
    );
    expect((await loadPerformanceGoals(db, as("A"), documentId, "OTWARTY")).counters.totalWeightInPlan).toBe(40);
  });

  it(`refuses more than ${MAX_GOALS_PER_DOCUMENT} goals on one document`, async () => {
    const documentId = await ownDocument("A");
    await db.performanceGoal.createMany({
      data: Array.from({ length: MAX_GOALS_PER_DOCUMENT }, (_, n) => ({ documentId, title: `Goal ${n}` })),
    });
    await expectCode(
      createPerformanceGoal(db, as("A"), { documentId, mode: "DRAFT", goal: { title: "One too many" } }),
      "TOO_MANY_GOALS",
      409,
    );
  });

  it("[ACC-10] another user's goal is refused: B can neither read, add to, edit, delete nor cancel A's goals", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });

    await expect(loadPerformanceGoals(db, as("B"), documentId, "OTWARTY")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createPerformanceGoal(db, as("B"), { documentId, mode: "DRAFT", goal: { title: "Planted" } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updatePerformanceGoal(db, as("B"), { goalId: goal.id, mode: "PLAN", goal: { ...planGoal(), title: "Hijack" } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePerformanceGoal(db, as("B"), { goalId: goal.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelPerformanceGoal(db, as("B"), { goalId: goal.id })).rejects.toBeInstanceOf(NotFoundError);
    // A goal id that does not exist looks the same as an invisible one.
    await expect(deletePerformanceGoal(db, as("B"), { goalId: goal.id + 1000 })).rejects.toBeInstanceOf(NotFoundError);

    expect(await db.performanceGoal.count()).toBe(1);
    expect(await db.performanceGoal.findUniqueOrThrow({ where: { id: goal.id } })).toMatchObject({
      title: FULL_GOAL.title,
      state: "W_PLANIE",
    });
  });

  it("[ACC-11][ACC-13] the manager reads read-only; neither manager nor HR may write the owner's goals", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    expect((await loadPerformanceGoals(db, as("M1"), documentId, "OTWARTY")).canChange).toBe(false);

    await expect(
      updatePerformanceGoal(db, as("M1"), { goalId: goal.id, mode: "PLAN", goal: planGoal() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deletePerformanceGoal(db, as("HR"), { goalId: goal.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.performanceGoal.count()).toBe(1);
  });

  it("[G2-25] delete works before the document is sent; afterwards only cancel", async () => {
    const documentId = await ownDocument("A");
    const first = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    const second = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });

    await expectCode(cancelPerformanceGoal(db, as("A"), { goalId: first.id }), "DOCUMENT_NOT_SENT", 409);
    await deletePerformanceGoal(db, as("A"), { goalId: first.id });
    expect(await db.performanceGoal.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { entity: "performance_goal", action: "DELETE" } })).toBe(1);

    await sendAndReturn(documentId);
    await expectCode(deletePerformanceGoal(db, as("A"), { goalId: second.id }), "DOCUMENT_ALREADY_SENT", 409);
    expect(await db.performanceGoal.count()).toBe(1);
  });

  it("[G2-25] 'Anuluj cel' keeps the goal as ANULOWANY; it is counted, audited and frozen", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    await sendAndReturn(documentId);

    const cancelled = await cancelPerformanceGoal(db, as("A"), { goalId: goal.id });
    expect(cancelled.state).toBe("ANULOWANY");
    expect(await db.performanceGoal.findUniqueOrThrow({ where: { id: goal.id } })).toMatchObject({
      state: "ANULOWANY",
      title: FULL_GOAL.title,
    });
    const view = await loadPerformanceGoals(db, as("A"), documentId, "OTWARTY");
    expect(view.counters).toMatchObject({ inPlan: 0, cancelled: 1, totalWeightInPlan: 0 });

    const audit = await db.auditLog.findFirstOrThrow({ where: { entity: "performance_goal", action: "CANCEL" } });
    expect(audit).toMatchObject({
      actorId: id("A"),
      before: { documentId, state: "W_PLANIE" },
      after: { documentId, state: "ANULOWANY" },
    });

    await expectCode(cancelPerformanceGoal(db, as("A"), { goalId: goal.id }), "GOAL_CANCELLED", 409);
    await expectCode(
      updatePerformanceGoal(db, as("A"), { goalId: goal.id, mode: "DRAFT", goal: { title: "Revived" } }),
      "GOAL_CANCELLED",
      409,
    );
  });

  it("nothing changes while the document is with the validator or the cycle is closed", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "DRAFT", goal: { title: "Draft" } });

    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });
    await expectCode(
      updatePerformanceGoal(db, as("A"), { goalId: goal.id, mode: "DRAFT", goal: { title: "Changed" } }),
      "NOT_EDITABLE",
      409,
    );
    expect((await loadPerformanceGoals(db, as("A"), documentId, "OTWARTY")).canChange).toBe(false);

    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "SZKIC" } });
    await db.cycle.update({ where: { id: cycleId }, data: { status: "ZAMKNIETY" } });
    await expectCode(
      createPerformanceGoal(db, as("A"), { documentId, mode: "DRAFT", goal: { title: "Late" } }),
      "NOT_EDITABLE",
      409,
    );
    expect(await db.performanceGoal.count()).toBe(1);
  });

  it("[WF-04] N+1 changes a goal in validation: flag, counters and an audited before/after; the owner keeps seeing it", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });

    const changed = await updatePerformanceGoalAsValidator(db, as("M1"), {
      goalId: goal.id,
      goal: { ...planGoal(), weight: 30, title: "Sharper goal" },
    });
    expect(changed).toMatchObject({ state: "W_PLANIE", weight: 30, title: "Sharper goal", changedByManager: true });
    expect((await loadPerformanceGoals(db, as("M1"), documentId, "OTWARTY")).counters.changedByManager).toBe(1);

    const audit = await db.auditLog.findFirstOrThrow({ where: { entity: "performance_goal", action: "UPDATE_BY_MANAGER" } });
    expect(audit).toMatchObject({
      actorId: id("M1"),
      before: { documentId, title: FULL_GOAL.title, weight: 40, changedByManager: false },
      after: { documentId, title: "Sharper goal", weight: 30, changedByManager: true },
    });

    // A goal in the plan stays complete; a missing field is refused like "Dodaj do planu".
    await expectCode(
      updatePerformanceGoalAsValidator(db, as("M1"), { goalId: goal.id, goal: { ...planGoal(), description: "" } }),
      "DESCRIPTION_REQUIRED",
      400,
    );

    // After the return the owner sees the marker and the counter.
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "ZWROCONY" } });
    const ownerView = await loadPerformanceGoals(db, as("A"), documentId, "OTWARTY");
    expect(ownerView.goals[0]?.changedByManager).toBe(true);
    expect(ownerView.counters.changedByManager).toBe(1);
    await expectCode(
      updatePerformanceGoalAsValidator(db, as("M1"), { goalId: goal.id, goal: planGoal() }),
      "NOT_EDITABLE",
      409,
    );
  });

  it("[WF-04] only the validator writes during validation: not the owner, a colleague or HR", async () => {
    const documentId = await ownDocument("A");
    const goal = await createPerformanceGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });
    const input = { goalId: goal.id, goal: { ...planGoal(), title: "Hijack" } };

    await expect(updatePerformanceGoalAsValidator(db, as("A"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updatePerformanceGoalAsValidator(db, as("HR"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updatePerformanceGoalAsValidator(db, as("B"), input)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.performanceGoal.findUniqueOrThrow({ where: { id: goal.id } })).toMatchObject({
      title: FULL_GOAL.title,
      changedByManager: false,
    });
    expect(await db.auditLog.count({ where: { action: "UPDATE_BY_MANAGER" } })).toBe(0);
  });
});
