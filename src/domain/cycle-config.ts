import { z } from "zod";
import { moveToYear, parseIsoDate, toIsoDate } from "@/domain/calendar-date";

// HR-05: cycle configuration in the HR panel. Client-safe (zod only): ONE schema per form, used by
// the form for messages under the inputs and by the server for the real check. Issue messages are
// error codes the UI translates. The pure rules below (status change, readiness, date shift on
// copy, reordering) are what the server enforces; the UI only mirrors them.

export const MIN_CYCLE_YEAR = 2000;
export const MAX_CYCLE_YEAR = 2100;
export const CYCLE_STATUSES = ["PRZYGOTOWANIE", "OTWARTY", "ZAMKNIETY"] as const;
export type CycleStatusValue = (typeof CYCLE_STATUSES)[number];
export const GROUP_GOAL_TYPES = ["PRZYWODZTWO", "WARTOSCI", "BHP"] as const;
export type GroupGoalTypeValue = (typeof GROUP_GOAL_TYPES)[number];
export const CATALOG_KINDS = ["competency", "developmentArea"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** The target type every goal falls back to (same code as DEFAULT_TARGET_TYPE_CODE in Part 2). */
export const DEFAULT_TARGET_TYPE = { code: "TEKST", namePl: "Tekst", nameEn: "Text", isNumeric: false } as const;

export const MAX_NAME_LENGTH = 200;
export const MAX_GROUP_GOAL_TEXT_LENGTH = 20_000;
/** Same ceiling as MAX_GOALS_PER_DOCUMENT: a higher minimum could never be met. */
export const MAX_MIN_GOALS = 50;
/** Weights are whole percent. */
export const MAX_WEIGHT_SUM = 100;
const MAX_INT4 = 2_147_483_647;
/** Upper-case code, stable across copied cycles (icons and labels are keyed by it). */
export const TARGET_TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,29}$/;

// No control or invisible bidi characters in names; group goal texts may also hold tabs and line breaks.
const HIDDEN_CHARACTERS = /[\p{Cc}​-‏‪-‮⁠-⁩﻿]/u;
const HIDDEN_EXCEPT_LINE_BREAKS = /[\x00-\x08\x0B-\x1F\x7F-\x9F​-‏‪-‮⁠-⁩﻿]/u;

export const CYCLE_CONFIG_ERROR_CODES = [
  "INVALID_INPUT",
  "REQUIRED",
  "TEXT_TOO_LONG",
  "INVALID_TEXT",
  "OUT_OF_RANGE",
  "INVALID_DATE",
  "DATES_ORDER",
  "CODE_FORMAT",
  "NOT_FOUND",
  "YEAR_TAKEN",
  "YEAR_LOCKED",
  "ANOTHER_OPEN",
  "NOT_READY",
  "HAS_DOCUMENTS",
  "CYCLE_CLOSED",
  "DUPLICATE_NAME",
  "DUPLICATE_CODE",
  "DEFAULT_TYPE_LOCKED",
  "TYPE_IN_USE",
] as const;
export type CycleConfigErrorCode = (typeof CYCLE_CONFIG_ERROR_CODES)[number];
export type CycleConfigFieldErrors = Partial<Record<string, CycleConfigErrorCode>>;

