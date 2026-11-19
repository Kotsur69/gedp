import "server-only";
import {
  catalogItemSchema,
  DEFAULT_TARGET_TYPE,
  GROUP_GOAL_TYPES,
  groupGoalTextSchema,
  moveTargetTypeSchema,
  reorderedPositions,
  targetTypeSchema,
  type CatalogItemInput,
  type CatalogKind,
  type TargetTypeInput,
} from "@/domain/cycle-config";
import { writeAudit } from "@/server/audit";
import {
  CycleAdminError,
  isUniqueViolation,
  lockEditableCycle,
  parsePayload,
  type CycleAdminDb,
  type Tx,
  type WriteResult,
} from "@/server/cycle-admin";
import type { Viewer } from "@/server/permissions";

// HR panel, cycles (HR-05): what a cycle offers inside the document. Group goal texts (PL + EN, one
// per type), the competency catalogue and development areas (Part 3) and the target type list
// (Part 2). Same write guarantees as cycle-admin.ts: payload checked first, then one transaction
// with the live HR check, the cycle row locked and refused when closed, an audit row per change.
//
// Nothing here deletes: goals reference these rows (ON DELETE RESTRICT), so HR retires an entry by
// deactivating it. An inactive entry disappears from new goals (the goal forms and the Part 2 / 3
// validation offer active entries only) while existing goals keep showing it.

export interface SavedItem extends WriteResult {
  id: number;
}

// ---------------------------------------------------------------------------
// Group goal texts
// ---------------------------------------------------------------------------

/**
 * PL and EN text of one group goal type. A missing type is created at its usual position
 * (Leadership, Values, BHP). Changing a text employees already acknowledged is allowed (typos) and
 * audited; their acknowledgement stays.
 */
export async function saveGroupGoalText(db: CycleAdminDb, viewer: Viewer, input: unknown): Promise<WriteResult> {
  const { cycleId, type, contentPl, contentEn } = parsePayload(groupGoalTextSchema, input);
  return db.$transaction(async (tx) => {
    await lockEditableCycle(tx, viewer, cycleId);
    const templates = await tx.groupGoalTemplate.findMany({
      where: { cycleId },
      select: { id: true, type: true, contentPl: true, contentEn: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    const existing = templates.find((template) => template.type === type);
    const after = { type, contentPl, contentEn };

    if (existing) {
      if (existing.contentPl === contentPl && existing.contentEn === contentEn) return { changed: false };
      await tx.groupGoalTemplate.update({ where: { id: existing.id }, data: { contentPl, contentEn } });
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: "group_goal_template",
        entityId: existing.id,
        action: "UPDATE",
        before: { cycleId, type, contentPl: existing.contentPl, contentEn: existing.contentEn },
        after: { cycleId, ...after },
      });
      return { changed: true };
    }

    const usualPosition = GROUP_GOAL_TYPES.indexOf(type) + 1;
    const taken = new Set(templates.map((template) => template.sortOrder));
    const sortOrder = taken.has(usualPosition) ? Math.max(0, ...taken) + 1 : usualPosition;
    const created = await tx.groupGoalTemplate.create({ data: { cycleId, sortOrder, ...after } });
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: "group_goal_template",
      entityId: created.id,
      action: "CREATE",
      after: { ...after, cycleId, sortOrder },
    });
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------
// Competencies and development areas
// ---------------------------------------------------------------------------

const CATALOG_AUDIT_ENTITY: Readonly<Record<CatalogKind, string>> = {
  competency: "competency",
  developmentArea: "development_area",
};

interface CatalogRow {
  id: number;
  cycleId: number;
  namePl: string;
  nameEn: string;
  isActive: boolean;
}

type CatalogData = Pick<CatalogRow, "namePl" | "nameEn" | "isActive">;

/** The two catalogue tables have the same shape; this keeps the save logic in one place. */
interface CatalogTable {
  findById(id: number): Promise<CatalogRow | null>;
  findByName(cycleId: number, namePl: string, nameEn: string): Promise<{ id: number; namePl: string } | null>;
  create(cycleId: number, data: CatalogData): Promise<{ id: number }>;
  update(id: number, data: CatalogData): Promise<void>;
}

function catalogTable(tx: Tx, kind: CatalogKind): CatalogTable {
  // Both delegates take identical arguments; the union of their signatures is not callable as is.
  const table = (kind === "competency" ? tx.competency : tx.developmentArea) as unknown as Tx["competency"];
  return {
    findById: (id) =>
      table.findUnique({ where: { id }, select: { id: true, cycleId: true, namePl: true, nameEn: true, isActive: true } }),
    // Case-insensitive, so "Innowacyjność" and "innowacyjność" are not two competencies.
    findByName: (cycleId, namePl, nameEn) =>
      table.findFirst({
        where: {
          cycleId,
          OR: [
            { namePl: { equals: namePl, mode: "insensitive" } },
            { nameEn: { equals: nameEn, mode: "insensitive" } },
          ],
        },
        select: { id: true, namePl: true },
      }),
    create: (cycleId, data) => table.create({ data: { cycleId, ...data }, select: { id: true } }),
    update: async (id, data) => {
      await table.update({ where: { id }, data });
    },
  };
}

/** Adds (`id` null) or edits a competency or development area: names PL / EN and active flag. */
export async function saveCatalogItem(db: CycleAdminDb, viewer: Viewer, input: unknown): Promise<SavedItem> {
  const item = parsePayload(catalogItemSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      await lockEditableCycle(tx, viewer, item.cycleId);
      return writeCatalogItem(tx, viewer, item);
    });
  } catch (error: unknown) {
    // Lost a race against a concurrent save of the same name (unique per cycle and language).
    if (isUniqueViolation(error)) throw new CycleAdminError("DUPLICATE_NAME", { namePl: "DUPLICATE_NAME" });
    throw error;
  }
}

