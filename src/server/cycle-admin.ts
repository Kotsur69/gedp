import "server-only";
import type { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { CycleStatus, GroupGoalType } from "@/generated/prisma/enums";
import {
  canChangeYear,
  createCycleSchema,
  cycleConfigFieldErrors,
  cycleReadinessGaps,
  cycleSettingsSchema,
  cycleStatusChangeSchema,
  DEFAULT_TARGET_TYPE,
  isCycleConfigEditable,
  shiftDateForCopy,
  statusChangeBlocker,
  type CycleConfigErrorCode,
  type CycleConfigFieldErrors,
  type CycleSettingsInput,
  type ReadinessGap,
} from "@/domain/cycle-config";
import { writeAudit } from "@/server/audit";
import { fromIsoDate, toIsoDate } from "@/server/goal-document";
import { requireActiveHrAdmin, type Viewer } from "@/server/permissions";

// HR panel, cycles (HR-05): the cycle list, one cycle's configuration, creating a cycle (empty or
// as a copy of an existing one), its settings (year, goal-setting dates, closing thresholds) and
// its status. Group goal texts and the lists (competencies, development areas, target types) are
// in cycle-catalog.ts and share the helpers exported here.
//
// Every write: zod check of the untrusted payload before any database call, then ONE transaction
// that re-checks HR against the live employee row, locks the cycle row (FOR UPDATE, so a status
// change and an edit of the same cycle cannot interleave), applies the rules from
// domain/cycle-config.ts, writes, and appends an audit row with before / after. A closed cycle is
// read-only except for its status. "Only one open cycle" is also a partial unique index
// (cycle_single_open_key), which turns a race between two HR users into ANOTHER_OPEN.

export const CYCLE_AUDIT_ENTITY = "cycle";

export type CycleAdminDb = Pick<PrismaClient, "$transaction">;
export type CycleReadDb = Pick<
  PrismaClient,
  "cycle" | "gedpDocument" | "groupGoalTemplate" | "competency" | "developmentArea" | "targetType" | "employee"
>;
export type Tx = Prisma.TransactionClient;

export class CycleAdminError extends Error {
  constructor(
    readonly code: CycleConfigErrorCode,
    readonly fieldErrors: CycleConfigFieldErrors = {},
    /** NOT_READY: what the cycle still lacks. */
    readonly gaps: readonly ReadinessGap[] = [],
  ) {
    super(`Cycle configuration: ${code}`);
    this.name = "CycleAdminError";
  }
}

export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Parses an untrusted payload; INVALID_INPUT with per-field codes when it does not fit. */
export function parsePayload<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CycleAdminError("INVALID_INPUT", cycleConfigFieldErrors(parsed.error));
  return parsed.data;
}

export interface LockedCycle {
  id: number;
  year: number;
  status: CycleStatus;
}

/** HR check against the live row, then the cycle row locked for the rest of the transaction. */
export async function lockCycleForHr(tx: Tx, viewer: Viewer, cycleId: number): Promise<LockedCycle> {
  await requireActiveHrAdmin(tx, viewer);
  const rows = await tx.$queryRaw<LockedCycle[]>`
    SELECT id, year, status::text AS status FROM cycle WHERE id = ${cycleId} FOR UPDATE`;
  const cycle = rows[0];
  if (!cycle) throw new CycleAdminError("NOT_FOUND");
  return cycle;
}

