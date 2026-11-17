import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import {
  acknowledgeGroupGoal,
  aggregateCounters,
  BHP_COMMITMENT_MAX_LENGTH,
  bhpCommitmentInputSchema,
  ensureOwnDocument,
  GroupGoalError,
  groupGoalCounters,
  inputErrorCode,
  loadGroupGoals,
  saveBhpCommitment,
} from "./group-goals";
import { ForbiddenError, NotFoundError, type Viewer } from "./permissions";

const tooLong = "x".repeat(BHP_COMMITMENT_MAX_LENGTH + 1);

function codeOf(input: unknown): string | null {
  const parsed = bhpCommitmentInputSchema.safeParse(input);
  return parsed.success ? null : inputErrorCode(parsed.error);
}

describe("BHP commitment validation (G1-07, G1-08)", () => {
  const base = { documentId: 1, templateId: 3 };

  it("rejects an empty or whitespace-only commitment", () => {
    expect(codeOf({ ...base, commitment: "" })).toBe("COMMITMENT_REQUIRED");
    expect(codeOf({ ...base, commitment: "   \n\t " })).toBe("COMMITMENT_REQUIRED");
  });

  it(`rejects more than ${BHP_COMMITMENT_MAX_LENGTH} characters and accepts exactly the limit`, () => {
    expect(codeOf({ ...base, commitment: tooLong })).toBe("COMMITMENT_TOO_LONG");
    expect(codeOf({ ...base, commitment: "x".repeat(BHP_COMMITMENT_MAX_LENGTH) })).toBeNull();
  });

  it("trims before measuring, so padding does not count against the limit", () => {
    const parsed = bhpCommitmentInputSchema.parse({ ...base, commitment: `  ${"x".repeat(BHP_COMMITMENT_MAX_LENGTH)}  ` });
    expect(parsed.commitment).toHaveLength(BHP_COMMITMENT_MAX_LENGTH);
  });

  it("refuses malformed ids, wrong types and extra keys", () => {
    for (const bad of [
      { documentId: 0, templateId: 3, commitment: "ok" },
      { documentId: 1.5, templateId: 3, commitment: "ok" },
      { documentId: "1", templateId: 3, commitment: "ok" },
      { documentId: 1, templateId: 2_147_483_648, commitment: "ok" },
      { documentId: 1, templateId: 3, commitment: 42 },
      { documentId: 1, templateId: 3, commitment: "ok", employeeId: 9 },
      { documentId: 1, templateId: 3, commitment: "nul \u0000 inside" },
      null,
    ]) {
      expect(codeOf(bad)).toBe("INVALID_INPUT");
    }
  });
});

