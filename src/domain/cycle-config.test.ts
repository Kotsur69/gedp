import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  canChangeYear,
  catalogItemSchema,
  createCycleSchema,
  cycleConfigFieldErrors,
  cycleReadinessGaps,
  cycleSettingsSchema,
  groupGoalTextSchema,
  isCycleConfigEditable,
  MAX_NAME_LENGTH,
  reorderedPositions,
  shiftDateForCopy,
  statusChangeBlocker,
  targetTypeSchema,
  type CycleReadinessFacts,
} from "./cycle-config";

// HR-05: the rules of the cycle panel, shared by the forms and the server.

const SETTINGS = {
  cycleId: 1,
  year: 2027,
  goalSettingOpensAt: "2027-01-25",
  goalSettingClosesAt: "2027-03-31",
  minPerformanceGoals: 1,
  requiredWeightSum: 100,
  minDevelopmentGoals: 1,
};

function fieldErrors(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? {} : cycleConfigFieldErrors(result.error);
}

describe("[HR-05] cycle settings form", () => {
  it("accepts a complete form; empty dates mean no date", () => {
    expect(cycleSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS);
    expect(cycleSettingsSchema.parse({ ...SETTINGS, goalSettingOpensAt: "", goalSettingClosesAt: null })).toMatchObject({
      goalSettingOpensAt: null,
      goalSettingClosesAt: null,
    });
  });

  it("goal setting cannot close before it opens", () => {
    expect(fieldErrors(cycleSettingsSchema, { ...SETTINGS, goalSettingClosesAt: "2027-01-24" })).toEqual({
      goalSettingClosesAt: "DATES_ORDER",
    });
  });

  it.each([
    [{ goalSettingOpensAt: "2027-02-30" }, { goalSettingOpensAt: "INVALID_DATE" }],
    [{ year: 1999 }, { year: "OUT_OF_RANGE" }],
    [{ year: 2027.5 }, { year: "OUT_OF_RANGE" }],
    [{ minPerformanceGoals: -1 }, { minPerformanceGoals: "OUT_OF_RANGE" }],
    [{ requiredWeightSum: 101 }, { requiredWeightSum: "OUT_OF_RANGE" }],
    [{ minDevelopmentGoals: 51 }, { minDevelopmentGoals: "OUT_OF_RANGE" }],
  ])("refuses %j", (change, errors) => {
    expect(fieldErrors(cycleSettingsSchema, { ...SETTINGS, ...change })).toEqual(errors);
  });

  it("an unknown key is a hand-crafted request", () => {
    expect(cycleSettingsSchema.safeParse({ ...SETTINGS, status: "OTWARTY" }).success).toBe(false);
  });
});

describe("[HR-05] create, group goal, catalogue and target type forms", () => {
  it("a new cycle is empty or a copy of an existing cycle", () => {
    expect(createCycleSchema.parse({ year: 2028, sourceCycleId: 3 })).toEqual({ year: 2028, sourceCycleId: 3 });
    expect(createCycleSchema.parse({ year: 2028, sourceCycleId: null })).toEqual({ year: 2028, sourceCycleId: null });
    expect(createCycleSchema.safeParse({ year: 2028 }).success).toBe(false);
  });

  it("group goal texts keep line breaks, normalise CRLF and need both languages", () => {
    const parsed = groupGoalTextSchema.parse({
      cycleId: 1,
      type: "BHP",
      contentPl: "  Linia 1\r\n- przykład\t2  ",
      contentEn: "Line 1",
    });
    expect(parsed.contentPl).toBe("Linia 1\n- przykład\t2");
    expect(fieldErrors(groupGoalTextSchema, { cycleId: 1, type: "BHP", contentPl: " ", contentEn: "x" })).toEqual({
      contentPl: "REQUIRED",
    });
    expect(fieldErrors(groupGoalTextSchema, { cycleId: 1, type: "BHP", contentPl: "a‮b", contentEn: "x" })).toEqual({
      contentPl: "INVALID_TEXT",
    });
  });

  it("catalogue names are single-line, trimmed and limited", () => {
    const base = { cycleId: 1, kind: "competency", id: null, isActive: true };
    expect(catalogItemSchema.parse({ ...base, namePl: " Innowacyjność ", nameEn: "Innovation" })).toMatchObject({
      namePl: "Innowacyjność",
    });
    expect(fieldErrors(catalogItemSchema, { ...base, namePl: "a\nb", nameEn: "x".repeat(MAX_NAME_LENGTH + 1) })).toEqual({
      namePl: "INVALID_TEXT",
      nameEn: "TEXT_TOO_LONG",
    });
  });

  it("target type codes are upper-cased and must look like a code", () => {
    const base = { cycleId: 1, id: null, namePl: "Kilowatogodziny", nameEn: "Kilowatt hours", isNumeric: true, isActive: true };
    expect(targetTypeSchema.parse({ ...base, code: " kwh " }).code).toBe("KWH");
    expect(fieldErrors(targetTypeSchema, { ...base, code: "1KWH" })).toEqual({ code: "CODE_FORMAT" });
    expect(fieldErrors(targetTypeSchema, { ...base, code: "K" })).toEqual({ code: "CODE_FORMAT" });
  });
});

