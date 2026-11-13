import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import {
  computeClosure,
  findManagerCycle,
  HIERARCHY_TX_OPTIONS,
  HierarchyCycleError,
  isDirectReport,
  isInSubtree,
  rebuildHierarchy,
  subtreeIds,
  type HierarchyNode,
} from "./hierarchy";

const node = (id: number, managerId: number | null): HierarchyNode => ({ id, managerId, label: `P${id}` });

describe("hierarchy closure - pure", () => {
  it("emits self rows and one row per ancestor with the right depth", () => {
    // 1 -> 2 -> 3, and 4 under 1
    const rows = computeClosure([node(1, null), node(2, 1), node(3, 2), node(4, 1)]);
    expect(rows).toHaveLength(8); // 4 self rows + (1,2) + (2,3) + (1,3) + (1,4)
    expect(rows).toContainEqual({ ancestorId: 1, descendantId: 3, depth: 2 });
    expect(rows).toContainEqual({ ancestorId: 2, descendantId: 3, depth: 1 });
    expect(rows).toContainEqual({ ancestorId: 3, descendantId: 3, depth: 0 });
    expect(rows).not.toContainEqual(expect.objectContaining({ ancestorId: 2, descendantId: 4 }));
  });

  it("supports several top nodes (forest)", () => {
    const rows = computeClosure([node(1, null), node(2, null), node(3, 2)]);
    expect(rows.filter((r) => r.depth > 0)).toEqual([{ ancestorId: 2, descendantId: 3, depth: 1 }]);
  });

  it("[HR-03] detects a two-person cycle and names the people in order", () => {
    const nodes = [node(1, null), node(2, 3), node(3, 2)];
    expect(findManagerCycle(nodes)?.map((n) => n.id)).toEqual([2, 3]);
    expect(() => computeClosure(nodes)).toThrow("Manager hierarchy contains a cycle: P2 -> P3 -> P2");
  });

  it("detects a self-managed person and a longer loop hanging below a valid chain", () => {
    expect(findManagerCycle([node(1, 1)])?.map((n) => n.id)).toEqual([1]);
    // 4 -> 6 -> 5 -> 4 is the loop; 7 reports into it but is not part of it
    const loop = findManagerCycle([node(7, 5), node(4, 6), node(5, 4), node(6, 5)]);
    expect(loop?.map((n) => n.id).sort()).toEqual([4, 5, 6]);
  });

  it("exposes the people on the error object", () => {
    try {
      computeClosure([node(1, 2), node(2, 1)]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HierarchyCycleError);
      expect((error as HierarchyCycleError).people.map((p) => p.label)).toEqual(["P1", "P2"]);
    }
  });

  it("treats an unknown manager id as the end of the chain", () => {
    expect(computeClosure([node(1, 99)])).toEqual([{ ancestorId: 1, descendantId: 1, depth: 0 }]);
  });
});

describe.skipIf(!hasTestDb)("hierarchy closure - database", () => {
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  const id = (amei: string) => ids.get(amei)!;

  beforeEach(async () => {
    await resetTestDb(db);
    // TOP -> A -> A1 -> A11 ; TOP -> B -> B1
    ids = await insertPeople(db, [
      { amei: "TSTTOP", managerAmei: null },
      { amei: "TSTA", managerAmei: "TSTTOP" },
      { amei: "TSTB", managerAmei: "TSTTOP" },
      { amei: "TSTA1", managerAmei: "TSTA" },
      { amei: "TSTA11", managerAmei: "TSTA1" },
      { amei: "TSTB1", managerAmei: "TSTB" },
    ]);
    await db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS);
  });

  it("serialises concurrent rebuilds (advisory lock) and ends with the correct closure", async () => {
    await db.employee.update({ where: { id: id("TSTB1") }, data: { managerId: id("TSTA11") } });
    // Without the lock the second delete misses the first one's fresh rows and its insert hits duplicate keys.
    await Promise.all(
      Array.from({ length: 4 }, () => db.$transaction((tx) => rebuildHierarchy(tx), HIERARCHY_TX_OPTIONS)),
    );
    expect(await isInSubtree(db, id("TSTA"), id("TSTB1"))).toBe(true);
    // TOP->A->A1->A11->B1 and B under TOP: 6 self rows + 5 below TOP + 3 below A + 2 below A1 + 1 below A11
    expect(await db.employeeHierarchy.count()).toBe(17);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("answers direct-report, subtree and depth-limited queries", async () => {
    expect(await isDirectReport(db, id("TSTA"), id("TSTA1"))).toBe(true);
    expect(await isDirectReport(db, id("TSTA"), id("TSTA11"))).toBe(false);
    expect(await isInSubtree(db, id("TSTA"), id("TSTA11"))).toBe(true);
    expect(await isInSubtree(db, id("TSTA"), id("TSTA"))).toBe(false);
    expect(await isInSubtree(db, id("TSTA"), id("TSTB1"))).toBe(false); // parallel branch
    expect(await subtreeIds(db, id("TSTTOP"))).toHaveLength(5);
    expect(await subtreeIds(db, id("TSTTOP"), 1)).toEqual([id("TSTA"), id("TSTB")]);
  });

  it("moving a manager updates subtree queries immediately after the rebuild", async () => {
    // A1 (with A11 below) moves from A to B
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: id("TSTA1") }, data: { managerId: id("TSTB") } });
      await rebuildHierarchy(tx);
    });
    expect(await isInSubtree(db, id("TSTA"), id("TSTA11"))).toBe(false);
    expect(await isInSubtree(db, id("TSTB"), id("TSTA11"))).toBe(true);
    expect(await isDirectReport(db, id("TSTB"), id("TSTA1"))).toBe(true);
    // depth 1 (ordered by id): A1, B1; depth 2: A11
    expect(await subtreeIds(db, id("TSTB"))).toEqual([id("TSTA1"), id("TSTB1"), id("TSTA11")]);
  });

  it("rolls back the manager change and keeps the old closure when it would create a cycle", async () => {
    const rowsBefore = await db.employeeHierarchy.count();
    await expect(
      db.$transaction(async (tx) => {
        await tx.employee.update({ where: { id: id("TSTTOP") }, data: { managerId: id("TSTA11") } });
        await rebuildHierarchy(tx);
      }),
    ).rejects.toThrow(/TSTTOP .*-> .*TSTA11/);
    expect((await db.employee.findUniqueOrThrow({ where: { id: id("TSTTOP") } })).managerId).toBeNull();
    expect(await db.employeeHierarchy.count()).toBe(rowsBefore);
    expect(await isInSubtree(db, id("TSTTOP"), id("TSTA11"))).toBe(true);
  });
});
