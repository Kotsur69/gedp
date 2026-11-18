import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import {
  developmentGoalCounters,
  developmentGoalFieldErrors,
  developmentGoalSchema,
  type CountableDevelopmentGoal,
  type DevelopmentGoalContext,
} from "@/domain/development-goal";
import {
  cancelDevelopmentGoal,
  createDevelopmentGoal,
  deleteDevelopmentGoal,
  DevelopmentGoalError,
  developmentGoalHttpStatus,
  loadDevelopmentGoalContext,
  loadDevelopmentGoals,
  updateDevelopmentGoal,
  updateDevelopmentGoalAsValidator,
} from "./development-goals";
import { ensureOwnDocument } from "./group-goals";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import { ForbiddenError, NotFoundError, type Viewer } from "./permissions";

// Synthetic catalogue: competency 3 and area 12 are deactivated by HR.
const CONTEXT: DevelopmentGoalContext = {
  cycleYear: 2027,
  competencies: [
    { id: 1, namePl: "Innowacyjność", nameEn: "Innovation", isActive: true },
    { id: 2, namePl: "Odwaga", nameEn: "Courage to Challenge", isActive: true },
    { id: 3, namePl: "Stara", nameEn: "Retired", isActive: false },
  ],
  developmentAreas: [
    { id: 11, namePl: "Obecna rola", nameEn: "Current role", isActive: true },
    { id: 12, namePl: "Stary obszar", nameEn: "Old area", isActive: false },
  ],
};

const FULL_GOAL = {
  competencyId: 1,
  developmentAreaId: 11,
  actionTitle: "Seek assignments that need more independence",
  actionDescription: "Projects that need delegation and coordination.",
  startDate: "2027-01-02",
  endDate: "2027-12-31",
  progress: "W_TRAKCIE",
};

function errorsOf(mode: "DRAFT" | "PLAN", goal: unknown) {
  const parsed = developmentGoalSchema(mode, CONTEXT).safeParse(goal);
  return parsed.success ? {} : developmentGoalFieldErrors(parsed.error);
}

describe("development goal schema - common fields only (Q-04)", () => {
  it("accepts the full common field set", () => {
    expect(developmentGoalSchema("PLAN", CONTEXT).parse(FULL_GOAL)).toEqual(FULL_GOAL);
  });

  it("refuses weight, target type, target and measures: they wait for Q-04", () => {
    for (const extra of [{ weight: 40 }, { targetTypeId: 1 }, { target: "x" }, { measures: "x" }]) {
      expect(developmentGoalSchema("PLAN", CONTEXT).safeParse({ ...FULL_GOAL, ...extra }).success).toBe(false);
    }
  });

  it("refuses unknown keys, so state or ownership cannot be smuggled in", () => {
    expect(developmentGoalSchema("DRAFT", CONTEXT).safeParse({ ...FULL_GOAL, state: "W_PLANIE" }).success).toBe(false);
  });
});

describe("development goal schema - save modes", () => {
  it("PLAN requires every common field", () => {
    expect(errorsOf("PLAN", {})).toEqual({
      competencyId: "COMPETENCY_REQUIRED",
      actionTitle: "ACTION_TITLE_REQUIRED",
      developmentAreaId: "AREA_REQUIRED",
      actionDescription: "ACTION_DESCRIPTION_REQUIRED",
      startDate: "DATE_REQUIRED",
      endDate: "DATE_REQUIRED",
    });
  });

  it("DRAFT needs only the competency and the action title; progress defaults to 'Do rozpoczęcia'", () => {
    expect(errorsOf("DRAFT", { actionTitle: " " })).toEqual({
      competencyId: "COMPETENCY_REQUIRED",
      actionTitle: "ACTION_TITLE_REQUIRED",
    });
    expect(developmentGoalSchema("DRAFT", CONTEXT).parse({ competencyId: 2, actionTitle: "  Mentoring  " })).toEqual({
      competencyId: 2,
      developmentAreaId: null,
      actionTitle: "Mentoring",
      actionDescription: null,
      startDate: null,
      endDate: null,
      progress: "DO_ROZPOCZECIA",
    });
  });
});

