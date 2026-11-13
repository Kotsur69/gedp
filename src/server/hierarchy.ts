// No `server-only` guard on purpose: this module holds no secrets, only receives a DB client as a
// parameter, and is also used by the plain-Node seed script (prisma/seed.ts), where the guard throws.
import type { Prisma } from "@/generated/prisma/client";

// employee_hierarchy is a closure table derived from employee.managerId:
// one row per (ancestor, descendant) pair, depth 0 = self, 1 = direct report, 2 = report of a report...
// It is rebuilt in full after every structure import and every manager change, inside the same
// transaction as that change, so permission checks never see a half-updated structure.

export interface HierarchyNode {
  id: number;
  managerId: number | null;
  /** Human-readable name used in error messages, e.g. "AM0001234 Jan Kowalski". */
  label: string;
}

export interface ClosureRow {
  ancestorId: number;
  descendantId: number;
  depth: number;
}

/** Thrown when manager links form a loop (A -> B -> A). `people` lists the loop in order. */
export class HierarchyCycleError extends Error {
  readonly people: readonly HierarchyNode[];

  constructor(people: readonly HierarchyNode[]) {
    const loop = [...people, people[0]].map((p) => p.label).join(" -> ");
    super(`Manager hierarchy contains a cycle: ${loop}`);
    this.name = "HierarchyCycleError";
    this.people = people;
  }
}

const UNVISITED = 0;
const IN_PROGRESS = 1;
const DONE = 2;

/**
 * Returns the people forming a manager loop, in order, or null when the structure is a forest.
 * A manager id that is not in `nodes` ends the chain (unknown managers are validated elsewhere).
 */
export function findManagerCycle(nodes: readonly HierarchyNode[]): HierarchyNode[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<number, number>();

  for (const start of nodes) {
    const path: HierarchyNode[] = [];
    let current: HierarchyNode | undefined = start;
    while (current && (state.get(current.id) ?? UNVISITED) !== DONE) {
      if (state.get(current.id) === IN_PROGRESS) {
        return path.slice(path.indexOf(current));
      }
      state.set(current.id, IN_PROGRESS);
      path.push(current);
      current = current.managerId === null ? undefined : byId.get(current.managerId);
    }
    for (const visited of path) state.set(visited.id, DONE);
  }
  return null;
}

/** Computes every closure row for the given structure. Throws HierarchyCycleError on a loop. */
export function computeClosure(nodes: readonly HierarchyNode[]): ClosureRow[] {
  const cycle = findManagerCycle(nodes);
  if (cycle) throw new HierarchyCycleError(cycle);

  const managerOf = new Map(nodes.map((n) => [n.id, n.managerId]));
  const rows: ClosureRow[] = [];
  for (const node of nodes) {
    rows.push({ ancestorId: node.id, descendantId: node.id, depth: 0 });
    let depth = 1;
    let ancestorId = node.managerId;
    while (ancestorId !== null && managerOf.has(ancestorId)) {
      rows.push({ ancestorId, descendantId: node.id, depth });
      ancestorId = managerOf.get(ancestorId) ?? null;
      depth += 1;
    }
  }
  return rows;
}

/** Delegates the rebuild needs; pass the client of an interactive transaction. */
export type HierarchyTx = Pick<Prisma.TransactionClient, "employee" | "employeeHierarchy" | "$executeRaw">;
/** Delegates the read helpers need; a transaction client or the root client both fit. */
export type HierarchyReader = Pick<Prisma.TransactionClient, "employeeHierarchy">;

// Arbitrary constant that identifies the hierarchy rebuild among advisory locks.
const REBUILD_LOCK_KEY = 2027_0001;
const INSERT_CHUNK_SIZE = 5000;
const REBUILD_TX_TIMEOUT_MS = 60_000;

/**
 * Options for the transaction that wraps rebuildHierarchy:
 * `prisma.$transaction(async (tx) => { ...change...; await rebuildHierarchy(tx); }, HIERARCHY_TX_OPTIONS)`.
 * READ COMMITTED is required: under REPEATABLE READ / SERIALIZABLE the snapshot is taken before the
 * advisory lock, so a waiting rebuild could miss another transaction's committed manager change.
 * The timeout covers a full delete + re-insert for a large organisation (Prisma's default is 5 s).
 */
export const HIERARCHY_TX_OPTIONS = {
  isolationLevel: "ReadCommitted",
  timeout: REBUILD_TX_TIMEOUT_MS,
} as const;

export interface RebuildResult {
  employees: number;
  rows: number;
}

/**
 * Recomputes employee_hierarchy from employee.managerId. MUST run inside a READ COMMITTED
 * transaction opened with HIERARCHY_TX_OPTIONS: the advisory lock serialises concurrent rebuilds
 * until commit, and a HierarchyCycleError rolls the caller's change back.
 */
export async function rebuildHierarchy(tx: HierarchyTx): Promise<RebuildResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REBUILD_LOCK_KEY})`;

  const employees = await tx.employee.findMany({
    select: { id: true, managerId: true, amei: true, firstName: true, lastName: true },
    orderBy: { id: "asc" },
  });
  const rows = computeClosure(
    employees.map((e) => ({ id: e.id, managerId: e.managerId, label: `${e.amei} ${e.firstName} ${e.lastName}` })),
  );

  await tx.employeeHierarchy.deleteMany({});
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    await tx.employeeHierarchy.createMany({ data: rows.slice(i, i + INSERT_CHUNK_SIZE) });
  }
  return { employees: employees.length, rows: rows.length };
}

async function depthBetween(db: HierarchyReader, ancestorId: number, descendantId: number): Promise<number | null> {
  const row = await db.employeeHierarchy.findUnique({
    where: { ancestorId_descendantId: { ancestorId, descendantId } },
    select: { depth: true },
  });
  return row?.depth ?? null;
}

/** True when `employeeId` reports directly to `managerId` (N+1). */
export async function isDirectReport(db: HierarchyReader, managerId: number, employeeId: number): Promise<boolean> {
  return (await depthBetween(db, managerId, employeeId)) === 1;
}

/** True when `employeeId` is anywhere below `ancestorId`. A person is not in their own subtree. */
export async function isInSubtree(db: HierarchyReader, ancestorId: number, employeeId: number): Promise<boolean> {
  const depth = await depthBetween(db, ancestorId, employeeId);
  return depth !== null && depth >= 1;
}

/** Ids of everyone below `ancestorId`, optionally limited to `maxDepth` levels (1 = direct reports). */
export async function subtreeIds(db: HierarchyReader, ancestorId: number, maxDepth?: number): Promise<number[]> {
  const rows = await db.employeeHierarchy.findMany({
    where: { ancestorId, depth: { gte: 1, ...(maxDepth === undefined ? {} : { lte: maxDepth }) } },
    select: { descendantId: true },
    orderBy: [{ depth: "asc" }, { descendantId: "asc" }],
  });
  return rows.map((r) => r.descendantId);
}
