import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Client } from "pg";

// Test data for tests/e2e/workflow.spec.ts. The workflow scenarios change documents, so each one
// starts from a known state written straight to the database the app under test uses
// (DATABASE_URL, from .env locally like prisma.config.ts, from the job env in CI).
//
// Scope guard: only synthetic seed people are ever touched - AMEI "AM000xxxx" with an
// @example.com address (prisma/seed.ts) - and only their document in the OPEN cycle. Every
// scenario owns one team of the seeded org tree, picked from the end of the tree (highest AMEI)
// so it stays clear of the people other specs sign in as. Writes run in one transaction each.
// Plain `pg` on purpose: the generated Prisma client is ESM-only and Playwright loads specs as CJS.

const SEED_AMEI = "^AM000[0-9]{4}$";
const SEED_EMAIL = "%@example.com";

export type DocumentStatus = "SZKIC" | "DO_WALIDACJI" | "ZWROCONY" | "ZATWIERDZONY";

export interface Person {
  id: number;
  amei: string;
  /** "First Last", as the team list, the document view and the HR list show it. */
  name: string;
}

/** One team lead (N+1) with two leaf reports, and the team lead's manager (N+2). */
export interface Team {
  employee: Person;
  /** Same N+1 as `employee`. */
  peer: Person;
  manager: Person;
  managerOfManager: Person;
}

/** What a prepared document contains, so the tests can find it on screen. */
export interface PreparedDocument {
  documentId: number;
  performanceGoalTitle: string;
  performanceGoalDescription: string;
}

/** Next's precedence: the process env, then .env.local, then .env. Only DATABASE_URL is read. */
const ENV_FILES = [".env.local", ".env"] as const;
const CONNECT_TIMEOUT_MS = 15_000;
const STATEMENT_TIMEOUT_MS = 30_000;

function connectionString(): string {
  const fromFiles = ENV_FILES.filter((file) => existsSync(file))
    .map((file) => parseEnv(readFileSync(file, "utf8")).DATABASE_URL)
    .find((value) => value);
  const url = process.env.DATABASE_URL || fromFiles;
  if (!url) throw new Error("DATABASE_URL is not set: the workflow E2E needs the app's database to prepare documents");
  return url;
}

/**
 * Refuses any database that holds a person without an @example.com address: real employee data
 * is never synthetic, so this stops a copied production URL before the first write.
 */
async function assertSyntheticDatabase(client: Client): Promise<void> {
  const result = await client.query<{ real: number }>(
    `SELECT count(*)::int AS real FROM employee WHERE email NOT LIKE $1`,
    [SEED_EMAIL],
  );
  if (result.rows[0].real > 0) {
    throw new Error("Refusing to prepare E2E data: the database holds employees that are not synthetic (@example.com)");
  }
}

// One connection per worker, opened on first use: the Supabase session pooler behind the dev
// database has a small client limit, and the app under test shares it.
let shared: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const client = new Client({
    connectionString: connectionString(),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
  // A pooler drop on an idle connection is emitted as 'error'; the next call reconnects.
  client.on("error", () => {
    shared = null;
  });
  try {
    await client.connect();
    await assertSyntheticDatabase(client);
    return client;
  } catch (error: unknown) {
    await client.end().catch(() => undefined);
    throw error;
  }
}

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  if (!shared) {
    const opening = connect();
    shared = opening;
    // A failed connect is not cached: the next call tries again.
    opening.catch(() => {
      if (shared === opening) shared = null;
    });
  }
  return work(await shared);
}

/** Closes the worker's connection; call from test.afterAll. */
export async function closeTestData(): Promise<void> {
  const pending = shared;
  shared = null;
  const client = await pending?.catch(() => null);
  await client?.end();
}

async function inTransaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      // The original error is the one worth reporting, also when the rollback itself fails.
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