describe("development goal schema - catalogue (G3-16, G3-20)", () => {
  it("only active competencies and areas are selectable", () => {
    expect(errorsOf("DRAFT", { ...FULL_GOAL, competencyId: 3 })).toEqual({ competencyId: "COMPETENCY_INACTIVE" });
    expect(errorsOf("DRAFT", { ...FULL_GOAL, developmentAreaId: 12 })).toEqual({ developmentAreaId: "AREA_INACTIVE" });
  });

  it("ids outside the cycle's catalogue are invalid", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, competencyId: 99 })).toEqual({ competencyId: "COMPETENCY_INVALID" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, developmentAreaId: 99 })).toEqual({ developmentAreaId: "AREA_INVALID" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, competencyId: "1" })).toEqual({ competencyId: "COMPETENCY_INVALID" });
  });

  it("without a context (pre-transaction check) the catalogue is not judged", () => {
    expect(developmentGoalSchema("PLAN").safeParse({ ...FULL_GOAL, competencyId: 3 }).success).toBe(true);
  });
});

describe("development goal schema - start-end range (G3-12)", () => {
  it("refuses an end before the start", () => {
    expect(errorsOf("DRAFT", { ...FULL_GOAL, startDate: "2027-06-01", endDate: "2027-05-31" })).toEqual({
      endDate: "END_BEFORE_START",
    });
    expect(errorsOf("PLAN", { ...FULL_GOAL, startDate: "2027-06-01", endDate: "2027-06-01" })).toEqual({});
  });

  it("keeps both dates inside the cycle year and refuses malformed dates", () => {
    expect(errorsOf("PLAN", { ...FULL_GOAL, startDate: "2026-12-31" })).toEqual({ startDate: "DATE_OUTSIDE_CYCLE" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, endDate: "2028-01-01" })).toEqual({ endDate: "DATE_OUTSIDE_CYCLE" });
    expect(errorsOf("PLAN", { ...FULL_GOAL, endDate: "2027-02-30" })).toEqual({ endDate: "DATE_INVALID" });
  });
});

describe("development goal counters (G3-04)", () => {
  it("counts states, N+1 changes and progress; cancelled goals only in 'Anulowane'", () => {
    const goal = (over: Partial<CountableDevelopmentGoal>): CountableDevelopmentGoal => ({
      state: "W_PLANIE",
      progress: "DO_ROZPOCZECIA",
      changedByManager: false,
      ...over,
    });
    expect(
      developmentGoalCounters([
        goal({ progress: "W_TRAKCIE" }),
        goal({ changedByManager: true }),
        goal({ state: "SZKIC" }),
        goal({ state: "ANULOWANY", progress: "UKONCZONY" }),
      ]),
    ).toEqual({
      drafts: 1,
      inPlan: 2,
      changedByManager: 1,
      cancelled: 1,
      progress: { DO_ROZPOCZECIA: 2, W_TRAKCIE: 1, UKONCZONY: 0 },
    });
  });
});

describe("server operations - an invalid payload is a 400 before any database call", () => {
  const untouchable = {
    $transaction: () => {
      throw new Error("database must not be touched");
    },
  } as unknown as Parameters<typeof createDevelopmentGoal>[0];
  const viewer: Viewer = { id: 1, isHrAdmin: false };

  async function expect400(promise: Promise<unknown>, code: string): Promise<void> {
    const error = await promise.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(DevelopmentGoalError);
    expect(error).toMatchObject({ code, status: 400 });
    expect(developmentGoalHttpStatus(error)).toBe(400);
  }

  it("refuses malformed envelopes, a weight field and an inverted range", async () => {
    await expect400(createDevelopmentGoal(untouchable, viewer, null), "INVALID_INPUT");
    await expect400(
      createDevelopmentGoal(untouchable, viewer, { documentId: 1, mode: "PLAN", goal: { ...FULL_GOAL, weight: 30 } }),
      "INVALID_INPUT",
    );
    await expect400(
      updateDevelopmentGoal(untouchable, viewer, {
        goalId: 1,
        mode: "DRAFT",
        goal: { ...FULL_GOAL, startDate: "2027-09-01", endDate: "2027-01-01" },
      }),
      "END_BEFORE_START",
    );
    await expect400(deleteDevelopmentGoal(untouchable, viewer, { goalId: "1" }), "INVALID_INPUT");
    await expect400(cancelDevelopmentGoal(untouchable, viewer, { goalId: 1, state: "W_PLANIE" }), "INVALID_INPUT");
    // WF-04: the validator's payload has no save mode and is checked like any other.
    await expect400(updateDevelopmentGoalAsValidator(untouchable, viewer, { goalId: 1, mode: "PLAN", goal: FULL_GOAL }), "INVALID_INPUT");
    await expect400(
      updateDevelopmentGoalAsValidator(untouchable, viewer, { goalId: 1, goal: { ...FULL_GOAL, weight: 30 } }),
      "INVALID_INPUT",
    );
  });

  it("maps access errors to 404 / 403, rule conflicts to 409 and anything else to 500", () => {
    expect(developmentGoalHttpStatus(new NotFoundError())).toBe(404);
    expect(developmentGoalHttpStatus(new ForbiddenError("edit"))).toBe(403);
    expect(developmentGoalHttpStatus(new DevelopmentGoalError("NOT_EDITABLE"))).toBe(409);
    expect(developmentGoalHttpStatus(new Error("boom"))).toBe(500);
  });
});