const isErrorCode = (value: unknown): value is CycleConfigErrorCode =>
  typeof value === "string" && (CYCLE_CONFIG_ERROR_CODES as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const id = z.number("INVALID_INPUT").int("INVALID_INPUT").min(1, "INVALID_INPUT").max(MAX_INT4, "INVALID_INPUT");
const flag = z.boolean("INVALID_INPUT");

const year = z
  .number("REQUIRED")
  .int("OUT_OF_RANGE")
  .min(MIN_CYCLE_YEAR, "OUT_OF_RANGE")
  .max(MAX_CYCLE_YEAR, "OUT_OF_RANGE");

const count = (max: number) => z.number("REQUIRED").int("OUT_OF_RANGE").min(0, "OUT_OF_RANGE").max(max, "OUT_OF_RANGE");

/** "" or null = no date; otherwise a real calendar day as YYYY-MM-DD. */
const optionalDate = z
  .union([z.string("INVALID_DATE").trim(), z.null()], "INVALID_DATE")
  .refine((value) => value === null || value === "" || parseIsoDate(value) !== null, "INVALID_DATE")
  .transform((value) => (value === null || value === "" ? null : value));

const name = z
  .string("INVALID_INPUT")
  .trim()
  .min(1, "REQUIRED")
  .max(MAX_NAME_LENGTH, "TEXT_TOO_LONG")
  .refine((value) => !HIDDEN_CHARACTERS.test(value), "INVALID_TEXT");

const groupGoalText = z
  .string("INVALID_INPUT")
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1, "REQUIRED")
      .max(MAX_GROUP_GOAL_TEXT_LENGTH, "TEXT_TOO_LONG")
      .refine((value) => !HIDDEN_EXCEPT_LINE_BREAKS.test(value), "INVALID_TEXT"),
  );

const targetTypeCode = z
  .string("INVALID_INPUT")
  .trim()
  .toUpperCase()
  .regex(TARGET_TYPE_CODE_PATTERN, "CODE_FORMAT");

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------

/** "Nowy cykl": empty, or a copy of an existing cycle (`sourceCycleId`). */
export const createCycleSchema = z.object({ year, sourceCycleId: id.nullable() }).strict();

export const cycleSettingsSchema = z
  .object({
    cycleId: id,
    year,
    goalSettingOpensAt: optionalDate,
    goalSettingClosesAt: optionalDate,
    minPerformanceGoals: count(MAX_MIN_GOALS),
    requiredWeightSum: count(MAX_WEIGHT_SUM),
    minDevelopmentGoals: count(MAX_MIN_GOALS),
  })
  .strict()
  .refine(
    (value) =>
      value.goalSettingOpensAt === null ||
      value.goalSettingClosesAt === null ||
      value.goalSettingOpensAt <= value.goalSettingClosesAt,
    { message: "DATES_ORDER", path: ["goalSettingClosesAt"] },
  );

export const cycleStatusChangeSchema = z
  .object({ cycleId: id, status: z.enum(CYCLE_STATUSES, "INVALID_INPUT") })
  .strict();

export const groupGoalTextSchema = z
  .object({
    cycleId: id,
    type: z.enum(GROUP_GOAL_TYPES, "INVALID_INPUT"),
    contentPl: groupGoalText,
    contentEn: groupGoalText,
  })
  .strict();

/** A competency or a development area: new (`id` null) or edited. */
export const catalogItemSchema = z
  .object({
    cycleId: id,
    kind: z.enum(CATALOG_KINDS, "INVALID_INPUT"),
    id: id.nullable(),
    namePl: name,
    nameEn: name,
    isActive: flag,
  })
  .strict();

/** A target type: new (`id` null) or edited. The code of an existing type never changes. */
export const targetTypeSchema = z
  .object({
    cycleId: id,
    id: id.nullable(),
    code: targetTypeCode,
    namePl: name,
    nameEn: name,
    isNumeric: flag,
    isActive: flag,
  })
  .strict();

export const moveTargetTypeSchema = z
  .object({ cycleId: id, id, direction: z.enum(["up", "down"], "INVALID_INPUT") })
  .strict();

export type CreateCycleInput = z.output<typeof createCycleSchema>;
export type CycleSettingsPayload = z.input<typeof cycleSettingsSchema>;
export type CycleSettingsInput = z.output<typeof cycleSettingsSchema>;
export type GroupGoalTextInput = z.output<typeof groupGoalTextSchema>;
export type CatalogItemInput = z.output<typeof catalogItemSchema>;
export type TargetTypeInput = z.output<typeof targetTypeSchema>;
export type MoveTargetTypeInput = z.output<typeof moveTargetTypeSchema>;

/** First error code per field, for messages under the inputs. */
export function cycleConfigFieldErrors(error: z.ZodError): CycleConfigFieldErrors {
  const errors: CycleConfigFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || errors[field] !== undefined) continue;
    errors[field] = isErrorCode(issue.message) ? issue.message : "INVALID_INPUT";
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** A closed cycle is history: its configuration is read-only until HR reopens it. */
export function isCycleConfigEditable(status: CycleStatusValue): boolean {
  return status !== "ZAMKNIETY";
}