async function writeCatalogItem(tx: Tx, viewer: Viewer, item: CatalogItemInput): Promise<SavedItem> {
  const table = catalogTable(tx, item.kind);
  const entity = CATALOG_AUDIT_ENTITY[item.kind];
  const data: CatalogData = { namePl: item.namePl, nameEn: item.nameEn, isActive: item.isActive };

  const before = item.id === null ? null : await table.findById(item.id);
  if (item.id !== null && (!before || before.cycleId !== item.cycleId)) throw new CycleAdminError("NOT_FOUND");
  if (before && before.namePl === data.namePl && before.nameEn === data.nameEn && before.isActive === data.isActive) {
    return { id: before.id, changed: false };
  }

  const clash = await table.findByName(item.cycleId, data.namePl, data.nameEn);
  if (clash && clash.id !== item.id) {
    const field = clash.namePl.toLowerCase() === data.namePl.toLowerCase() ? "namePl" : "nameEn";
    throw new CycleAdminError("DUPLICATE_NAME", { [field]: "DUPLICATE_NAME" });
  }

  if (before) {
    await table.update(before.id, data);
    await writeAudit(tx, {
      actorId: viewer.id,
      entity,
      entityId: before.id,
      action: "UPDATE",
      before: { cycleId: item.cycleId, namePl: before.namePl, nameEn: before.nameEn, isActive: before.isActive },
      after: { cycleId: item.cycleId, ...data },
    });
    return { id: before.id, changed: true };
  }
  const created = await table.create(item.cycleId, data);
  await writeAudit(tx, {
    actorId: viewer.id,
    entity,
    entityId: created.id,
    action: "CREATE",
    after: { cycleId: item.cycleId, ...data },
  });
  return { id: created.id, changed: true };
}

// ---------------------------------------------------------------------------
// Target types
// ---------------------------------------------------------------------------

const TARGET_TYPE_AUDIT_ENTITY = "target_type";

/**
 * Adds (`id` null) or edits a target type. The code is fixed once created (goals copied from last
 * year find their type by code). The numeric flag only changes while no goal uses the type, since
 * existing targets were validated against it. The default type ("Tekst") stays active: every goal
 * without a usable type falls back to it.
 */
