// Prisma client for DB-backed tests (see test-db-url.ts for the safety guard).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { testDatabaseUrl } from "./test-db-url";

export const hasTestDb = testDatabaseUrl() !== null;

export function createTestDb(): PrismaClient {
  const url = testDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/**
 * Empties the tables the domain tests use; CASCADE also clears everything that references
 * employee or cycle (documents, goals, history). audit_log is truncated as the table owner.
 */
export async function resetTestDb(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "employee_hierarchy", "employee", "cycle" RESTART IDENTITY CASCADE',
  );
}

export interface TestPerson {
  amei: string;
  managerAmei: string | null;
}

/** Inserts people in the given order (managers first) and returns their ids by AMEI. */
export async function insertPeople(db: PrismaClient, people: TestPerson[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const p of people) {
    const managerId = p.managerAmei ? ids.get(p.managerAmei) : null;
    if (managerId === undefined) throw new Error(`Manager ${p.managerAmei} must be inserted before ${p.amei}`);
    const row = await db.employee.create({
      data: {
        amei: p.amei,
        email: `${p.amei.toLowerCase()}@example.com`,
        firstName: "Test",
        lastName: p.amei,
        managerId,
      },
    });
    ids.set(p.amei, row.id);
  }
  return ids;
}
