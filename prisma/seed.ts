// Synthetic, idempotent seed for local development and tests (plan section 6: never real employees).
// Every row is keyed by a natural unique key (AMEI, year, code, ...) and upserted, and the child rows of
// seeded documents are replaced, so running `npm run db:seed` twice leaves the database in the same state.
// The employee_hierarchy closure table is NOT filled here - its rebuild is a separate task.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import {
  COMPETENCIES,
  CONTENT_BLOCK_KEYS,
  DEPARTMENTS,
  DEVELOPMENT_AREAS,
  FIRST_NAMES,
  GROUP_GOAL_TEMPLATES,
  LAST_NAMES,
  LOCATIONS,
  SAMPLE_PERFORMANCE_GOALS,
  TARGET_TYPES,
  TO_BE_DIRECTED,
} from "./seed-data";

type Tx = Prisma.TransactionClient;

// Org tree shape: 1 top person -> 5 directors -> 4 managers each -> 3 team leads each -> 2 specialists each
// = 1 + 5 + 20 + 60 + 120 = 206 employees in 5 levels.
const CHILDREN_PER_LEVEL = [5, 4, 3, 2] as const;
const HR_ADMIN_COUNT = 3;
// Among the 120 leaf employees, every 12th (offset 5) is inactive and every 12th (offset 9) is not White Collar.
const LEAF_FLAG_PERIOD = 12;
const INACTIVE_OFFSET = 5;
const NON_WHITE_COLLAR_OFFSET = 9;
const DOCS_2026_LEAVES = 6;
const DOCS_2026_TEAM_LEADS = 2;
const TX_TIMEOUT_MS = 120_000;
const FIXED_PUBLISHED_AT = new Date("2026-11-01T08:00:00Z");

interface EmployeeSpec {
  index: number;
  level: number;
  amei: string;
  managerAmei: string | null;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  position: string;
  location: string;
  isWhiteCollar: boolean;
  isActive: boolean;
  isHrAdmin: boolean;
}

const POSITIONS = ["Dyrektor Zarządzający", "Dyrektor", "Kierownik", "Lider zespołu", "Specjalista"] as const;

function toAscii(text: string): string {
  return text.replace(/ł/g, "l").replace(/Ł/g, "L").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function buildEmployeeSpecs(): EmployeeSpec[] {
  const specs: EmployeeSpec[] = [];
  const makeSpec = (level: number, manager: EmployeeSpec | null, branch: number): EmployeeSpec => {
    const index = specs.length + 1;
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(index * 7) % LAST_NAMES.length];
    const amei = `AM${String(1000 + index).padStart(7, "0")}`;
    const spec: EmployeeSpec = {
      index,
      level,
      amei,
      managerAmei: manager?.amei ?? null,
      firstName,
      lastName,
      email: `${toAscii(firstName)}.${toAscii(lastName)}.${index}@example.com`,
      department: level === 1 ? null : DEPARTMENTS[branch],
      position: POSITIONS[level - 1],
      location: LOCATIONS[index % LOCATIONS.length],
      isWhiteCollar: true,
      isActive: true,
      isHrAdmin: false,
    };
    specs.push(spec);
    return spec;
  };

  // Breadth-first so every manager is created before their reports.
  let currentLevel = [{ spec: makeSpec(1, null, 0), branch: 0 }];
  CHILDREN_PER_LEVEL.forEach((childCount, depth) => {
    currentLevel = currentLevel.flatMap(({ spec, branch }) =>
      Array.from({ length: childCount }, (_, i) => {
        const childBranch = depth === 0 ? i : branch;
        return { spec: makeSpec(depth + 2, spec, childBranch), branch: childBranch };
      }),
    );
  });

  const leafLevel = CHILDREN_PER_LEVEL.length + 1;
  const hrDepartment = "HR";
  const hrAdminIndexes = new Set(
    specs.filter((s) => s.department === hrDepartment && s.level > 2).slice(0, HR_ADMIN_COUNT).map((s) => s.index),
  );
  let leafCounter = 0;
  return specs.map((spec) => {
    const isLeaf = spec.level === leafLevel;
    const leafPos = isLeaf ? leafCounter++ % LEAF_FLAG_PERIOD : -1;
    const isWhiteCollar = leafPos !== NON_WHITE_COLLAR_OFFSET;
    return {
      ...spec,
      isActive: leafPos !== INACTIVE_OFFSET,
      isWhiteCollar,
      position: isWhiteCollar ? spec.position : "Operator",
      isHrAdmin: hrAdminIndexes.has(spec.index),
    };
  });
}