export async function saveTargetType(db: CycleAdminDb, viewer: Viewer, input: unknown): Promise<SavedItem> {
  const type = parsePayload(targetTypeSchema, input);
  try {
    return await db.$transaction(async (tx) => {
      await lockEditableCycle(tx, viewer, type.cycleId);
      return type.id === null ? createTargetType(tx, viewer, type) : updateTargetType(tx, viewer, type, type.id);
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new CycleAdminError("DUPLICATE_CODE", { code: "DUPLICATE_CODE" });
    throw error;
  }
}

async function createTargetType(tx: Tx, viewer: Viewer, type: TargetTypeInput): Promise<SavedItem> {
  const { cycleId, code } = type;
  if (await tx.targetType.findUnique({ where: { cycleId_code: { cycleId, code } }, select: { id: true } })) {
    throw new CycleAdminError("DUPLICATE_CODE", { code: "DUPLICATE_CODE" });
  }
  const last = await tx.targetType.aggregate({ where: { cycleId }, _max: { sortOrder: true } });
  const data = {
    code,
    namePl: type.namePl,
    nameEn: type.nameEn,
    isNumeric: type.isNumeric,
    isActive: type.isActive,
    sortOrder: (last._max.sortOrder ?? 0) + 1,
  };
  const created = await tx.targetType.create({ data: { cycleId, ...data }, select: { id: true } });
  await writeAudit(tx, {
    actorId: viewer.id,
    entity: TARGET_TYPE_AUDIT_ENTITY,
    entityId: created.id,
    action: "CREATE",
    after: { cycleId, ...data },
  });
  return { id: created.id, changed: true };
}

async function updateTargetType(tx: Tx, viewer: Viewer, type: TargetTypeInput, id: number): Promise<SavedItem> {
  const before = await tx.targetType.findUnique({
    where: { id },
    select: {
      cycleId: true,
      code: true,
      namePl: true,
      nameEn: true,
      isNumeric: true,
      isActive: true,
      _count: { select: { performanceGoals: true } },
    },
  });
  if (!before || before.cycleId !== type.cycleId) throw new CycleAdminError("NOT_FOUND");
  // The form shows the code read-only; a different code is a hand-crafted request.
  if (before.code !== type.code) throw new CycleAdminError("INVALID_INPUT", { code: "INVALID_INPUT" });

  const data = { namePl: type.namePl, nameEn: type.nameEn, isNumeric: type.isNumeric, isActive: type.isActive };
  const previous = {
    namePl: before.namePl,
    nameEn: before.nameEn,
    isNumeric: before.isNumeric,
    isActive: before.isActive,
  };
  if ((Object.keys(data) as (keyof typeof data)[]).every((field) => data[field] === previous[field])) {
    return { id, changed: false };
  }
  if (before.code === DEFAULT_TARGET_TYPE.code && !data.isActive) {
    throw new CycleAdminError("DEFAULT_TYPE_LOCKED", { isActive: "DEFAULT_TYPE_LOCKED" });
  }
  // Known gap: goal saves lock their document, not this row, so a goal created in the same instant as
  // this check can still be validated against the old flag. Accepted: HR flips the flag of an unused
  // type, and the window is one transaction wide.
  if (data.isNumeric !== previous.isNumeric && before._count.performanceGoals > 0) {
    throw new CycleAdminError("TYPE_IN_USE", { isNumeric: "TYPE_IN_USE" });
  }

  await tx.targetType.update({ where: { id }, data });
  await writeAudit(tx, {
    actorId: viewer.id,
    entity: TARGET_TYPE_AUDIT_ENTITY,
    entityId: id,
    action: "UPDATE",
    before: { cycleId: type.cycleId, code: before.code, ...previous },
    after: { cycleId: type.cycleId, code: before.code, ...data },
  });
  return { id, changed: true };
}

/** Moves a target type one place up or down in the list the goal form shows. */
export async function moveTargetType(db: CycleAdminDb, viewer: Viewer, input: unknown): Promise<WriteResult> {
  const { cycleId, id, direction } = parsePayload(moveTargetTypeSchema, input);
  return db.$transaction(async (tx) => {
    await lockEditableCycle(tx, viewer, cycleId);
    const items = await tx.targetType.findMany({ where: { cycleId }, select: { id: true, sortOrder: true } });
    if (!items.some((item) => item.id === id)) throw new CycleAdminError("NOT_FOUND");
    const changes = reorderedPositions(items, id, direction);
    if (changes.length === 0) return { changed: false };

    for (const change of changes) {
      await tx.targetType.update({ where: { id: change.id }, data: { sortOrder: change.sortOrder } });
    }
    const previous = new Map(items.map((item) => [item.id, item.sortOrder]));
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: TARGET_TYPE_AUDIT_ENTITY,
      entityId: id,
      action: "REORDER",
      before: changes.map((change) => ({ id: change.id, sortOrder: previous.get(change.id) })),
      after: changes,
    });
    return { changed: true };
  });
}