describe("[HR-05] status changes", () => {
  const ready = { otherOpenYear: null, documentCount: 0, gaps: [] };

  it("only one cycle may be open", () => {
    expect(statusChangeBlocker("PRZYGOTOWANIE", "OTWARTY", { ...ready, otherOpenYear: 2026 })).toBe("ANOTHER_OPEN");
    expect(statusChangeBlocker("ZAMKNIETY", "OTWARTY", { ...ready, otherOpenYear: 2027 })).toBe("ANOTHER_OPEN");
    expect(statusChangeBlocker("PRZYGOTOWANIE", "OTWARTY", ready)).toBeNull();
  });

  it("an incomplete cycle cannot open", () => {
    expect(statusChangeBlocker("PRZYGOTOWANIE", "OTWARTY", { ...ready, gaps: ["GROUP_GOAL_BHP"] })).toBe("NOT_READY");
  });

  it("back to preparation only before the first document; closing is always possible", () => {
    expect(statusChangeBlocker("OTWARTY", "PRZYGOTOWANIE", { ...ready, documentCount: 3 })).toBe("HAS_DOCUMENTS");
    expect(statusChangeBlocker("OTWARTY", "PRZYGOTOWANIE", ready)).toBeNull();
    expect(statusChangeBlocker("OTWARTY", "ZAMKNIETY", { ...ready, documentCount: 3 })).toBeNull();
    expect(statusChangeBlocker("OTWARTY", "OTWARTY", { ...ready, otherOpenYear: 2026 })).toBeNull();
  });

  it("a closed cycle is read-only; the year moves only in preparation without documents", () => {
    expect(isCycleConfigEditable("ZAMKNIETY")).toBe(false);
    expect(isCycleConfigEditable("OTWARTY")).toBe(true);
    expect(canChangeYear("PRZYGOTOWANIE", 0)).toBe(true);
    expect(canChangeYear("PRZYGOTOWANIE", 1)).toBe(false);
    expect(canChangeYear("OTWARTY", 0)).toBe(false);
  });
});

describe("[HR-05] readiness to open", () => {
  const complete: CycleReadinessFacts = {
    groupGoalTypes: ["PRZYWODZTWO", "WARTOSCI", "BHP"],
    targetTypeCodes: ["TEKST", "LICZBA"],
    activeCompetencies: 2,
    activeDevelopmentAreas: 1,
  };

  it("a complete configuration has no gaps", () => {
    expect(cycleReadinessGaps(complete)).toEqual([]);
  });

  it("lists every missing piece", () => {
    expect(
      cycleReadinessGaps({
        groupGoalTypes: ["WARTOSCI"],
        targetTypeCodes: ["LICZBA"],
        activeCompetencies: 0,
        activeDevelopmentAreas: 0,
      }),
    ).toEqual([
      "GROUP_GOAL_PRZYWODZTWO",
      "GROUP_GOAL_BHP",
      "DEFAULT_TARGET_TYPE",
      "ACTIVE_COMPETENCY",
      "ACTIVE_DEVELOPMENT_AREA",
    ]);
  });
});

describe("[HR-05] copy and order helpers", () => {
  it("shifts goal-setting dates into the new cycle year", () => {
    expect(shiftDateForCopy("2026-01-25", 2026, 2027)).toBe("2027-01-25");
    expect(shiftDateForCopy("2026-12-15", 2027, 2028)).toBe("2027-12-15");
    expect(shiftDateForCopy("2028-02-29", 2028, 2029)).toBe("2029-02-28");
    expect(shiftDateForCopy(null, 2026, 2027)).toBeNull();
  });

  it("moves an item one place and renumbers only what changed", () => {
    const items = [
      { id: 10, sortOrder: 1 },
      { id: 11, sortOrder: 2 },
      { id: 12, sortOrder: 3 },
    ];
    expect(reorderedPositions(items, 12, "up")).toEqual([
      { id: 12, sortOrder: 2 },
      { id: 11, sortOrder: 3 },
    ]);
    expect(reorderedPositions(items, 10, "up")).toEqual([]);
    expect(reorderedPositions(items, 12, "down")).toEqual([]);
    expect(reorderedPositions(items, 99, "up")).toEqual([]);
  });

  it("repairs duplicate sort orders left by older data", () => {
    const items = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 0 },
      { id: 3, sortOrder: 0 },
    ];
    expect(reorderedPositions(items, 3, "up")).toEqual([
      { id: 1, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
      { id: 2, sortOrder: 3 },
    ]);
  });
});
