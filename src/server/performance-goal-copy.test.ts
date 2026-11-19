import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import { ensureOwnDocument } from "./group-goals";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import { copiedDueDate, copyPerformanceGoalsFromPreviousYear, countCopyableGoals } from "./performance-goal-copy";
import { MAX_GOALS_PER_DOCUMENT, PerformanceGoalError, type PerformanceGoalWriter } from "./performance-goals";
import type { Viewer } from "./permissions";

// G2-06: "kopiuj" - last year's performance goals copied as drafts.

describe("copy from last year - without a database", () => {
  const untouchable: PerformanceGoalWriter = {
    $transaction: () => {
      throw new Error("the database must not be called for an invalid payload");
    },
  } as unknown as PerformanceGoalWriter;
  const viewer: Viewer = { id: 1, isHrAdmin: false };

  it.each([null, {}, { documentId: "7" }, { documentId: 0 }, { documentId: 7, extra: true }])(
    "refuses the payload %j with 400 before any database call",
    async (input) => {
      const promise = copyPerformanceGoalsFromPreviousYear(untouchable, viewer, input);
      await expect(promise).rejects.toBeInstanceOf(PerformanceGoalError);
      await expect(promise).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    },
  );

  it("moves the due date into the new cycle year; 29 Feb becomes 28 Feb; no date stays empty", () => {
    const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    expect(copiedDueDate(utc("2026-11-30"), 2027)).toEqual(utc("2027-11-30"));
    expect(copiedDueDate(utc("2028-02-29"), 2029)).toEqual(utc("2029-02-28"));
    expect(copiedDueDate(null, 2027)).toBeNull();
  });

  it("NOTHING_TO_COPY is a rule conflict (409), not a bad payload", () => {
    expect(new PerformanceGoalError("NOTHING_TO_COPY").status).toBe(409);
  });
});

describe.skipIf(!hasTestDb)("copy from last year - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  let previousCycleId: number;
  let cycleId: number;
  let numericTypeId: number;
  let textTypeId: number;

  const as = (amei: string): Viewer => ({ id: ids.get(amei) ?? -1, isHrAdmin: false });

  async function documentIn(amei: string, id: number): Promise<number> {
    const doc = await ensureOwnDocument(db, as(amei), { id, status: "OTWARTY" });
    if (!doc) throw new Error("document expected in an open cycle");
    return doc.id;
  }

  beforeEach(async () => {
    await resetTestDb(db);
    ids = await insertPeople(db, [
      { amei: "M1", managerAmei: null },
      { amei: "A", managerAmei: "M1" },
      { amei: "B", managerAmei: "M1" },
    ]);
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);
    // HR-05: only one cycle may be open; ensureOwnDocument gets the status explicitly below.
    previousCycleId = (await db.cycle.create({ data: { year: 2026, status: "ZAMKNIETY" } })).id;
    cycleId = (await db.cycle.create({ data: { year: 2027, status: "OTWARTY" } })).id;
    // HR-05: each cycle has its own target types; the copy matches them by code.
    const createType = (inCycle: number, code: string, isNumeric: boolean) =>
      db.targetType.create({ data: { cycleId: inCycle, code, namePl: code, nameEn: code, isNumeric } });
    const previousNumericTypeId = (await createType(previousCycleId, "LICZBA", true)).id;
    const previousTextTypeId = (await createType(previousCycleId, "TEKST", false)).id;
    numericTypeId = (await createType(cycleId, "LICZBA", true)).id;
    textTypeId = (await createType(cycleId, "TEKST", false)).id;

    const previous = await documentIn("A", previousCycleId);
    await db.performanceGoal.createMany({
      data: [
        {
          documentId: previous,
          title: "Year-end goal",
          dueDate: new Date("2026-12-31T00:00:00.000Z"),
          progress: 100,
          targetTypeId: previousNumericTypeId,
          targetValue: "120",
          weight: 60,
          state: "W_PLANIE",
          changedByManager: true,
        },
        { documentId: previous, title: "Draft goal", state: "SZKIC", targetTypeId: previousTextTypeId },
        { documentId: previous, title: "Cancelled goal", state: "ANULOWANY" },
      ],
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("copies the live goals as drafts, resets progress and the N+1 marker, audits each copy", async () => {
    const documentId = await documentIn("A", cycleId);
    expect(await countCopyableGoals(db, as("A"), 2027)).toEqual({ previousYear: 2026, count: 2 });

    const copied = await copyPerformanceGoalsFromPreviousYear(db, as("A"), { documentId });
    expect(copied.map((goal) => goal.title)).toEqual(["Year-end goal", "Draft goal"]);
    expect(copied[0]).toMatchObject({
      documentId,
      state: "SZKIC",
      progress: "DO_ROZPOCZECIA",
      dueDate: "2027-12-31",
      targetTypeId: numericTypeId,
      target: "120",
      weight: 60,
      changedByManager: false,
    });
    expect(await db.auditLog.count({ where: { entity: "performance_goal", action: "COPY" } })).toBe(2);
  });

  it("[HR-05] a type the new cycle does not have falls back to Tekst", async () => {
    await db.targetType.delete({ where: { id: numericTypeId } });
    const documentId = await documentIn("A", cycleId);
    const [first] = await copyPerformanceGoalsFromPreviousYear(db, as("A"), { documentId });
    expect(first).toMatchObject({ targetTypeId: textTypeId, target: "120" });
  });

  it("a deactivated target type falls back to Tekst", async () => {
    await db.targetType.update({ where: { id: numericTypeId }, data: { isActive: false } });
    const documentId = await documentIn("A", cycleId);
    const [first] = await copyPerformanceGoalsFromPreviousYear(db, as("A"), { documentId });
    expect(first).toMatchObject({ targetTypeId: textTypeId, target: "120" });
  });

  it("nothing to copy, someone else's document and the goal limit are refused", async () => {
    const own = await documentIn("B", cycleId);
    await expect(copyPerformanceGoalsFromPreviousYear(db, as("B"), { documentId: own })).rejects.toMatchObject({
      code: "NOTHING_TO_COPY",
    });
    const documentOfA = await documentIn("A", cycleId);
    await expect(copyPerformanceGoalsFromPreviousYear(db, as("B"), { documentId: documentOfA })).rejects.toThrow();

    await db.performanceGoal.createMany({
      data: Array.from({ length: MAX_GOALS_PER_DOCUMENT - 1 }, (_, index) => ({
        documentId: documentOfA,
        title: `Goal ${index}`,
      })),
    });
    await expect(copyPerformanceGoalsFromPreviousYear(db, as("A"), { documentId: documentOfA })).rejects.toMatchObject({
      code: "TOO_MANY_GOALS",
    });
  });

  it("refuses while the document is with the validator", async () => {
    const documentId = await documentIn("A", cycleId);
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });
    await expect(copyPerformanceGoalsFromPreviousYear(db, as("A"), { documentId })).rejects.toMatchObject({
      code: "NOT_EDITABLE",
    });
  });
});