async function seedEmployees(tx: Tx, specs: EmployeeSpec[]): Promise<Map<string, number>> {
  const idByAmei = new Map<string, number>();
  for (const spec of specs) {
    const managerId = spec.managerAmei ? idByAmei.get(spec.managerAmei) : null;
    if (managerId === undefined) throw new Error(`Manager ${spec.managerAmei} of ${spec.amei} was not seeded first`);
    const data = {
      email: spec.email,
      firstName: spec.firstName,
      lastName: spec.lastName,
      managerId,
      validatorOverrideId: null,
      department: spec.department,
      position: spec.position,
      location: spec.location,
      isWhiteCollar: spec.isWhiteCollar,
      isActive: spec.isActive,
      isHrAdmin: spec.isHrAdmin,
    };
    const row = await tx.employee.upsert({ where: { amei: spec.amei }, update: data, create: { amei: spec.amei, ...data } });
    idByAmei.set(spec.amei, row.id);
  }
  return idByAmei;
}

async function seedCycle(tx: Tx, year: number, status: "OTWARTY" | "ZAMKNIETY"): Promise<number> {
  const data = {
    status,
    goalSettingOpensAt: new Date(`${year}-01-25`),
    goalSettingClosesAt: new Date(`${year}-03-31`),
    minPerformanceGoals: 1,
    requiredWeightSum: 100,
    minDevelopmentGoals: 1,
  };
  const cycle = await tx.cycle.upsert({ where: { year }, update: data, create: { year, ...data } });

  for (const t of GROUP_GOAL_TEMPLATES) {
    const tplData = { type: t.type, contentPl: t.contentPl, contentEn: t.contentEn };
    await tx.groupGoalTemplate.upsert({
      where: { cycleId_sortOrder: { cycleId: cycle.id, sortOrder: t.sortOrder } },
      update: tplData,
      create: { cycleId: cycle.id, sortOrder: t.sortOrder, ...tplData },
    });
  }
  for (const c of COMPETENCIES) {
    await tx.competency.upsert({
      where: { cycleId_nameEn: { cycleId: cycle.id, nameEn: c.nameEn } },
      update: { namePl: c.namePl, isActive: true },
      create: { cycleId: cycle.id, ...c },
    });
  }
  for (const a of DEVELOPMENT_AREAS) {
    await tx.developmentArea.upsert({
      where: { cycleId_nameEn: { cycleId: cycle.id, nameEn: a.nameEn } },
      update: { namePl: a.namePl, isActive: true },
      create: { cycleId: cycle.id, ...a },
    });
  }
  return cycle.id;
}

async function seedReferenceData(tx: Tx): Promise<void> {
  for (const t of TARGET_TYPES) {
    const data = { namePl: t.namePl, nameEn: t.nameEn, isNumeric: t.isNumeric, isActive: true };
    await tx.targetType.upsert({ where: { code: t.code }, update: data, create: { code: t.code, ...data } });
  }
  for (const key of CONTENT_BLOCK_KEYS) {
    const data = { contentPl: TO_BE_DIRECTED, contentEn: TO_BE_DIRECTED, publishedAt: FIXED_PUBLISHED_AT };
    await tx.contentBlock.upsert({
      where: { key_version: { key, version: 1 } },
      update: data,
      create: { key, version: 1, ...data },
    });
  }
}