/** As lockCycleForHr, and refuses a closed cycle (its configuration is history). */
export async function lockEditableCycle(tx: Tx, viewer: Viewer, cycleId: number): Promise<LockedCycle> {
  const cycle = await lockCycleForHr(tx, viewer, cycleId);
  if (!isCycleConfigEditable(cycle.status)) throw new CycleAdminError("CYCLE_CLOSED");
  return cycle;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CycleListItem {
  id: number;
  year: number;
  status: CycleStatus;
  goalSettingOpensAt: string | null;
  goalSettingClosesAt: string | null;
  documentCount: number;
}

/** Every cycle, newest first, for the HR panel (HR only, checked against the live row). */
export async function listCyclesForAdmin(db: CycleReadDb, viewer: Viewer): Promise<CycleListItem[]> {
  await requireActiveHrAdmin(db, viewer);
  const rows = await db.cycle.findMany({
    select: {
      id: true,
      year: true,
      status: true,
      goalSettingOpensAt: true,
      goalSettingClosesAt: true,
      _count: { select: { documents: true } },
    },
    orderBy: { year: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    year: row.year,
    status: row.status,
    goalSettingOpensAt: toIsoDate(row.goalSettingOpensAt),
    goalSettingClosesAt: toIsoDate(row.goalSettingClosesAt),
    documentCount: row._count.documents,
  }));
}

export interface CatalogItemView {
  id: number;
  namePl: string;
  nameEn: string;
  isActive: boolean;
  /** Development goals that use it. */
  usage: number;
}

export interface TargetTypeView extends CatalogItemView {
  code: string;
  isNumeric: boolean;
  sortOrder: number;
}

export interface GroupGoalTextView {
  type: GroupGoalType;
  contentPl: string;
  contentEn: string;
  /** Documents that acknowledged this text. */
  acknowledgements: number;
}

export interface CycleConfig {
  id: number;
  year: number;
  status: CycleStatus;
  goalSettingOpensAt: string | null;
  goalSettingClosesAt: string | null;
  minPerformanceGoals: number;
  requiredWeightSum: number;
  minDevelopmentGoals: number;
  documentCount: number;
  /** Year of another open cycle, or null. */
  otherOpenYear: number | null;
  isEditable: boolean;
  canChangeYear: boolean;
  gaps: ReadinessGap[];
  groupGoals: GroupGoalTextView[];
  competencies: CatalogItemView[];
  developmentAreas: CatalogItemView[];
  /** `usage` counts performance goals: a used type keeps its numeric flag. */
  targetTypes: TargetTypeView[];
}

const catalogSelect = {
  id: true,
  namePl: true,
  nameEn: true,
  isActive: true,
  _count: { select: { developmentGoals: true } },
} as const;

type CatalogRow = Prisma.CompetencyGetPayload<{ select: typeof catalogSelect }>;

const toCatalogView = ({ _count, ...row }: CatalogRow): CatalogItemView => ({ ...row, usage: _count.developmentGoals });

/** One cycle's whole configuration by year, or null when there is no such cycle. HR only. */
export async function loadCycleConfig(db: CycleReadDb, viewer: Viewer, year: number): Promise<CycleConfig | null> {
  await requireActiveHrAdmin(db, viewer);
  const cycle = await db.cycle.findUnique({ where: { year } });
  if (!cycle) return null;
  const cycleId = cycle.id;
  const [documentCount, otherOpen, templates, competencies, areas, targetTypes] = await Promise.all([
    db.gedpDocument.count({ where: { cycleId } }),
    db.cycle.findFirst({ where: { status: "OTWARTY", id: { not: cycleId } }, select: { year: true } }),
    db.groupGoalTemplate.findMany({
      where: { cycleId },
      select: { type: true, contentPl: true, contentEn: true, _count: { select: { acks: true } } },
      orderBy: { sortOrder: "asc" },
    }),
    db.competency.findMany({ where: { cycleId }, select: catalogSelect, orderBy: { id: "asc" } }),
    db.developmentArea.findMany({ where: { cycleId }, select: catalogSelect, orderBy: { id: "asc" } }),
    db.targetType.findMany({
      where: { cycleId },
      select: {
        id: true,
        code: true,
        namePl: true,
        nameEn: true,
        isNumeric: true,
        isActive: true,
        sortOrder: true,
        _count: { select: { performanceGoals: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);
  const competencyViews = competencies.map(toCatalogView);
  const areaViews = areas.map(toCatalogView);
  return {
    id: cycleId,
    year: cycle.year,
    status: cycle.status,
    goalSettingOpensAt: toIsoDate(cycle.goalSettingOpensAt),
    goalSettingClosesAt: toIsoDate(cycle.goalSettingClosesAt),
    minPerformanceGoals: cycle.minPerformanceGoals,
    requiredWeightSum: cycle.requiredWeightSum,
    minDevelopmentGoals: cycle.minDevelopmentGoals,
    documentCount,
    otherOpenYear: otherOpen?.year ?? null,
    isEditable: isCycleConfigEditable(cycle.status),
    canChangeYear: canChangeYear(cycle.status, documentCount),
    gaps: cycleReadinessGaps({
      groupGoalTypes: templates.map((template) => template.type),
      targetTypeCodes: targetTypes.map((type) => type.code),
      activeCompetencies: competencyViews.filter((item) => item.isActive).length,
      activeDevelopmentAreas: areaViews.filter((item) => item.isActive).length,
    }),
    groupGoals: templates.map(({ _count, ...template }) => ({ ...template, acknowledgements: _count.acks })),
    competencies: competencyViews,
    developmentAreas: areaViews,
    targetTypes: targetTypes.map(({ _count, ...type }) => ({ ...type, usage: _count.performanceGoals })),
  };
}

/** Readiness of a locked cycle, read inside the write transaction. */
async function readinessGaps(tx: Tx, cycleId: number): Promise<ReadinessGap[]> {
  const [templates, targetTypes, activeCompetencies, activeDevelopmentAreas] = await Promise.all([
    tx.groupGoalTemplate.findMany({ where: { cycleId }, select: { type: true } }),
    tx.targetType.findMany({ where: { cycleId }, select: { code: true } }),
    tx.competency.count({ where: { cycleId, isActive: true } }),
    tx.developmentArea.count({ where: { cycleId, isActive: true } }),
  ]);
  return cycleReadinessGaps({
    groupGoalTypes: templates.map((template) => template.type),
    targetTypeCodes: targetTypes.map((type) => type.code),
    activeCompetencies,
    activeDevelopmentAreas,
  });
}

// ---------------------------------------------------------------------------
// Create (empty or as a copy)
// ---------------------------------------------------------------------------

export interface CreatedCycle {
  id: number;
  year: number;
}

/**
 * "Nowy cykl": a cycle in preparation. With `sourceCycleId` it is a copy of that cycle: dates
 * shifted into the new year, thresholds, group goal texts, competencies, development areas and
 * target types copied as NEW rows (so editing the copy never touches the source), active flags and
 * order kept. Without a source it starts empty, except for the default target type every goal
 * falls back to. One audit row holds the whole created configuration.
 */
export async function createCycle(db: CycleAdminDb, viewer: Viewer, input: unknown): Promise<CreatedCycle> {
  const { year, sourceCycleId } = parsePayload(createCycleSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      await requireActiveHrAdmin(tx, viewer);
      if (await tx.cycle.findUnique({ where: { year }, select: { id: true } })) {
        throw new CycleAdminError("YEAR_TAKEN", { year: "YEAR_TAKEN" });
      }
      return sourceCycleId === null
        ? createEmptyCycle(tx, viewer, year)
        : copyCycle(tx, viewer, year, sourceCycleId);
    });
  } catch (error: unknown) {
    // A concurrent create of the same year loses the race on cycle_year_key. The copied rows cannot
    // collide: the new cycle is empty and the source already satisfies the same per-cycle keys.
    if (isUniqueViolation(error)) throw new CycleAdminError("YEAR_TAKEN", { year: "YEAR_TAKEN" });
    throw error;
  }
}

async function createEmptyCycle(tx: Tx, viewer: Viewer, year: number): Promise<CreatedCycle> {
  const cycle = await tx.cycle.create({ data: { year }, select: { id: true, year: true } });
  const defaultType = { ...DEFAULT_TARGET_TYPE, sortOrder: 1 };
  await tx.targetType.create({ data: { cycleId: cycle.id, ...defaultType } });
  await writeAudit(tx, {
    actorId: viewer.id,
    entity: CYCLE_AUDIT_ENTITY,
    entityId: cycle.id,
    action: "CREATE",
    after: { year, status: "PRZYGOTOWANIE", targetTypes: [defaultType] },
  });
  return cycle;
}

async function copyCycle(tx: Tx, viewer: Viewer, year: number, sourceCycleId: number): Promise<CreatedCycle> {
  const source = await tx.cycle.findUnique({
    where: { id: sourceCycleId },
    include: {
      groupGoalTemplates: { select: { type: true, contentPl: true, contentEn: true, sortOrder: true } },
      competencies: { select: { namePl: true, nameEn: true, isActive: true }, orderBy: { id: "asc" } },
      developmentAreas: { select: { namePl: true, nameEn: true, isActive: true }, orderBy: { id: "asc" } },
      targetTypes: {
        select: { code: true, namePl: true, nameEn: true, isNumeric: true, isActive: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!source) throw new CycleAdminError("NOT_FOUND", { sourceCycleId: "NOT_FOUND" });

  const settings = {
    goalSettingOpensAt: shiftDateForCopy(toIsoDate(source.goalSettingOpensAt), source.year, year),
    goalSettingClosesAt: shiftDateForCopy(toIsoDate(source.goalSettingClosesAt), source.year, year),
    minPerformanceGoals: source.minPerformanceGoals,
    requiredWeightSum: source.requiredWeightSum,
    minDevelopmentGoals: source.minDevelopmentGoals,
  };
  const cycle = await tx.cycle.create({
    data: {
      ...settings,
      year,
      goalSettingOpensAt: fromIsoDate(settings.goalSettingOpensAt),
      goalSettingClosesAt: fromIsoDate(settings.goalSettingClosesAt),
    },
    select: { id: true, year: true },
  });
  const cycleId = cycle.id;
  const withCycle = <T extends object>(rows: readonly T[]) => rows.map((row) => ({ ...row, cycleId }));
  await tx.groupGoalTemplate.createMany({ data: withCycle(source.groupGoalTemplates) });
  await tx.competency.createMany({ data: withCycle(source.competencies) });
  await tx.developmentArea.createMany({ data: withCycle(source.developmentAreas) });
  await tx.targetType.createMany({ data: withCycle(source.targetTypes) });

  await writeAudit(tx, {
    actorId: viewer.id,
    entity: CYCLE_AUDIT_ENTITY,
    entityId: cycleId,
    action: "COPY",
    after: {
      year,
      status: "PRZYGOTOWANIE",
      copiedFrom: { cycleId: source.id, year: source.year },
      ...settings,
      groupGoals: source.groupGoalTemplates,
      competencies: source.competencies,
      developmentAreas: source.developmentAreas,
      targetTypes: source.targetTypes,
    },
  });
  return cycle;
}

// ---------------------------------------------------------------------------
// Settings and status
// ---------------------------------------------------------------------------

type CycleSettings = Omit<CycleSettingsInput, "cycleId">;
const SETTINGS_FIELDS = [
  "year",
  "goalSettingOpensAt",
  "goalSettingClosesAt",
  "minPerformanceGoals",
  "requiredWeightSum",
  "minDevelopmentGoals",
] as const satisfies readonly (keyof CycleSettings)[];

async function readSettings(tx: Tx, cycleId: number): Promise<CycleSettings> {
  const row = await tx.cycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: {
      year: true,
      goalSettingOpensAt: true,
      goalSettingClosesAt: true,
      minPerformanceGoals: true,
      requiredWeightSum: true,
      minDevelopmentGoals: true,
    },
  });
  return {
    ...row,
    goalSettingOpensAt: toIsoDate(row.goalSettingOpensAt),
    goalSettingClosesAt: toIsoDate(row.goalSettingClosesAt),
  };
}

export interface WriteResult {
  changed: boolean;
}

export interface SettingsWriteResult extends WriteResult {
  /** The cycle's address (/admin/cycles/<year>) moved: the caller navigates instead of re-rendering. */
  yearChanged: boolean;
}

/**
 * Year, goal-setting dates and closing thresholds of a cycle that is not closed. The year moves
 * only while the cycle is in preparation and has no document (YEAR_LOCKED otherwise).
 */
export async function updateCycleSettings(
  db: CycleAdminDb,
  viewer: Viewer,
  input: unknown,
): Promise<SettingsWriteResult> {
  const { cycleId, ...settings } = parsePayload(cycleSettingsSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockEditableCycle(tx, viewer, cycleId);
      const before = await readSettings(tx, cycleId);
      // Field by field: no write and no audit row for an unchanged form.
      if (SETTINGS_FIELDS.every((field) => settings[field] === before[field])) {
        return { changed: false, yearChanged: false };
      }

      if (settings.year !== locked.year) {
        const documentCount = await tx.gedpDocument.count({ where: { cycleId } });
        if (!canChangeYear(locked.status, documentCount)) {
          throw new CycleAdminError("YEAR_LOCKED", { year: "YEAR_LOCKED" });
        }
        if (await tx.cycle.findUnique({ where: { year: settings.year }, select: { id: true } })) {
          throw new CycleAdminError("YEAR_TAKEN", { year: "YEAR_TAKEN" });
        }
      }
      await tx.cycle.update({
        where: { id: cycleId },
        data: {
          ...settings,
          goalSettingOpensAt: fromIsoDate(settings.goalSettingOpensAt),
          goalSettingClosesAt: fromIsoDate(settings.goalSettingClosesAt),
        },
      });
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: CYCLE_AUDIT_ENTITY,
        entityId: cycleId,
        action: "UPDATE",
        before,
        after: settings,
      });
      return { changed: true, yearChanged: settings.year !== locked.year };
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new CycleAdminError("YEAR_TAKEN", { year: "YEAR_TAKEN" });
    throw error;
  }
}

/**
 * Moves a cycle between preparation, open and closed (statusChangeBlocker has the rules). Opening
 * also needs a ready configuration; the gaps come back with NOT_READY so the panel can list them.
 */
export async function changeCycleStatus(db: CycleAdminDb, viewer: Viewer, input: unknown): Promise<WriteResult> {
  const { cycleId, status } = parsePayload(cycleStatusChangeSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockCycleForHr(tx, viewer, cycleId);
      if (locked.status === status) return { changed: false };
      const [otherOpen, documentCount, gaps] = await Promise.all([
        tx.cycle.findFirst({ where: { status: "OTWARTY", id: { not: cycleId } }, select: { year: true } }),
        tx.gedpDocument.count({ where: { cycleId } }),
        readinessGaps(tx, cycleId),
      ]);
      const blocker = statusChangeBlocker(locked.status, status, {
        otherOpenYear: otherOpen?.year ?? null,
        documentCount,
        gaps,
      });
      if (blocker) throw new CycleAdminError(blocker, {}, blocker === "NOT_READY" ? gaps : []);

      await tx.cycle.update({ where: { id: cycleId }, data: { status } });
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: CYCLE_AUDIT_ENTITY,
        entityId: cycleId,
        action: "STATUS_CHANGE",
        before: { status: locked.status },
        after: { status },
      });
      return { changed: true };
    });
  } catch (error: unknown) {
    // Two cycles opened at the same time: cycle_single_open_key lets only one through. The update
    // writes nothing but the status, so no other unique key can be behind a P2002 here.
    if (isUniqueViolation(error)) throw new CycleAdminError("ANOTHER_OPEN");
    throw error;
  }
}