describe("group goal writes - input refused before any database call", () => {
  // A db whose every use fails the test: proves validation runs first.
  const untouchable = {
    $transaction: () => {
      throw new Error("database must not be touched");
    },
  } as unknown as Parameters<typeof saveBhpCommitment>[0];
  const viewer: Viewer = { id: 1, isHrAdmin: false };

  it("an empty or too long BHP commitment never reaches the database", async () => {
    await expect(saveBhpCommitment(untouchable, viewer, { documentId: 1, templateId: 3, commitment: " " })).rejects.toMatchObject({
      code: "COMMITMENT_REQUIRED",
    });
    await expect(saveBhpCommitment(untouchable, viewer, { documentId: 1, templateId: 3, commitment: tooLong })).rejects.toMatchObject({
      code: "COMMITMENT_TOO_LONG",
    });
  });

  it("a malformed acknowledge payload never reaches the database", async () => {
    await expect(acknowledgeGroupGoal(untouchable, viewer, { documentId: -1, templateId: 1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("counters (G1-10, WF-23)", () => {
  it("counts acknowledged Group goals as done and the rest as drafts", () => {
    const now = new Date();
    expect(groupGoalCounters([{ acknowledgedAt: now }, { acknowledgedAt: null }, { acknowledgedAt: now }])).toEqual({
      drafts: 1,
      done: 2,
      changedByManager: 0,
    });
    expect(groupGoalCounters([])).toEqual({ drafts: 0, done: 0, changedByManager: 0 });
  });

  it("sums sections for the top bar, so Parts 2-3 only add their own counters", () => {
    expect(
      aggregateCounters([
        { drafts: 1, done: 2, changedByManager: 0 },
        { drafts: 3, done: 5, changedByManager: 1 },
      ]),
    ).toEqual({ drafts: 4, done: 7, changedByManager: 1 });
    expect(aggregateCounters([])).toEqual({ drafts: 0, done: 0, changedByManager: 0 });
  });
});

describe.skipIf(!hasTestDb)("group goals - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  let cycleId: number;
  let templates: { leadership: number; values: number; bhp: number };

  const id = (amei: string): number => {
    const value = ids.get(amei);
    if (value === undefined) throw new Error(`unknown test person ${amei}`);
    return value;
  };
  const as = (amei: string): Viewer => ({ id: id(amei), isHrAdmin: amei === "HR" });
  const openCycle = () => ({ id: cycleId, status: "OTWARTY" as const });

  async function ownDocument(amei: string): Promise<number> {
    const doc = await ensureOwnDocument(db, as(amei), openCycle());
    if (!doc) throw new Error("document expected in an open cycle");
    return doc.id;
  }

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(GroupGoalError);
    await expect(promise).rejects.toMatchObject({ code });
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

    const cycle = await db.cycle.create({ data: { year: 2027, status: "OTWARTY" } });
    cycleId = cycle.id;
    const make = (type: "PRZYWODZTWO" | "WARTOSCI" | "BHP", sortOrder: number) =>
      db.groupGoalTemplate.create({ data: { cycleId, type, sortOrder, contentPl: `${type} pl`, contentEn: `${type} en` } });
    templates = {
      leadership: (await make("PRZYWODZTWO", 1)).id,
      values: (await make("WARTOSCI", 2)).id,
      bhp: (await make("BHP", 3)).id,
    };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("[G1-01] first open creates one SZKIC document with history and audit; reopening reuses it", async () => {
    const first = await ensureOwnDocument(db, as("A"), openCycle());
    const second = await ensureOwnDocument(db, as("A"), openCycle());
    expect(first).toMatchObject({ status: "SZKIC" });
    expect(second?.id).toBe(first?.id);
    expect(await db.gedpDocument.count({ where: { employeeId: id("A") } })).toBe(1);
    expect(await db.documentStatusHistory.findMany({ where: { documentId: first!.id } })).toMatchObject([
      { fromStatus: null, toStatus: "SZKIC", authorId: id("A") },
    ]);
    expect(await db.auditLog.count({ where: { entity: "gedp_document", action: "CREATE" } })).toBe(1);
  });

  it("[G1-02] a read-only cycle never gets a new document", async () => {
    await db.cycle.update({ where: { id: cycleId }, data: { status: "ZAMKNIETY" } });
    expect(await ensureOwnDocument(db, as("A"), { id: cycleId, status: "ZAMKNIETY" })).toBeNull();
    expect(await db.gedpDocument.count()).toBe(0);
  });

  it("[G1-05][G1-06] acknowledging locks goals 1-2: timestamp stored, second acknowledge refused", async () => {
    const documentId = await ownDocument("A");
    const ack = await acknowledgeGroupGoal(db, as("A"), { documentId, templateId: templates.leadership });
    expect(ack.acknowledgedAt).toBeInstanceOf(Date);

    await expectCode(
      acknowledgeGroupGoal(db, as("A"), { documentId, templateId: templates.leadership }),
      "ALREADY_ACKNOWLEDGED",
    );
    const rows = await db.groupGoalAck.findMany({ where: { documentId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.acknowledgedAt.getTime()).toBe(ack.acknowledgedAt.getTime());
    expect(await db.auditLog.count({ where: { entity: "group_goal_ack", action: "ACKNOWLEDGE" } })).toBe(1);
  });

  it("[G1-04] goals 1-2 carry no editable text: a commitment cannot be written to them", async () => {
    const documentId = await ownDocument("A");
    await expectCode(
      saveBhpCommitment(db, as("A"), { documentId, templateId: templates.values, commitment: "x" }),
      "WRONG_GOAL_TYPE",
    );
    await expectCode(acknowledgeGroupGoal(db, as("A"), { documentId, templateId: templates.bhp }), "WRONG_GOAL_TYPE");
  });

  it("[G1-07][G1-08] BHP cannot be acknowledged empty or over the limit; nothing is written", async () => {
    const documentId = await ownDocument("A");
    await expectCode(
      saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: "   " }),
      "COMMITMENT_REQUIRED",
    );
    await expectCode(
      saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: tooLong }),
      "COMMITMENT_TOO_LONG",
    );
    expect(await db.groupGoalAck.count()).toBe(0);
  });

  it("[G1-09][G1-11] saving the BHP commitment acknowledges it; editing keeps the first timestamp and is audited", async () => {
    const documentId = await ownDocument("A");
    const first = await saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: " Zero " });
    expect(first.commitment).toBe("Zero");
    const edited = await saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: "Zero 2" });
    expect(edited.commitment).toBe("Zero 2");
    expect(edited.acknowledgedAt.getTime()).toBe(first.acknowledgedAt.getTime());
    // Saving the same text again writes nothing, so it cannot flood audit_log.
    await saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: "Zero 2 " });

    const audit = await db.auditLog.findMany({ where: { entity: "group_goal_ack" }, orderBy: { id: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["ACKNOWLEDGE", "UPDATE_BHP_COMMITMENT"]);
    expect(audit[1]?.before).toEqual({ hsCommitment: "Zero" });

    const view = await loadGroupGoals(db, as("A"), documentId, "OTWARTY");
    expect(view.canChange).toBe(true);
    expect(view.goals.map((goal) => goal.commitment)).toEqual([null, null, "Zero 2"]);
    expect(groupGoalCounters(view.goals)).toEqual({ drafts: 2, done: 1, changedByManager: 0 });
  });

  it("[G1-11] nothing changes once the document is sent or the cycle is closed", async () => {
    const documentId = await ownDocument("A");
    await saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: "Zero" });
    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "DO_WALIDACJI" } });

    await expectCode(
      saveBhpCommitment(db, as("A"), { documentId, templateId: templates.bhp, commitment: "Changed" }),
      "NOT_EDITABLE",
    );
    await expectCode(acknowledgeGroupGoal(db, as("A"), { documentId, templateId: templates.values }), "NOT_EDITABLE");
    expect((await loadGroupGoals(db, as("A"), documentId, "OTWARTY")).canChange).toBe(false);

    await db.gedpDocument.update({ where: { id: documentId }, data: { status: "SZKIC" } });
    await db.cycle.update({ where: { id: cycleId }, data: { status: "ZAMKNIETY" } });
    await expectCode(acknowledgeGroupGoal(db, as("A"), { documentId, templateId: templates.values }), "NOT_EDITABLE");
    expect((await db.groupGoalAck.findFirstOrThrow({ where: { documentId } })).hsCommitment).toBe("Zero");
  });

  it("[ACC-10] a colleague can neither read nor modify the document (404, never 403)", async () => {
    const documentId = await ownDocument("A");
    await expect(loadGroupGoals(db, as("B"), documentId, "OTWARTY")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      acknowledgeGroupGoal(db, as("B"), { documentId, templateId: templates.leadership }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveBhpCommitment(db, as("B"), { documentId, templateId: templates.bhp, commitment: "Hijack" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.groupGoalAck.count()).toBe(0);
  });

  it("[ACC-11][ACC-13] the manager reads read-only; neither manager nor HR may acknowledge for the owner", async () => {
    const documentId = await ownDocument("A");
    const managerView = await loadGroupGoals(db, as("M1"), documentId, "OTWARTY");
    expect(managerView.canChange).toBe(false);
    expect(managerView.goals).toHaveLength(3);

    await expect(
      acknowledgeGroupGoal(db, as("M1"), { documentId, templateId: templates.leadership }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      acknowledgeGroupGoal(db, as("HR"), { documentId, templateId: templates.leadership }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveBhpCommitment(db, as("HR"), { documentId, templateId: templates.bhp, commitment: "On behalf" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.groupGoalAck.count()).toBe(0);
  });

  it("a template from another cycle cannot be acknowledged on this document", async () => {
    const documentId = await ownDocument("A");
    const other = await db.cycle.create({ data: { year: 2026, status: "ZAMKNIETY" } });
    const foreign = await db.groupGoalTemplate.create({
      data: { cycleId: other.id, type: "PRZYWODZTWO", sortOrder: 1, contentPl: "x", contentEn: "x" },
    });
    await expectCode(acknowledgeGroupGoal(db, as("A"), { documentId, templateId: foreign.id }), "TEMPLATE_NOT_FOUND");
  });
});