describe.skipIf(!hasTestDb)("development goals - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  let cycleId: number;
  let activeCompetencyId: number;
  let inactiveCompetencyId: number;
  let otherCycleCompetencyId: number;
  let areaId: number;

  const id = (amei: string): number => {
    const value = ids.get(amei);
    if (value === undefined) throw new Error(`unknown test person ${amei}`);
    return value;
  };
  const as = (amei: string): Viewer => ({ id: id(amei), isHrAdmin: amei === "HR" });
  const planGoal = () => ({ ...FULL_GOAL, competencyId: activeCompetencyId, developmentAreaId: areaId });

  async function ownDocument(amei: string): Promise<number> {
    const doc = await ensureOwnDocument(db, as(amei), { id: cycleId, status: "OTWARTY" });
    if (!doc) throw new Error("document expected in an open cycle");
    return doc.id;
  }

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
    await expect(promise).rejects.toBeInstanceOf(DevelopmentGoalError);
    await expect(promise).rejects.toMatchObject({ code, status });
  }

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
    const otherCycleId = (await db.cycle.create({ data: { year: 2026, status: "ZAMKNIETY" } })).id;

    const competency = (cycle: number, name: string, isActive = true) =>
      db.competency.create({ data: { cycleId: cycle, namePl: name, nameEn: name, isActive } });
    activeCompetencyId = (await competency(cycleId, "Innovation")).id;
    inactiveCompetencyId = (await competency(cycleId, "Retired", false)).id;
    otherCycleCompetencyId = (await competency(otherCycleId, "Innovation")).id;
    areaId = (await db.developmentArea.create({ data: { cycleId, namePl: "Obecna rola", nameEn: "Current role" } })).id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("loads the cycle's own catalogue with the active flag", async () => {
    const context = await loadDevelopmentGoalContext(db, { id: cycleId, year: 2027 });
    expect(context.competencies.map((c) => [c.id, c.isActive])).toEqual([
      [activeCompetencyId, true],
      [inactiveCompetencyId, false],
    ]);
    expect(context.developmentAreas.map((a) => a.id)).toEqual([areaId]);
  });

  it("[G3-01] creates a draft and a goal added to the plan; both audited and counted", async () => {
    const documentId = await ownDocument("A");
    const draft = await createDevelopmentGoal(db, as("A"), {
      documentId,
      mode: "DRAFT",
      goal: { competencyId: activeCompetencyId, actionTitle: "Draft" },
    });
    expect(draft).toMatchObject({ state: "SZKIC", progress: "DO_ROZPOCZECIA", developmentAreaId: null });

    const planned = await createDevelopmentGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    expect(planned).toMatchObject({ state: "W_PLANIE", startDate: "2027-01-02", endDate: "2027-12-31" });
    expect((await db.developmentGoal.findUniqueOrThrow({ where: { id: planned.id } })).progress).toBe(50);

    const view = await loadDevelopmentGoals(db, as("A"), documentId, "OTWARTY");
    expect(view).toMatchObject({ canChange: true, wasSent: false });
    expect(view.counters).toMatchObject({ drafts: 1, inPlan: 1 });
    expect(await db.auditLog.count({ where: { entity: "development_goal", action: "CREATE" } })).toBe(2);
  });

  it("[G3-20] an inactive or another cycle's competency is refused with 400", async () => {
    const documentId = await ownDocument("A");
    await expectCode(
      createDevelopmentGoal(db, as("A"), {
        documentId,
        mode: "PLAN",
        goal: { ...planGoal(), competencyId: inactiveCompetencyId },
      }),
      "COMPETENCY_INACTIVE",
      400,
    );
    await expectCode(
      createDevelopmentGoal(db, as("A"), {
        documentId,
        mode: "PLAN",
        goal: { ...planGoal(), competencyId: otherCycleCompetencyId },
      }),
      "COMPETENCY_INVALID",
      400,
    );
    expect(await db.developmentGoal.count()).toBe(0);
  });

  it("update adds a draft to the plan, audits before/after and skips unchanged saves", async () => {
    const documentId = await ownDocument("A");
    const draft = await createDevelopmentGoal(db, as("A"), {
      documentId,
      mode: "DRAFT",
      goal: { competencyId: activeCompetencyId, actionTitle: "Draft" },
    });
    await updateDevelopmentGoal(db, as("A"), { goalId: draft.id, mode: "PLAN", goal: planGoal() });
    await updateDevelopmentGoal(db, as("A"), { goalId: draft.id, mode: "PLAN", goal: planGoal() });

    const audit = await db.auditLog.findMany({ where: { entity: "development_goal", action: "UPDATE" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toMatchObject({ documentId, actionTitle: "Draft", state: "SZKIC" });
    expect(audit[0]?.after).toMatchObject({ documentId, state: "W_PLANIE", developmentAreaId: areaId });
  });

  it("[ACC-10][ACC-11] only the owner writes: B cannot see A's goals, the manager may only read", async () => {
    const documentId = await ownDocument("A");
    const goal = await createDevelopmentGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });

    await expect(loadDevelopmentGoals(db, as("B"), documentId, "OTWARTY")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteDevelopmentGoal(db, as("B"), { goalId: goal.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await loadDevelopmentGoals(db, as("M1"), documentId, "OTWARTY")).canChange).toBe(false);
    await expect(
      updateDevelopmentGoal(db, as("M1"), { goalId: goal.id, mode: "PLAN", goal: planGoal() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelDevelopmentGoal(db, as("HR"), { goalId: goal.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.developmentGoal.count()).toBe(1);
  });

  it("[G3-21] delete before the document is sent; afterwards 'Anuluj cel' keeps it as ANULOWANY", async () => {
    const documentId = await ownDocument("A");
    const first = await createDevelopmentGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    const second = await createDevelopmentGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });

    await expectCode(cancelDevelopmentGoal(db, as("A"), { goalId: first.id }), "DOCUMENT_NOT_SENT", 409);
    await deleteDevelopmentGoal(db, as("A"), { goalId: first.id });
    expect(await db.developmentGoal.findUnique({ where: { id: first.id } })).toBeNull();

    await sendAndReturn(documentId);
    await expectCode(deleteDevelopmentGoal(db, as("A"), { goalId: second.id }), "DOCUMENT_ALREADY_SENT", 409);
    const cancelled = await cancelDevelopmentGoal(db, as("A"), { goalId: second.id });
    expect(cancelled.state).toBe("ANULOWANY");

    const view = await loadDevelopmentGoals(db, as("A"), documentId, "OTWARTY");
    expect(view).toMatchObject({ wasSent: true, counters: { inPlan: 0, cancelled: 1 } });
    expect(await db.auditLog.count({ where: { entity: "development_goal", action: "CANCEL" } })).toBe(1);
    await expectCode(
      updateDevelopmentGoal(db, as("A"), { goalId: second.id, mode: "DRAFT", goal: planGoal() }),
      "GOAL_CANCELLED",
      409,
    );
  });

  it("nothing changes while the document is with the validator", async () => {
    const documentId = await ownDocument("A");
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });
    await expectCode(
      createDevelopmentGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() }),
      "NOT_EDITABLE",
      409,
    );
  });

  it("[WF-04] N+1 changes a goal in validation: flag, counter and an audited before/after; nobody else may", async () => {
    const documentId = await ownDocument("A");
    const goal = await createDevelopmentGoal(db, as("A"), { documentId, mode: "PLAN", goal: planGoal() });
    const input = { goalId: goal.id, goal: { ...planGoal(), actionTitle: "Lead the line 2 pilot" } };

    await expectCode(updateDevelopmentGoalAsValidator(db, as("M1"), input), "NOT_EDITABLE", 409);
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });
    await expect(updateDevelopmentGoalAsValidator(db, as("A"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateDevelopmentGoalAsValidator(db, as("HR"), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateDevelopmentGoalAsValidator(db, as("B"), input)).rejects.toBeInstanceOf(NotFoundError);

    const changed = await updateDevelopmentGoalAsValidator(db, as("M1"), input);
    expect(changed).toMatchObject({ state: "W_PLANIE", actionTitle: "Lead the line 2 pilot", changedByManager: true });
    // The same content again writes nothing.
    await updateDevelopmentGoalAsValidator(db, as("M1"), input);

    const audit = await db.auditLog.findMany({ where: { entity: "development_goal", action: "UPDATE_BY_MANAGER" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: id("M1"),
      before: { documentId, actionTitle: FULL_GOAL.actionTitle, changedByManager: false },
      after: { documentId, actionTitle: "Lead the line 2 pilot", changedByManager: true },
    });

    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "ZATWIERDZONY" } });
    const ownerView = await loadDevelopmentGoals(db, as("A"), documentId, "OTWARTY");
    expect(ownerView.counters.changedByManager).toBe(1);
    expect(ownerView.goals[0]?.changedByManager).toBe(true);
  });
});
