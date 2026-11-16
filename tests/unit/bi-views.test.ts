// RPT-12: the "bi" reporting schema and the read-only gedp_bi role
// (migration 20261116090000_bi_reporting_views). DB-backed; skipped without TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../setup/db-client";

// Exact column allow-list per view (GDPR data minimisation): any new column must be added here on purpose.
const BI_COLUMNS: Record<string, string[]> = {
  employee: ["employee_id", "amei", "manager_id", "department", "position", "location", "is_white_collar", "is_active"],
  document: ["document_id", "employee_id", "cycle_id", "cycle_year", "cycle_status", "status", "validator_id", "created_at", "updated_at"],
  performance_goal: [
    "goal_id", "document_id", "state", "target_type_code", "weight", "progress", "due_date", "changed_by_manager",
    "created_at", "updated_at",
  ],
  development_goal: [
    "goal_id", "document_id", "state", "development_area_pl", "development_area_en", "competency_pl", "competency_en",
    "start_date", "end_date", "progress", "changed_by_manager", "created_at", "updated_at",
  ],
  document_status_history: ["history_id", "document_id", "from_status", "to_status", "author_id", "created_at"],
  document_completeness: [
    "document_id", "leadership_acknowledged", "values_acknowledged", "hs_commitment_set", "performance_goals_in_plan",
    "performance_weight_sum", "performance_complete", "development_goals_in_plan", "development_complete", "is_complete",
  ],
};
const BI_VIEWS = Object.keys(BI_COLUMNS);

class RollbackSignal extends Error {}

/** Runs `sql` as gedp_bi inside a transaction that is always rolled back. */
async function asBiRole<T>(db: PrismaClient, sql: string): Promise<T> {
  let rows: T | undefined;
  await db
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE gedp_bi");
      rows = await tx.$queryRawUnsafe<T>(sql);
      throw new RollbackSignal();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollbackSignal)) throw error;
    });
  return rows as T;
}

interface SeededDocs {
  completeId: number;
  incompleteId: number;
  noTemplatesId: number;
}

async function addPlannedGoals(db: PrismaClient, documentId: number): Promise<void> {
  await db.performanceGoal.createMany({
    data: [
      { documentId, title: "Cel A", weight: 60, state: "W_PLANIE" },
      { documentId, title: "Cel B", weight: 40, state: "W_PLANIE" },
      // Drafts are not in the plan, so they must not count towards counts or the weight sum.
      { documentId, title: "Szkic", weight: 50, state: "SZKIC" },
    ],
  });
  await db.developmentGoal.createMany({
    data: [
      { documentId, actionTitle: "Szkolenie", state: "W_PLANIE" },
      { documentId, actionTitle: "Szkic", state: "SZKIC" },
    ],
  });
}

async function seedDocuments(db: PrismaClient): Promise<SeededDocs> {
  const ids = await insertPeople(db, [
    { amei: "BI00001", managerAmei: null },
    { amei: "BI00002", managerAmei: "BI00001" },
    { amei: "BI00003", managerAmei: "BI00001" },
    { amei: "BI00004", managerAmei: "BI00001" },
  ]);
  const managerId = ids.get("BI00001")!;
  const completeOwner = ids.get("BI00002")!;
  const cycle = await db.cycle.create({ data: { year: 2027, status: "OTWARTY" } });
  // Misconfigured cycle: no group-goal templates at all.
  const emptyCycle = await db.cycle.create({ data: { year: 2028, status: "PRZYGOTOWANIE" } });
  const templates = await Promise.all(
    (["PRZYWODZTWO", "WARTOSCI", "BHP"] as const).map((type, i) =>
      db.groupGoalTemplate.create({ data: { cycleId: cycle.id, type, contentPl: type, contentEn: type, sortOrder: i + 1 } }),
    ),
  );

  // Complete: all group goals acknowledged with a BHP commitment, weights 60 + 40 in plan, one development goal.
  const complete = await db.gedpDocument.create({
    data: { employeeId: completeOwner, cycleId: cycle.id, status: "DO_WALIDACJI", validatorId: managerId },
  });
  await db.groupGoalAck.createMany({
    data: templates.map((t) => ({ documentId: complete.id, templateId: t.id, hsCommitment: t.type === "BHP" ? "Zobowiązanie" : null })),
  });
  await addPlannedGoals(db, complete.id);
  await db.documentStatusHistory.createMany({
    data: [
      { documentId: complete.id, fromStatus: null, toStatus: "SZKIC", authorId: completeOwner },
      { documentId: complete.id, fromStatus: "SZKIC", toStatus: "DO_WALIDACJI", authorId: completeOwner },
    ],
  });

  // Incomplete: values not acknowledged, blank BHP commitment, weights sum to 80, no development goal.
  const incomplete = await db.gedpDocument.create({
    data: { employeeId: ids.get("BI00003")!, cycleId: cycle.id, validatorId: managerId },
  });
  await db.groupGoalAck.createMany({
    data: templates
      .filter((t) => t.type !== "WARTOSCI")
      .map((t) => ({ documentId: incomplete.id, templateId: t.id, hsCommitment: t.type === "BHP" ? "   " : null })),
  });
  await db.performanceGoal.create({ data: { documentId: incomplete.id, title: "Cel", weight: 80, state: "W_PLANIE" } });

  // Goals complete, but the cycle has no templates: group flags must be false, not vacuously true.
  const noTemplates = await db.gedpDocument.create({
    data: { employeeId: ids.get("BI00004")!, cycleId: emptyCycle.id, validatorId: managerId },
  });
  await addPlannedGoals(db, noTemplates.id);

  return { completeId: complete.id, incompleteId: incomplete.id, noTemplatesId: noTemplates.id };
}