// Approved 2026 documents with goals, so "copy from previous year" can be tested against the 2027 cycle.
async function seedDocuments2026(tx: Tx, cycleId: number, specs: EmployeeSpec[], idByAmei: Map<string, number>) {
  const eligible = specs.filter((s) => s.isActive && s.isWhiteCollar && s.managerAmei);
  const owners = [
    ...eligible.filter((s) => s.level === 5).slice(0, DOCS_2026_LEAVES),
    ...eligible.filter((s) => s.level === 4).slice(0, DOCS_2026_TEAM_LEADS),
  ];
  const templates = await tx.groupGoalTemplate.findMany({ where: { cycleId }, orderBy: { sortOrder: "asc" } });
  const targetTypes = await tx.targetType.findMany();
  const targetIdByCode = new Map(targetTypes.map((t) => [t.code, t.id]));
  const area = await tx.developmentArea.findFirstOrThrow({ where: { cycleId } });
  const competencies = await tx.competency.findMany({ where: { cycleId }, orderBy: { nameEn: "asc" } });

  for (const [n, owner] of owners.entries()) {
    if (!owner.managerAmei) throw new Error(`Document owner ${owner.amei} has no manager`);
    const employeeId = requireId(idByAmei, owner.amei);
    const validatorId = requireId(idByAmei, owner.managerAmei);
    const doc = await tx.gedpDocument.upsert({
      where: { employeeId_cycleId: { employeeId, cycleId } },
      update: { status: "ZATWIERDZONY", validatorId },
      create: { employeeId, cycleId, status: "ZATWIERDZONY", validatorId },
    });
    // Replace children so re-runs do not duplicate goals or history.
    const byDoc = { where: { documentId: doc.id } };
    await tx.groupGoalAck.deleteMany(byDoc);
    await tx.performanceGoal.deleteMany(byDoc);
    await tx.developmentGoal.deleteMany(byDoc);
    await tx.documentStatusHistory.deleteMany(byDoc);

    await tx.groupGoalAck.createMany({
      data: templates.map((t) => ({
        documentId: doc.id,
        templateId: t.id,
        acknowledgedAt: new Date("2026-02-02T09:00:00Z"),
        hsCommitment: t.type === "BHP" ? "Zgłaszam każdą niebezpieczną sytuację w dniu jej zauważenia." : null,
      })),
    });

    const goals = [SAMPLE_PERFORMANCE_GOALS[n % 6], SAMPLE_PERFORMANCE_GOALS[(n + 1) % 6], SAMPLE_PERFORMANCE_GOALS[(n + 3) % 6]];
    const weights = [50, 30, 20];
    await tx.performanceGoal.createMany({
      data: goals.map((g, i) => ({
        documentId: doc.id,
        title: g.title,
        description: `${g.title} (dane syntetyczne)`,
        measures: g.measures,
        targetTypeId: targetIdByCode.get(g.targetCode) ?? null,
        targetValue: g.targetValue,
        dueDate: new Date("2026-12-31"),
        progress: 100 - i * 25,
        weight: weights[i],
        state: "W_PLANIE" as const,
      })),
    });

    await tx.developmentGoal.create({
      data: {
        documentId: doc.id,
        developmentAreaId: area.id,
        competencyId: competencies[n % competencies.length].id,
        actionTitle: "Udział w szkoleniu wewnętrznym",
        actionDescription: "Szkolenie i zastosowanie wiedzy w bieżącej pracy (dane syntetyczne).",
        startDate: new Date("2026-03-01"),
        endDate: new Date("2026-11-30"),
        progress: 100,
        state: "W_PLANIE",
      },
    });

    await tx.documentStatusHistory.createMany({
      data: [
        { documentId: doc.id, fromStatus: null, toStatus: "SZKIC", authorId: employeeId, createdAt: new Date("2026-01-26T08:00:00Z") },
        { documentId: doc.id, fromStatus: "SZKIC", toStatus: "DO_WALIDACJI", authorId: employeeId, createdAt: new Date("2026-02-10T10:00:00Z") },
        { documentId: doc.id, fromStatus: "DO_WALIDACJI", toStatus: "ZATWIERDZONY", authorId: validatorId, createdAt: new Date("2026-02-15T12:00:00Z") },
      ],
    });
  }
  return owners.length;
}

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The seed overwrites rows by AMEI and replaces document children, so it must never hit a shared database.
function assertLocalDatabase(connectionString: string): void {
  const host = new URL(connectionString).hostname;
  if (LOCAL_DB_HOSTS.has(host) || process.env.SEED_ALLOW_REMOTE === "1") return;
  throw new Error(`Refusing to seed non-local database host "${host}" (set SEED_ALLOW_REMOTE=1 to override)`);
}

function requireId(idByAmei: Map<string, number>, amei: string): number {
  const id = idByAmei.get(amei);
  if (id === undefined) throw new Error(`Employee ${amei} was not seeded`);
  return id;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set - copy .env.example to .env");
  assertLocalDatabase(connectionString);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const specs = buildEmployeeSpecs();
    const docCount = await prisma.$transaction(
      async (tx) => {
        const idByAmei = await seedEmployees(tx, specs);
        await seedReferenceData(tx);
        const cycle2026 = await seedCycle(tx, 2026, "ZAMKNIETY");
        await seedCycle(tx, 2027, "OTWARTY");
        return seedDocuments2026(tx, cycle2026, specs, idByAmei);
      },
      { timeout: TX_TIMEOUT_MS },
    );
    console.info(`Seed done: ${specs.length} employees, cycles 2026/2027, ${docCount} documents for 2026.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
