import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CLOSING_CONDITION_COUNT } from "@/domain/document-status";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "./hierarchy";
import { scopedEmployeesWhere, type Viewer } from "./permissions";
import {
  compareMembers,
  DIRECT_LEVEL,
  listTeam,
  parseTeamLevel,
  summarizeDocuments,
  teamMembersWhere,
  type CompletionRows,
  type TeamMember,
} from "./team";

const viewer = (id: number, isHrAdmin = false): Viewer => ({ id, isHrAdmin });

describe("parseTeamLevel", () => {
  it("accepts a level the viewer has", () => {
    expect(parseTeamLevel("1", 3)).toBe(1);
    expect(parseTeamLevel("3", 3)).toBe(3);
  });

  it.each([undefined, "", "0", "-1", "4", "1.5", "01", " 2", "all", "9999", ["1", "2"], 2])(
    "treats %j as the whole structure",
    (raw) => {
      expect(parseTeamLevel(raw, 3)).toBeNull();
    },
  );
});

describe("teamMembersWhere", () => {
  it("always ANDs the permission scope in first, and never lists the viewer", () => {
    for (const level of [null, 1, 2]) {
      const where = teamMembersWhere(viewer(7), level);
      const scope = scopedEmployeesWhere(viewer(7)).AND as unknown[];
      expect((where.AND as unknown[])[0]).toEqual(scope[0]);
      expect(JSON.stringify(where)).toContain('"id":{"not":7}');
    }
  });

  it("for HR the scope is everyone, but the team filter still starts from HR's own structure", () => {
    const where = JSON.stringify(teamMembersWhere(viewer(7, true), null));
    expect(where).toContain('"ancestorId":7');
    expect(where).toContain('"managerId":7');
  });

  it("level 2 and deeper is exactly that depth below the viewer", () => {
    expect(JSON.stringify(teamMembersWhere(viewer(7), 2))).toContain('"ancestors":{"some":{"ancestorId":7,"depth":2}}');
  });
});

describe("compareMembers", () => {
  const member = (firstName: string, lastName: string, level: number | null): TeamMember => ({
    employeeId: 0,
    name: `${firstName} ${lastName}`,
    sortName: `${lastName} ${firstName}`,
    position: null,
    department: null,
    isActive: true,
    level,
    canValidate: false,
    document: null,
  });

  it("orders by level, WF-09-only people last, then by surname with Polish collation", () => {
    const sorted = [
      member("Adam", "Żak", 1),
      member("Zofia", "Łukasik", 1),
      member("Ewa", "Lis", 1),
      member("Anna", "Bąk", null),
      member("Piotr", "Adamski", 2),
      member("Ola", "Śliwa", 1),
    ].toSorted(compareMembers);
    expect(sorted.map((m) => m.sortName)).toEqual([
      "Lis Ewa",
      "Łukasik Zofia",
      "Śliwa Ola",
      "Żak Adam",
      "Adamski Piotr",
      "Bąk Anna",
    ]);
  });
});

describe("summarizeDocuments", () => {
  const T0 = new Date("2027-01-10T08:00:00Z");
  const T1 = new Date("2027-01-12T08:00:00Z");
  const T2 = new Date("2027-01-15T08:00:00Z");
  const rows: CompletionRows = {
    rules: { minPerformanceGoals: 1, requiredWeightSum: 100, minDevelopmentGoals: 1 },
    templates: [
      { id: 1, type: "PRZYWODZTWO" },
      { id: 2, type: "WARTOSCI" },
      { id: 3, type: "BHP" },
    ],
    acks: [
      { documentId: 10, templateId: 1, hsCommitment: null, acknowledgedAt: T0 },
      { documentId: 10, templateId: 2, hsCommitment: null, acknowledgedAt: T0 },
      { documentId: 10, templateId: 3, hsCommitment: "Report near misses", acknowledgedAt: T1 },
    ],
    performanceGoals: [{ documentId: 10, state: "W_PLANIE", weight: 100, updatedAt: T2 }],
    developmentGoals: [{ documentId: 10, state: "W_PLANIE", updatedAt: T0 }],
  };

  it("a complete document meets every condition; last update is its newest change", () => {
    const summary = summarizeDocuments([{ id: 10, updatedAt: T0 }], rows).get(10);
    expect(summary).toEqual({ completion: { met: CLOSING_CONDITION_COUNT, total: CLOSING_CONDITION_COUNT }, lastUpdatedAt: T2 });
  });

  it("an untouched document meets none and keeps its own timestamp", () => {
    const summary = summarizeDocuments([{ id: 11, updatedAt: T1 }], rows).get(11);
    expect(summary).toEqual({ completion: { met: 0, total: CLOSING_CONDITION_COUNT }, lastUpdatedAt: T1 });
  });

  it("does not mix rows of different documents", () => {
    const summaries = summarizeDocuments(
      [
        { id: 10, updatedAt: T0 },
        { id: 11, updatedAt: T0 },
      ],
      rows,
    );
    expect(summaries.get(10)?.completion.met).toBe(CLOSING_CONDITION_COUNT);
    expect(summaries.get(11)?.completion.met).toBe(0);
  });
});