describe.skipIf(!hasTestDb)("[RPT-12] bi reporting schema - database", () => {
  const db = hasTestDb ? createTestDb() : null!;
  let docs: SeededDocs;

  beforeAll(async () => {
    await resetTestDb(db);
    docs = await seedDocuments(db);
  });
  afterAll(async () => {
    await resetTestDb(db);
    await db.$disconnect();
  });

  it.each(BI_VIEWS)("gedp_bi can SELECT bi.%s and gets the seeded rows", async (view) => {
    const rows = await asBiRole<{ n: number }[]>(db, `SELECT count(*)::int AS n FROM bi.${view}`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it.each(["employee", "gedp_document", "performance_goal", "audit_log", "login_credential"])(
    "gedp_bi cannot read app table public.%s",
    async (table) => {
      await expect(asBiRole(db, `SELECT 1 FROM public.${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
    },
  );

  it("grants gedp_bi nothing on any relation or sequence in schema public, not even single columns", async () => {
    const rows = await db.$queryRawUnsafe<{ relname: string }[]>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND (
        (c.relkind IN ('r', 'v', 'm', 'p', 'f') AND (
          has_table_privilege('gedp_bi', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          OR has_any_column_privilege('gedp_bi', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')))
        OR (c.relkind = 'S' AND has_sequence_privilege('gedp_bi', c.oid, 'USAGE, SELECT, UPDATE')))`);
    expect(rows).toEqual([]);
  });

  it("grants gedp_bi SELECT only on the bi views, never a write, no CREATE and no role memberships", async () => {
    const rows = await db.$queryRawUnsafe<{ view: string; sel: boolean; write: boolean }[]>(`
      SELECT c.relname AS view,
             has_table_privilege('gedp_bi', c.oid, 'SELECT') AS sel,
             has_table_privilege('gedp_bi', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE') AS write
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bi' ORDER BY c.relname`);
    expect(rows.map((r) => r.view)).toEqual([...BI_VIEWS].sort());
    expect(rows.every((r) => r.sel && !r.write)).toBe(true);

    const [schema] = await db.$queryRawUnsafe<{ create_bi: boolean; memberships: number }[]>(`
      SELECT has_schema_privilege('gedp_bi', 'bi', 'CREATE') AS create_bi,
             (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'gedp_bi') AS memberships`);
    expect(schema).toEqual({ create_bi: false, memberships: 0 });
  });

  it("keeps RLS non-forced on the app tables, so the owner-run views keep returning rows", async () => {
    const rows = await db.$queryRawUnsafe<{ relname: string }[]>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity`);
    expect(rows).toEqual([]);
  });

  it("starts gedp_bi sessions read-only (accident guard, not the security boundary)", async () => {
    const rows = await db.$queryRawUnsafe<{ setconfig: string[] }[]>(`
      SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'gedp_bi'`);
    expect(rows.flatMap((r) => r.setconfig)).toContain("default_transaction_read_only=on");
  });

  it("exposes exactly the allow-listed columns (GDPR data minimisation)", async () => {
    const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'bi' ORDER BY table_name, ordinal_position",
    );
    const actual: Record<string, string[]> = {};
    for (const r of rows) actual[r.table_name] = [...(actual[r.table_name] ?? []), r.column_name];
    expect(actual).toEqual(BI_COLUMNS);
  });

  it("reports document status per cycle as plain text", async () => {
    const rows = await asBiRole<{ document_id: number; cycle_year: number; status: string; cycle_status: string }[]>(
      db,
      "SELECT document_id, cycle_year, status, cycle_status FROM bi.document ORDER BY document_id",
    );
    expect(rows).toEqual([
      { document_id: docs.completeId, cycle_year: 2027, status: "DO_WALIDACJI", cycle_status: "OTWARTY" },
      { document_id: docs.incompleteId, cycle_year: 2027, status: "SZKIC", cycle_status: "OTWARTY" },
      { document_id: docs.noTemplatesId, cycle_year: 2028, status: "SZKIC", cycle_status: "PRZYGOTOWANIE" },
    ]);
  });

  it("computes completeness flags from the closing conditions (WF-C1..C5)", async () => {
    const rows = await asBiRole<Record<string, unknown>[]>(
      db,
      `SELECT document_id, leadership_acknowledged, values_acknowledged, hs_commitment_set,
              performance_goals_in_plan::int AS perf_n, performance_weight_sum::int AS weight_sum, performance_complete,
              development_goals_in_plan::int AS dev_n, development_complete, is_complete
       FROM bi.document_completeness ORDER BY document_id`,
    );
    const goalsComplete = { perf_n: 2, weight_sum: 100, performance_complete: true, dev_n: 1, development_complete: true };
    expect(rows).toEqual([
      {
        document_id: docs.completeId,
        leadership_acknowledged: true,
        values_acknowledged: true,
        hs_commitment_set: true,
        ...goalsComplete,
        is_complete: true,
      },
      {
        document_id: docs.incompleteId,
        leadership_acknowledged: true,
        values_acknowledged: false,
        hs_commitment_set: false,
        perf_n: 1,
        weight_sum: 80,
        performance_complete: false,
        dev_n: 0,
        development_complete: false,
        is_complete: false,
      },
      {
        document_id: docs.noTemplatesId,
        leadership_acknowledged: false,
        values_acknowledged: false,
        hs_commitment_set: false,
        ...goalsComplete,
        is_complete: false,
      },
    ]);
  });
});