/** The year names the cycle (copy from last year, selector), so it moves only before any document. */
export function canChangeYear(status: CycleStatusValue, documentCount: number): boolean {
  return status === "PRZYGOTOWANIE" && documentCount === 0;
}

export type ReadinessGap =
  | `GROUP_GOAL_${GroupGoalTypeValue}`
  | "DEFAULT_TARGET_TYPE"
  | "ACTIVE_COMPETENCY"
  | "ACTIVE_DEVELOPMENT_AREA";

export interface CycleReadinessFacts {
  groupGoalTypes: readonly GroupGoalTypeValue[];
  targetTypeCodes: readonly string[];
  activeCompetencies: number;
  activeDevelopmentAreas: number;
}

/**
 * What an open cycle needs so every part of the document works: the three group goal texts, the
 * default target type (Part 2 falls back to it), a competency and an area to pick in Part 3.
 * Empty = ready to open.
 */
export function cycleReadinessGaps(facts: CycleReadinessFacts): ReadinessGap[] {
  const gaps: ReadinessGap[] = GROUP_GOAL_TYPES.filter((type) => !facts.groupGoalTypes.includes(type)).map(
    (type) => `GROUP_GOAL_${type}` as const,
  );
  if (!facts.targetTypeCodes.includes(DEFAULT_TARGET_TYPE.code)) gaps.push("DEFAULT_TARGET_TYPE");
  if (facts.activeCompetencies === 0) gaps.push("ACTIVE_COMPETENCY");
  if (facts.activeDevelopmentAreas === 0) gaps.push("ACTIVE_DEVELOPMENT_AREA");
  return gaps;
}

export interface StatusChangeFacts {
  /** Year of another cycle that is open now, or null. */
  otherOpenYear: number | null;
  documentCount: number;
  gaps: readonly ReadinessGap[];
}

/**
 * Why the cycle may not move from `from` to `to`, or null when it may. Opening needs a ready cycle
 * and no other open one (the database enforces the latter too). Going back to preparation would
 * hide documents employees already have, so it is only possible before the first document.
 */
export function statusChangeBlocker(
  from: CycleStatusValue,
  to: CycleStatusValue,
  facts: StatusChangeFacts,
): CycleConfigErrorCode | null {
  if (from === to) return null;
  if (to === "OTWARTY") {
    if (facts.otherOpenYear !== null) return "ANOTHER_OPEN";
    if (facts.gaps.length > 0) return "NOT_READY";
  }
  if (to === "PRZYGOTOWANIE" && facts.documentCount > 0) return "HAS_DOCUMENTS";
  return null;
}

/**
 * A date of the source cycle moved into the copy: same day and month, shifted by the difference of
 * the cycle years (25 Jan 2026 in cycle 2026 -> 25 Jan 2027 in cycle 2027; 29 Feb -> 28 Feb).
 */
export function shiftDateForCopy(iso: string | null, sourceYear: number, targetYear: number): string | null {
  if (iso === null) return null;
  const day = parseIsoDate(iso);
  if (!day) return null;
  return toIsoDate(moveToYear(day, day.year + targetYear - sourceYear));
}

export interface OrderedItem {
  id: number;
  sortOrder: number;
}

/**
 * New sort orders (1..n) after moving `itemId` one place up or down, only for the rows whose order
 * changes. Empty when the item is missing or already at that end of the list.
 */
export function reorderedPositions(
  items: readonly OrderedItem[],
  itemId: number,
  direction: "up" | "down",
): OrderedItem[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const index = sorted.findIndex((item) => item.id === itemId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= sorted.length) return [];
  const order = sorted.map((item) => item.id);
  [order[index], order[target]] = [order[target], order[index]];
  const previous = new Map(sorted.map((item) => [item.id, item.sortOrder]));
  return order
    .map((rowId, position) => ({ id: rowId, sortOrder: position + 1 }))
    .filter((row) => previous.get(row.id) !== row.sortOrder);
}
