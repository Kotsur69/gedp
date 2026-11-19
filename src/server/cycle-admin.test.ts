import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import {
  changeCycleStatus,
  createCycle,
  CycleAdminError,
  listCyclesForAdmin,
  loadCycleConfig,
  updateCycleSettings,
  type CycleAdminDb,
} from "./cycle-admin";
import { moveTargetType, saveCatalogItem, saveGroupGoalText, saveTargetType } from "./cycle-catalog";
import { createDevelopmentGoal } from "./development-goals";
import { ensureOwnDocument } from "./group-goals";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import { ForbiddenError, type Viewer } from "./permissions";

// HR-05: cycle configuration in the HR panel.

describe("cycle panel - without a database", () => {
  const untouchable = {
    $transaction: () => {
      throw new Error("the database must not be called for an invalid payload");
    },
  } as unknown as CycleAdminDb;
  // The HR check runs first inside the transaction and refuses a non-HR viewer before any query.
  const noQueries = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
  } as unknown as CycleAdminDb;
  const hr: Viewer = { id: 1, isHrAdmin: true };
  const employee: Viewer = { id: 2, isHrAdmin: false };

  it.each([
    ["createCycle", () => createCycle(untouchable, hr, { year: "2028", sourceCycleId: null })],
    ["updateCycleSettings", () => updateCycleSettings(untouchable, hr, { cycleId: 1 })],
    ["changeCycleStatus", () => changeCycleStatus(untouchable, hr, { cycleId: 1, status: "ARCHIWUM" })],
    [
      "saveGroupGoalText",
      () => saveGroupGoalText(untouchable, hr, { cycleId: 1, type: "BHP", contentPl: "", contentEn: "x" }),
    ],
    ["saveCatalogItem", () => saveCatalogItem(untouchable, hr, { cycleId: 1, kind: "skill", id: null })],
    ["saveTargetType", () => saveTargetType(untouchable, hr, { cycleId: 1, id: null, code: "1" })],
    ["moveTargetType", () => moveTargetType(untouchable, hr, { cycleId: 1, id: 2, direction: "left" })],
  ])("%s refuses a malformed payload before any database call", async (_name, call) => {
    const promise = call();
    await expect(promise).rejects.toBeInstanceOf(CycleAdminError);
    await expect(promise).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns per-field codes for the form", async () => {
    await expect(createCycle(untouchable, hr, { year: 1999, sourceCycleId: null })).rejects.toMatchObject({
      fieldErrors: { year: "OUT_OF_RANGE" },
    });
  });

  it("refuses a viewer without the HR role", async () => {
    await expect(createCycle(noQueries, employee, { year: 2028, sourceCycleId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(changeCycleStatus(noQueries, employee, { cycleId: 1, status: "OTWARTY" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe.skipIf(!hasTestDb)("cycle panel - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  let sourceId: number;

  const as = (amei: string): Viewer => ({ id: ids.get(amei) ?? -1, isHrAdmin: amei === "HR" });
  const hr = () => as("HR");

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(CycleAdminError);
    await expect(promise).rejects.toMatchObject({ code });
  }

  /** A complete cycle, as the seed would leave it. */
  async function completeCycle(year: number, status: "OTWARTY" | "ZAMKNIETY"): Promise<number> {
    const cycle = await db.cycle.create({
      data: {
        year,
        status,
        goalSettingOpensAt: new Date(`${year}-01-25T00:00:00.000Z`),
        goalSettingClosesAt: new Date(`${year}-03-31T00:00:00.000Z`),
        minPerformanceGoals: 2,
        requiredWeightSum: 100,
        minDevelopmentGoals: 1,
      },
    });
    const types = ["PRZYWODZTWO", "WARTOSCI", "BHP"] as const;
    await db.groupGoalTemplate.createMany({
      data: types.map((type, index) => ({
        cycleId: cycle.id,
        type,
        sortOrder: index + 1,
        contentPl: `${type} PL`,
        contentEn: `${type} EN`,
      })),
    });
    await db.competency.createMany({
      data: [
        { cycleId: cycle.id, namePl: "Innowacyjność", nameEn: "Innovation" },
        { cycleId: cycle.id, namePl: "Stara", nameEn: "Retired", isActive: false },
      ],
    });
    await db.developmentArea.create({ data: { cycleId: cycle.id, namePl: "Obecna rola", nameEn: "Current role" } });
    await db.targetType.createMany({
      data: [
        { cycleId: cycle.id, code: "TEKST", namePl: "Tekst", nameEn: "Text", sortOrder: 1 },
        { cycleId: cycle.id, code: "LICZBA", namePl: "Liczba", nameEn: "Number", isNumeric: true, sortOrder: 2 },
      ],
    });
    return cycle.id;
  }

  beforeEach(async () => {
    await resetTestDb(db);
    ids = await insertPeople(db, [
      { amei: "M1", managerAmei: null },
      { amei: "A", managerAmei: "M1" },
      { amei: "HR", managerAmei: null },
    ]);
    await db.employee.update({ where: { id: ids.get("HR") }, data: { isHrAdmin: true } });
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);
    sourceId = await completeCycle(2026, "OTWARTY");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("[HR-05] a copy has the whole configuration, shifted into the new year, in preparation", async () => {
    const created = await createCycle(db, hr(), { year: 2027, sourceCycleId: sourceId });
    const copy = await loadCycleConfig(db, hr(), 2027);
    const source = await loadCycleConfig(db, hr(), 2026);
    if (!copy || !source) throw new Error("both cycles expected");

    expect(copy).toMatchObject({
      id: created.id,
      status: "PRZYGOTOWANIE",
      goalSettingOpensAt: "2027-01-25",
      goalSettingClosesAt: "2027-03-31",
      minPerformanceGoals: 2,
      requiredWeightSum: 100,
      minDevelopmentGoals: 1,
      gaps: [],
    });
    // Row ids and usage counts differ between the cycles by design; everything else must match.
    const PER_CYCLE_KEYS = new Set(["id", "usage", "acknowledgements"]);
    const strip = (rows: readonly object[]) =>
      rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !PER_CYCLE_KEYS.has(key))));
    expect(strip(copy.groupGoals)).toEqual(strip(source.groupGoals));
    expect(strip(copy.competencies)).toEqual(strip(source.competencies));
    expect(strip(copy.developmentAreas)).toEqual(strip(source.developmentAreas));
    expect(strip(copy.targetTypes)).toEqual(strip(source.targetTypes));
    expect(await db.auditLog.count({ where: { entity: "cycle", action: "COPY", entityId: String(created.id) } })).toBe(1);
  });

  it("[HR-05] the copy is independent: changing it leaves the source untouched", async () => {
    const { id: copyId } = await createCycle(db, hr(), { year: 2027, sourceCycleId: sourceId });
    const copy = await loadCycleConfig(db, hr(), 2027);
    const competency = copy?.competencies.find((item) => item.nameEn === "Innovation");
    const numeric = copy?.targetTypes.find((item) => item.code === "LICZBA");
    if (!competency || !numeric) throw new Error("copied rows expected");

    await saveCatalogItem(db, hr(), {
      cycleId: copyId,
      kind: "competency",
      id: competency.id,
      namePl: "Innowacje",
      nameEn: "Innovation",
      isActive: false,
    });
    await saveTargetType(db, hr(), {
      cycleId: copyId,
      id: numeric.id,
      code: "LICZBA",
      namePl: "Liczba",
      nameEn: "Number",
      isNumeric: false,
      isActive: true,
    });
    await saveGroupGoalText(db, hr(), { cycleId: copyId, type: "BHP", contentPl: "Nowy BHP", contentEn: "New H&S" });
    await updateCycleSettings(db, hr(), {
      cycleId: copyId,
      year: 2027,
      goalSettingOpensAt: "2027-02-01",
      goalSettingClosesAt: "2027-04-30",
      minPerformanceGoals: 3,
      requiredWeightSum: 100,
      minDevelopmentGoals: 2,
    });

    const source = await loadCycleConfig(db, hr(), 2026);
    expect(source?.competencies.find((item) => item.nameEn === "Innovation")).toMatchObject({
      namePl: "Innowacyjność",
      isActive: true,
    });
    expect(source?.targetTypes.find((item) => item.code === "LICZBA")).toMatchObject({ isNumeric: true });
    expect(source?.groupGoals.find((item) => item.type === "BHP")).toMatchObject({ contentPl: "BHP PL" });
    expect(source).toMatchObject({ goalSettingOpensAt: "2026-01-25", minPerformanceGoals: 2, minDevelopmentGoals: 1 });
  });

  it("[HR-05] a deactivated competency is not selectable in a new goal", async () => {
    const { id: copyId } = await createCycle(db, hr(), { year: 2027, sourceCycleId: sourceId });
    await changeCycleStatus(db, hr(), { cycleId: sourceId, status: "ZAMKNIETY" });
    await changeCycleStatus(db, hr(), { cycleId: copyId, status: "OTWARTY" });
    const competency = (await loadCycleConfig(db, hr(), 2027))?.competencies.find((item) => item.nameEn === "Innovation");
    if (!competency) throw new Error("competency expected");
    await saveCatalogItem(db, hr(), {
      cycleId: copyId,
      kind: "competency",
      id: competency.id,
      namePl: competency.namePl,
      nameEn: competency.nameEn,
      isActive: false,
    });

    const document = await ensureOwnDocument(db, as("A"), { id: copyId, status: "OTWARTY" });
    if (!document) throw new Error("document expected");
    await expect(
      createDevelopmentGoal(db, as("A"), {
        documentId: document.id,
        mode: "DRAFT",
        goal: { competencyId: competency.id, actionTitle: "Szkolenie" },
      }),
    ).rejects.toMatchObject({ code: "COMPETENCY_INACTIVE" });
  });

  it("[HR-05] only one cycle is open at a time", async () => {
    const { id: copyId } = await createCycle(db, hr(), { year: 2027, sourceCycleId: sourceId });
    await expectCode(changeCycleStatus(db, hr(), { cycleId: copyId, status: "OTWARTY" }), "ANOTHER_OPEN");
    // The database refuses it too, whatever the application does.
    await expect(db.cycle.update({ where: { id: copyId }, data: { status: "OTWARTY" } })).rejects.toThrow();

    await changeCycleStatus(db, hr(), { cycleId: sourceId, status: "ZAMKNIETY" });
    await expect(changeCycleStatus(db, hr(), { cycleId: copyId, status: "OTWARTY" })).resolves.toEqual({
      changed: true,
    });
    const cycles = await listCyclesForAdmin(db, hr());
    expect(cycles.map((cycle) => [cycle.year, cycle.status])).toEqual([
      [2027, "OTWARTY"],
      [2026, "ZAMKNIETY"],
    ]);
    expect(await db.auditLog.count({ where: { entity: "cycle", action: "STATUS_CHANGE" } })).toBe(2);
  });

  it("[HR-05] an empty cycle cannot open until its configuration is complete", async () => {
    await changeCycleStatus(db, hr(), { cycleId: sourceId, status: "ZAMKNIETY" });
    const { id } = await createCycle(db, hr(), { year: 2028, sourceCycleId: null });
    await expect(changeCycleStatus(db, hr(), { cycleId: id, status: "OTWARTY" })).rejects.toMatchObject({
      code: "NOT_READY",
      gaps: [
        "GROUP_GOAL_PRZYWODZTWO",
        "GROUP_GOAL_WARTOSCI",
        "GROUP_GOAL_BHP",
        "ACTIVE_COMPETENCY",
        "ACTIVE_DEVELOPMENT_AREA",
      ],
    });
    // The default target type is created with the cycle.
    expect((await loadCycleConfig(db, hr(), 2028))?.targetTypes.map((type) => type.code)).toEqual(["TEKST"]);
  });

  it("[HR-05] year rules: unique, and fixed once the cycle has left preparation", async () => {
    await expectCode(createCycle(db, hr(), { year: 2026, sourceCycleId: null }), "YEAR_TAKEN");
    const { id } = await createCycle(db, hr(), { year: 2028, sourceCycleId: sourceId });
    const settings = {
      goalSettingOpensAt: null,
      goalSettingClosesAt: null,
      minPerformanceGoals: 1,
      requiredWeightSum: 100,
      minDevelopmentGoals: 1,
    };
    await expectCode(updateCycleSettings(db, hr(), { ...settings, cycleId: id, year: 2026 }), "YEAR_TAKEN");
    await expect(updateCycleSettings(db, hr(), { ...settings, cycleId: id, year: 2027 })).resolves.toEqual({
      changed: true,
      yearChanged: true,
    });
    // Same values again: nothing written, so no new address either.
    await expect(updateCycleSettings(db, hr(), { ...settings, cycleId: id, year: 2027 })).resolves.toEqual({
      changed: false,
      yearChanged: false,
    });
    await expectCode(updateCycleSettings(db, hr(), { ...settings, cycleId: sourceId, year: 2025 }), "YEAR_LOCKED");
  });

  it("[HR-05] a closed cycle is read-only; it can be reopened", async () => {
    await changeCycleStatus(db, hr(), { cycleId: sourceId, status: "ZAMKNIETY" });
    await expectCode(
      saveGroupGoalText(db, hr(), { cycleId: sourceId, type: "BHP", contentPl: "x", contentEn: "y" }),
      "CYCLE_CLOSED",
    );
    await expect(changeCycleStatus(db, hr(), { cycleId: sourceId, status: "OTWARTY" })).resolves.toEqual({
      changed: true,
    });
  });

  it("[HR-05] going back to preparation is refused once documents exist", async () => {
    await ensureOwnDocument(db, as("A"), { id: sourceId, status: "OTWARTY" });
    await expectCode(changeCycleStatus(db, hr(), { cycleId: sourceId, status: "PRZYGOTOWANIE" }), "HAS_DOCUMENTS");
  });

  it("[HR-05] target types: unique code, default stays active, numeric flag fixed while used, order", async () => {
    const config = await loadCycleConfig(db, hr(), 2026);
    const text = config?.targetTypes.find((type) => type.code === "TEKST");
    const numeric = config?.targetTypes.find((type) => type.code === "LICZBA");
    if (!text || !numeric) throw new Error("types expected");
    const base = { cycleId: sourceId, namePl: "Kilowatogodziny", nameEn: "Kilowatt hours", isNumeric: true, isActive: true };

    const added = await saveTargetType(db, hr(), { ...base, id: null, code: "kwh" });
    await expectCode(saveTargetType(db, hr(), { ...base, id: null, code: "KWH" }), "DUPLICATE_CODE");
    await expectCode(
      saveTargetType(db, hr(), {
        ...base,
        id: text.id,
        code: "TEKST",
        namePl: "Tekst",
        nameEn: "Text",
        isNumeric: false,
        isActive: false,
      }),
      "DEFAULT_TYPE_LOCKED",
    );
    await expectCode(saveTargetType(db, hr(), { ...base, id: added.id, code: "MWH" }), "INVALID_INPUT");

    const document = await ensureOwnDocument(db, as("A"), { id: sourceId, status: "OTWARTY" });
    if (!document) throw new Error("document expected");
    await db.performanceGoal.create({ data: { documentId: document.id, title: "Goal", targetTypeId: numeric.id } });
    await expectCode(
      saveTargetType(db, hr(), {
        ...base,
        id: numeric.id,
        code: "LICZBA",
        namePl: "Liczba",
        nameEn: "Number",
        isNumeric: false,
      }),
      "TYPE_IN_USE",
    );

    await moveTargetType(db, hr(), { cycleId: sourceId, id: added.id, direction: "up" });
    const order = (await loadCycleConfig(db, hr(), 2026))?.targetTypes.map((type) => type.code);
    expect(order).toEqual(["TEKST", "KWH", "LICZBA"]);
    expect(await db.auditLog.count({ where: { entity: "target_type", action: "REORDER" } })).toBe(1);
  });

  it("[HR-05] catalogue: a name is unique per cycle regardless of case; an unchanged save writes nothing", async () => {
    await expectCode(
      saveCatalogItem(db, hr(), {
        cycleId: sourceId,
        kind: "competency",
        id: null,
        namePl: "innowacyjność",
        nameEn: "Something else",
        isActive: true,
      }),
      "DUPLICATE_NAME",
    );
    const area = { cycleId: sourceId, kind: "developmentArea", namePl: "Przyszła rola", nameEn: "Future role", isActive: true };
    const created = await saveCatalogItem(db, hr(), { ...area, id: null });
    const auditRows = await db.auditLog.count();
    await expect(saveCatalogItem(db, hr(), { ...area, id: created.id })).resolves.toEqual({
      id: created.id,
      changed: false,
    });
    expect(await db.auditLog.count()).toBe(auditRows);
    // The same id under the other kind belongs to another table: not found.
    await expectCode(saveCatalogItem(db, hr(), { ...area, kind: "competency", id: created.id + 1000 }), "NOT_FOUND");
  });

  it("[HR-05] a demoted HR user is refused on the live row", async () => {
    await db.employee.update({ where: { id: ids.get("HR") }, data: { isHrAdmin: false } });
    await expect(createCycle(db, hr(), { year: 2027, sourceCycleId: sourceId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