describe.skipIf(!hasTestDb)("listTeam - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  let cycleId: number;
  const id = (amei: string): number => {
    const value = ids.get(amei);
    if (value === undefined) throw new Error(`unknown test person ${amei}`);
    return value;
  };
  const as = (amei: string): Viewer => viewer(id(amei), amei === "HR");
  const names = (members: readonly { name: string }[]): string[] => members.map((m) => m.name.replace("Test ", ""));

  // TOP -> M1 -> {A, B}; TOP -> M2 -> C; X has no manager and M1 as override validator; HR is admin.
  beforeEach(async () => {
    await resetTestDb(db);
    ids = await insertPeople(db, [
      { amei: "TOP", managerAmei: null },
      { amei: "M1", managerAmei: "TOP" },
      { amei: "M2", managerAmei: "TOP" },
      { amei: "A", managerAmei: "M1" },
      { amei: "B", managerAmei: "M1" },
      { amei: "C", managerAmei: "M2" },
      { amei: "X", managerAmei: null },
      { amei: "HR", managerAmei: null },
    ]);
    await db.employee.update({ where: { id: id("HR") }, data: { isHrAdmin: true } });
    await db.employee.update({ where: { id: id("X") }, data: { validatorOverrideId: id("M1") } });
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);
    cycleId = (await db.cycle.create({ data: { year: 2027 } })).id;
    await db.gedpDocument.create({ data: { employeeId: id("A"), cycleId, status: "DO_WALIDACJI" } });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("[WF-21] N+1 sees only direct reports plus the WF-09 person, and validates them", async () => {
    const team = await listTeam(db, as("M1"), cycleId, undefined);
    expect(team.maxLevel).toBe(DIRECT_LEVEL);
    expect(names(team.members)).toEqual(["A", "B", "X"]);
    expect(team.members.every((member) => member.canValidate)).toBe(true);
    expect(team.members.map((member) => member.level)).toEqual([1, 1, null]);
  });

  it("[WF-21] N+2 sees the whole subtree with levels, views only below level 1", async () => {
    const team = await listTeam(db, as("TOP"), cycleId, undefined);
    expect(team.maxLevel).toBe(2);
    expect(names(team.members)).toEqual(["M1", "M2", "A", "B", "C"]);
    const a = team.members.find((member) => member.employeeId === id("A"));
    expect(a).toMatchObject({ level: 2, canValidate: false, document: { status: "DO_WALIDACJI" } });
    expect(a?.document?.completion).toEqual({ met: 0, total: CLOSING_CONDITION_COUNT });
  });

  it("[WF-21] the level filter narrows N+2's list; an out-of-range level falls back to everyone", async () => {
    expect(names((await listTeam(db, as("TOP"), cycleId, "1")).members)).toEqual(["M1", "M2"]);
    expect(names((await listTeam(db, as("TOP"), cycleId, "2")).members)).toEqual(["A", "B", "C"]);
    const outOfRange = await listTeam(db, as("TOP"), cycleId, "7");
    expect(outOfRange.level).toBeNull();
    expect(outOfRange.members).toHaveLength(5);
  });

  it("an employee without reports gets an empty list; HR's team is not the whole company", async () => {
    expect((await listTeam(db, as("A"), cycleId, undefined)).members).toEqual([]);
    expect((await listTeam(db, as("HR"), cycleId, undefined)).members).toEqual([]);
  });
});