/** Every id must be a synthetic seed person, before anything is written for or by them. */
async function assertSyntheticPeople(client: Client, ids: readonly number[]): Promise<void> {
  const unique = [...new Set(ids)];
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM employee WHERE id = ANY($1::int[]) AND amei ~ $2 AND email LIKE $3`,
    [unique, SEED_AMEI, SEED_EMAIL],
  );
  if (result.rows[0].n !== unique.length) {
    throw new Error(`Refusing to write E2E data for non-seed people (ids ${unique.join(", ")})`);
  }
}

interface PersonRow {
  id: number;
  amei: string;
  first_name: string;
  last_name: string;
}

const toPerson = (row: PersonRow): Person => ({ id: row.id, amei: row.amei, name: `${row.first_name} ${row.last_name}` });

interface TeamRow {
  lead: PersonRow;
  boss: PersonRow;
  reports: PersonRow[];
}

/**
 * Team leads (every report is a leaf) whose N+1 and N+2 are active, White Collar and not HR, with
 * at least two active White Collar reports without an HR-set validator. Highest AMEI first, so the
 * same teams come back in every worker.
 */
export async function findTeams(count: number): Promise<Team[]> {
  const rows = await withClient(async (client) => {
    const result = await client.query<TeamRow>(
      `SELECT json_build_object('id', lead.id, 'amei', lead.amei, 'first_name', lead.first_name, 'last_name', lead.last_name) AS lead,
              json_build_object('id', boss.id, 'amei', boss.amei, 'first_name', boss.first_name, 'last_name', boss.last_name) AS boss,
              json_agg(json_build_object('id', r.id, 'amei', r.amei, 'first_name', r.first_name, 'last_name', r.last_name)
                       ORDER BY r.amei) AS reports
         FROM employee lead
         JOIN employee boss ON boss.id = lead.manager_id
         JOIN employee r ON r.manager_id = lead.id
        WHERE lead.amei ~ $1 AND boss.amei ~ $1 AND r.amei ~ $1
          AND lead.email LIKE $2 AND boss.email LIKE $2 AND r.email LIKE $2
          AND lead.is_active AND lead.is_white_collar AND NOT lead.is_hr_admin
          AND boss.is_active AND boss.is_white_collar AND NOT boss.is_hr_admin
          AND r.is_active AND r.is_white_collar AND NOT r.is_hr_admin AND r.validator_override_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM employee x JOIN employee lr ON x.manager_id = lr.id WHERE lr.manager_id = lead.id)
        GROUP BY lead.id, boss.id
       HAVING count(*) >= 2
        ORDER BY lead.amei DESC
        LIMIT $3`,
      [SEED_AMEI, SEED_EMAIL, count],
    );
    return result.rows;
  });
  if (rows.length < count) throw new Error(`Seed has ${rows.length} usable teams, the workflow E2E needs ${count}`);
  return rows.map((row) => ({
    employee: toPerson(row.reports[0]),
    peer: toPerson(row.reports[1]),
    manager: toPerson(row.lead),
    managerOfManager: toPerson(row.boss),
  }));
}

/** Another team lead under the same N+2 (a peer of `team.manager`), for the URL tampering check. */
export async function findPeerManager(team: Team): Promise<Person> {
  const row = await withClient(async (client) => {
    const result = await client.query<PersonRow>(
      `SELECT lead.id, lead.amei, lead.first_name, lead.last_name
         FROM employee lead
        WHERE lead.manager_id = $1 AND lead.id <> $2 AND lead.amei ~ $3 AND lead.email LIKE $4
          AND lead.is_active AND lead.is_white_collar AND NOT lead.is_hr_admin
          AND EXISTS (SELECT 1 FROM employee r WHERE r.manager_id = lead.id)
        ORDER BY lead.amei DESC
        LIMIT 1`,
      [team.managerOfManager.id, team.manager.id, SEED_AMEI, SEED_EMAIL],
    );
    return result.rows[0];
  });
  if (!row) throw new Error(`No other team lead under ${team.managerOfManager.amei}`);
  return toPerson(row);
}

export async function findHrAdmin(): Promise<Person> {
  const row = await withClient(async (client) => {
    const result = await client.query<PersonRow>(
      `SELECT id, amei, first_name, last_name FROM employee
        WHERE is_hr_admin AND is_active AND is_white_collar AND amei ~ $1 AND email LIKE $2
        ORDER BY amei LIMIT 1`,
      [SEED_AMEI, SEED_EMAIL],
    );
    return result.rows[0];
  });
  if (!row) throw new Error("Seed has no active HR admin");
  return toPerson(row);
}

interface CycleRow {
  id: number;
  year: number;
}

async function openCycle(client: Client): Promise<CycleRow> {
  const result = await client.query<CycleRow>(`SELECT id, year FROM cycle WHERE status = 'OTWARTY' ORDER BY year DESC LIMIT 1`);
  const cycle = result.rows[0];
  if (!cycle) throw new Error("No open cycle: run the seed (2027 is OTWARTY)");
  return cycle;
}

/** Year of the open cycle, for dates the scenarios type into the goal forms. */
export async function openCycleYear(): Promise<number> {
  return withClient(async (client) => (await openCycle(client)).year);
}

async function deleteDocuments(client: Client, cycleId: number, employeeIds: readonly number[]): Promise<void> {
  // Goals, acknowledgements and status history go with the document (ON DELETE CASCADE).
  await client.query(
    `DELETE FROM gedp_document d USING employee e
      WHERE d.employee_id = e.id AND d.cycle_id = $1 AND e.id = ANY($2::int[]) AND e.amei ~ $3 AND e.email LIKE $4`,
    [cycleId, employeeIds, SEED_AMEI, SEED_EMAIL],
  );
}

/** No document in the open cycle for these people: Goal Centre creates a fresh draft on first open. */
export async function resetDocuments(people: readonly Person[]): Promise<void> {
  await inTransaction(async (client) => {
    await assertSyntheticPeople(
      client,
      people.map((person) => person.id),
    );
    const cycle = await openCycle(client);
    await deleteDocuments(
      client,
      cycle.id,
      people.map((person) => person.id),
    );
  });
}

type PreparedStatus = Exclude<DocumentStatus, "ZWROCONY">;
type HistoryStep = { from: DocumentStatus | null; to: DocumentStatus; byValidator: boolean };

/** The status history a document in `status` has after the normal road there. */
const HISTORY: Readonly<Record<PreparedStatus, readonly HistoryStep[]>> = {
  SZKIC: [{ from: null, to: "SZKIC", byValidator: false }],
  DO_WALIDACJI: [
    { from: null, to: "SZKIC", byValidator: false },
    { from: "SZKIC", to: "DO_WALIDACJI", byValidator: false },
  ],
  ZATWIERDZONY: [
    { from: null, to: "SZKIC", byValidator: false },
    { from: "SZKIC", to: "DO_WALIDACJI", byValidator: false },
    { from: "DO_WALIDACJI", to: "ZATWIERDZONY", byValidator: true },
  ],
};

async function insertGoals(client: Client, documentId: number, cycle: CycleRow, title: string, description: string) {
  await client.query(
    `INSERT INTO group_goal_ack (document_id, template_id, hs_commitment)
     SELECT $1, t.id, CASE WHEN t.type = 'BHP' THEN $3 ELSE NULL END FROM group_goal_template t WHERE t.cycle_id = $2`,
    [documentId, cycle.id, "Zgłaszam każdą niebezpieczną sytuację w dniu jej zauważenia."],
  );
  await client.query(
    `INSERT INTO performance_goal
       (document_id, title, description, measures, target_type_id, target_value, due_date, progress, weight, state, updated_at)
     SELECT $1, $2, $3, 'Średni czas przezbrojenia w minutach', tt.id, 'Poniżej 30 minut', make_date($4, 9, 30), 0, 100,
            'W_PLANIE', now()
       FROM target_type tt WHERE tt.code = 'TEKST'`,
    [documentId, title, description, cycle.year],
  );
  await client.query(
    `INSERT INTO development_goal
       (document_id, development_area_id, competency_id, action_title, action_description, start_date, end_date,
        progress, state, updated_at)
     SELECT $1, a.id, c.id, 'Szkolenie z metody SMED', 'Udział w warsztatach i wdrożenie na jednej linii.',
            make_date($3, 3, 1), make_date($3, 6, 30), 0, 'W_PLANIE', now()
       FROM development_area a, competency c
      WHERE a.cycle_id = $2 AND c.cycle_id = $2 AND a.is_active AND c.is_active
      ORDER BY a.id, c.id LIMIT 1`,
    [documentId, cycle.id, cycle.year],
  );
  const counts = await client.query<{ acks: number; perf: number; dev: number }>(
    `SELECT (SELECT count(*)::int FROM group_goal_ack WHERE document_id = $1) AS acks,
            (SELECT count(*)::int FROM performance_goal WHERE document_id = $1) AS perf,
            (SELECT count(*)::int FROM development_goal WHERE document_id = $1) AS dev`,
    [documentId],
  );
  const { acks, perf, dev } = counts.rows[0];
  if (acks === 0 || perf !== 1 || dev !== 1) {
    throw new Error(`Seed reference data missing for ${cycle.year}: acks ${acks}, performance ${perf}, development ${dev}`);
  }
}

/**
 * A document that meets every closing condition (WF-C1..C5: both Group goals acknowledged, a BHP
 * commitment, one performance goal in the plan with weight 100, one development goal in the plan),
 * in `status`, with the matching history. Replaces whatever the person had in the open cycle.
 * ZWROCONY is not offered: a return carries the validator's comment, so it goes through the UI.
 */
export async function prepareCompleteDocument(team: Team, status: PreparedStatus, label: string): Promise<PreparedDocument> {
  const owner = team.employee;
  const validator = team.manager;
  const title = `E2E ${label}: skrócenie czasu przezbrojenia`;
  const description = `E2E ${label}: krótszy czas przezbrojenia linii (dane syntetyczne).`;

  const documentId = await inTransaction(async (client) => {
    // Owner, validator (validator_id, history author) - all checked before the first write.
    await assertSyntheticPeople(client, [owner.id, validator.id]);
    const cycle = await openCycle(client);
    await deleteDocuments(client, cycle.id, [owner.id]);
    const document = await client.query<{ id: number }>(
      `INSERT INTO gedp_document (employee_id, cycle_id, status, validator_id, updated_at)
       VALUES ($1, $2, $3::"DocumentStatus", $4, now()) RETURNING id`,
      [owner.id, cycle.id, status, status === "ZATWIERDZONY" ? validator.id : null],
    );
    const id = document.rows[0].id;
    await insertGoals(client, id, cycle, title, description);
    // One row per step; the id keeps the order when the timestamps are equal.
    for (const step of HISTORY[status]) {
      await client.query(
        `INSERT INTO document_status_history (document_id, from_status, to_status, author_id)
         VALUES ($1, $2::"DocumentStatus", $3::"DocumentStatus", $4)`,
        [id, step.from, step.to, step.byValidator ? validator.id : owner.id],
      );
    }
    return id;
  });
  return { documentId, performanceGoalTitle: title, performanceGoalDescription: description };
}

/** The status the database holds now, to confirm a UI action really reached the server. */
export async function documentStatus(documentId: number): Promise<DocumentStatus> {
  const row = await withClient(async (client) => {
    const result = await client.query<{ status: DocumentStatus }>(
      `SELECT status::text AS status FROM gedp_document WHERE id = $1`,
      [documentId],
    );
    return result.rows[0];
  });
  if (!row) throw new Error(`Document ${documentId} not found`);
  return row.status;
}

/** Id of the person's document in the open cycle (Goal Centre creates it on first open). */
export async function ownDocumentId(person: Person): Promise<number> {
  const row = await withClient(async (client) => {
    const result = await client.query<{ id: number }>(
      `SELECT d.id FROM gedp_document d JOIN cycle c ON c.id = d.cycle_id WHERE c.status = 'OTWARTY' AND d.employee_id = $1`,
      [person.id],
    );
    return result.rows[0];
  });
  if (!row) throw new Error(`${person.amei} has no document in the open cycle`);
  return row.id;
}
