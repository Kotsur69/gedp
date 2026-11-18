import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import pl from "../../messages/pl.json";
import {
  checkClosingConditions,
  CLOSING_CONDITION_COUNT,
  closingProgress,
  type ClosingCycleConfig,
  type ClosingDocument,
  type MissingCondition,
} from "./closing-conditions";

// Database defaults of the cycle row while Q-03 is open (prisma/schema.prisma). The function itself
// never assumes them: every threshold below is read from `cycle`.
const DEFAULT_CYCLE: ClosingCycleConfig = { minPerformanceGoals: 1, requiredWeightSum: 100, minDevelopmentGoals: 1 };

const complete: ClosingDocument = {
  groupGoals: [
    { type: "PRZYWODZTWO", isAcknowledged: true, commitment: null },
    { type: "WARTOSCI", isAcknowledged: true, commitment: null },
    { type: "BHP", isAcknowledged: true, commitment: "Wear PPE on the line" },
  ],
  performanceGoals: [
    { state: "W_PLANIE", weight: 60 },
    { state: "W_PLANIE", weight: 40 },
  ],
  developmentGoals: [{ state: "W_PLANIE" }],
  cycle: DEFAULT_CYCLE,
};

const empty: ClosingDocument = {
  ...complete,
  groupGoals: complete.groupGoals.map((goal) => ({ ...goal, isAcknowledged: false, commitment: null })),
  performanceGoals: [],
  developmentGoals: [],
};

const missingOf = (document: ClosingDocument): MissingCondition[] => checkClosingConditions(document).missing;

describe("checkClosingConditions (WF-C1..C5)", () => {
  it("a complete document is ok with nothing missing", () => {
    expect(checkClosingConditions(complete)).toEqual({ ok: true, missing: [] });
  });

  it("an empty document misses everything, in slide order, with the current weight sum", () => {
    expect(checkClosingConditions(empty)).toEqual({
      ok: false,
      missing: [
        { condition: "WF-C1", key: "workflow.conditions.leadershipAcknowledged", params: {} },
        { condition: "WF-C2", key: "workflow.conditions.valuesAcknowledged", params: {} },
        { condition: "WF-C3", key: "workflow.conditions.safetyCommitment", params: {} },
        { condition: "WF-C4", key: "workflow.conditions.minPerformanceGoals", params: { min: 1, current: 0 } },
        { condition: "WF-C4", key: "workflow.conditions.weightSum", params: { required: 100, current: 0 } },
        { condition: "WF-C5", key: "workflow.conditions.minDevelopmentGoals", params: { min: 1, current: 0 } },
      ],
    });
  });

  it("can report at most CLOSING_CONDITION_COUNT items, so the team-view completion never goes negative", () => {
    expect(missingOf(empty)).toHaveLength(CLOSING_CONDITION_COUNT);
  });

  it("does not mutate its input", () => {
    const snapshot = structuredClone(empty);
    checkClosingConditions(empty);
    expect(empty).toEqual(snapshot);
  });

  describe("WF-C1 / WF-C2: Leadership and Group Values acknowledged", () => {
    it("an unacknowledged Leadership goal is missing", () => {
      const groupGoals = complete.groupGoals.map((goal) =>
        goal.type === "PRZYWODZTWO" ? { ...goal, isAcknowledged: false } : goal,
      );
      expect(missingOf({ ...complete, groupGoals })).toEqual([
        { condition: "WF-C1", key: "workflow.conditions.leadershipAcknowledged", params: {} },
      ]);
    });

    it("unacknowledged Group Values are missing", () => {
      const groupGoals = complete.groupGoals.map((goal) => (goal.type === "WARTOSCI" ? { ...goal, isAcknowledged: false } : goal));
      expect(missingOf({ ...complete, groupGoals })).toEqual([
        { condition: "WF-C2", key: "workflow.conditions.valuesAcknowledged", params: {} },
      ]);
    });

    it("a Group goal type HR never configured counts as missing, not as done", () => {
      const groupGoals = complete.groupGoals.filter((goal) => goal.type !== "WARTOSCI");
      expect(missingOf({ ...complete, groupGoals }).map((item) => item.condition)).toEqual(["WF-C2"]);
    });

    it("with two templates of one type, both must be acknowledged", () => {
      const groupGoals = [...complete.groupGoals, { type: "PRZYWODZTWO" as const, isAcknowledged: false, commitment: null }];
      expect(missingOf({ ...complete, groupGoals }).map((item) => item.condition)).toEqual(["WF-C1"]);
    });
  });

  describe("WF-C3: BHP commitment non-empty", () => {
    it.each([
      ["null", null],
      ["empty", ""],
      ["whitespace only", " \t\n "],
    ])("an acknowledged BHP goal with a %s commitment is missing", (_label, commitment) => {
      const groupGoals = complete.groupGoals.map((goal) => (goal.type === "BHP" ? { ...goal, commitment } : goal));
      expect(missingOf({ ...complete, groupGoals })).toEqual([
        { condition: "WF-C3", key: "workflow.conditions.safetyCommitment", params: {} },
      ]);
    });

    it("a commitment without the acknowledgement is still missing", () => {
      const groupGoals = complete.groupGoals.map((goal) => (goal.type === "BHP" ? { ...goal, isAcknowledged: false } : goal));
      expect(missingOf({ ...complete, groupGoals }).map((item) => item.condition)).toEqual(["WF-C3"]);
    });

    it("a missing BHP template counts as missing", () => {
      const groupGoals = complete.groupGoals.filter((goal) => goal.type !== "BHP");
      expect(missingOf({ ...complete, groupGoals }).map((item) => item.condition)).toEqual(["WF-C3"]);
    });
  });

  describe("WF-C4: performance goals in the plan and their weight sum", () => {
    it("reports the current weight sum ('sum of weights 100% - currently 80%')", () => {
      const performanceGoals = [{ state: "W_PLANIE" as const, weight: 80 }];
      expect(missingOf({ ...complete, performanceGoals })).toEqual([
        { condition: "WF-C4", key: "workflow.conditions.weightSum", params: { required: 100, current: 80 } },
      ]);
    });

    it("a sum over the required one is missing too", () => {
      const performanceGoals = [
        { state: "W_PLANIE" as const, weight: 70 },
        { state: "W_PLANIE" as const, weight: 50 },
      ];
      expect(missingOf({ ...complete, performanceGoals })).toEqual([
        { condition: "WF-C4", key: "workflow.conditions.weightSum", params: { required: 100, current: 120 } },
      ]);
    });

    it("a goal without a weight adds 0", () => {
      const performanceGoals = [
        { state: "W_PLANIE" as const, weight: 100 },
        { state: "W_PLANIE" as const, weight: null },
      ];
      expect(checkClosingConditions({ ...complete, performanceGoals }).ok).toBe(true);
    });

    it("counts only goals in the plan: drafts and cancelled goals neither count nor add weight", () => {
      const document: ClosingDocument = {
        ...complete,
        performanceGoals: [
          { state: "W_PLANIE", weight: 100 },
          { state: "SZKIC", weight: 20 },
          { state: "ANULOWANY", weight: 50 },
        ],
      };
      expect(checkClosingConditions(document)).toEqual({ ok: true, missing: [] });
    });

    it("only drafts: no goal in the plan and a weight sum of 0", () => {
      const performanceGoals = [{ state: "SZKIC" as const, weight: 100 }];
      expect(missingOf({ ...complete, performanceGoals })).toEqual([
        { condition: "WF-C4", key: "workflow.conditions.minPerformanceGoals", params: { min: 1, current: 0 } },
        { condition: "WF-C4", key: "workflow.conditions.weightSum", params: { required: 100, current: 0 } },
      ]);
    });

    it("the right sum with too few goals reports only the count", () => {
      const cycle = { ...DEFAULT_CYCLE, minPerformanceGoals: 3 };
      expect(missingOf({ ...complete, cycle })).toEqual([
        { condition: "WF-C4", key: "workflow.conditions.minPerformanceGoals", params: { min: 3, current: 2 } },
      ]);
    });
  });

  describe("WF-C5: development goals in the plan", () => {
    it("drafts and cancelled development goals do not count", () => {
      const developmentGoals = [{ state: "SZKIC" as const }, { state: "ANULOWANY" as const }];
      expect(missingOf({ ...complete, developmentGoals })).toEqual([
        { condition: "WF-C5", key: "workflow.conditions.minDevelopmentGoals", params: { min: 1, current: 0 } },
      ]);
    });
  });

  describe("thresholds come from the cycle config (Q-03)", () => {
    it("follows the cycle's minimum goal counts", () => {
      const cycle = { minPerformanceGoals: 3, requiredWeightSum: 100, minDevelopmentGoals: 2 };
      expect(missingOf({ ...complete, cycle })).toEqual([
        { condition: "WF-C4", key: "workflow.conditions.minPerformanceGoals", params: { min: 3, current: 2 } },
        { condition: "WF-C5", key: "workflow.conditions.minDevelopmentGoals", params: { min: 2, current: 1 } },
      ]);
    });

    it("follows the cycle's required weight sum", () => {
      const cycle = { ...DEFAULT_CYCLE, requiredWeightSum: 90 };
      expect(missingOf({ ...complete, cycle })).toEqual([
        { condition: "WF-C4", key: "workflow.conditions.weightSum", params: { required: 90, current: 100 } },
      ]);
      const performanceGoals = [{ state: "W_PLANIE" as const, weight: 90 }];
      expect(checkClosingConditions({ ...complete, cycle, performanceGoals }).ok).toBe(true);
    });

    it("minimums of 0 and a required sum of 0 let empty Parts 2 and 3 through", () => {
      const cycle = { minPerformanceGoals: 0, requiredWeightSum: 0, minDevelopmentGoals: 0 };
      expect(checkClosingConditions({ ...complete, cycle, performanceGoals: [], developmentGoals: [] })).toEqual({
        ok: true,
        missing: [],
      });
    });

    it.each([
      ["minPerformanceGoals", -1],
      ["requiredWeightSum", 99.5],
      ["minDevelopmentGoals", Number.NaN],
    ] as const)("refuses a broken cycle config (%s = %s) instead of letting documents through", (field, value) => {
      const cycle = { ...DEFAULT_CYCLE, [field]: value };
      expect(() => checkClosingConditions({ ...complete, cycle })).toThrow(RangeError);
    });
  });

  describe("missing items render as i18n messages", () => {
    const translators = {
      pl: createTranslator({ locale: "pl", messages: pl }),
      en: createTranslator({ locale: "en", messages: en }),
    };

    it.each(["pl", "en"] as const)("every key exists in %s.json and takes its params", (locale) => {
      const t = translators[locale];
      for (const item of missingOf(empty)) {
        const text = t(item.key as never, item.params as never);
        expect(text, item.key).not.toBe(item.key);
        expect(text, item.key).not.toMatch(/[{}]/);
      }
    });

    it("renders the slide example with the current weight sum", () => {
      const groupGoals = complete.groupGoals.map((goal) => (goal.type === "WARTOSCI" ? { ...goal, isAcknowledged: false } : goal));
      const performanceGoals = [{ state: "W_PLANIE" as const, weight: 80 }];
      const t = translators.pl;
      const items = missingOf({ ...complete, groupGoals, performanceGoals })
        .map((item) => t(item.key as never, item.params as never))
        .join(", ");
      expect(t("workflow.missing", { items })).toBe("Brakuje: potwierdzenia Wartości firmy, sumy wag 100% – obecnie 80%");
    });
  });
});

describe("closingProgress (WF-21 completion in the team view)", () => {
  it("a complete document meets every condition", () => {
    expect(closingProgress(complete)).toEqual({ met: CLOSING_CONDITION_COUNT, total: CLOSING_CONDITION_COUNT });
  });

  it("an empty document meets none", () => {
    expect(closingProgress(empty)).toEqual({ met: 0, total: CLOSING_CONDITION_COUNT });
  });

  it("a wrong weight sum costs exactly one condition", () => {
    const performanceGoals = [{ state: "W_PLANIE" as const, weight: 80 }];
    expect(closingProgress({ ...complete, performanceGoals })).toEqual({
      met: CLOSING_CONDITION_COUNT - 1,
      total: CLOSING_CONDITION_COUNT,
    });
  });

  it("no goal in the plan meets a required weight sum of 0", () => {
    const cycle = { minPerformanceGoals: 0, requiredWeightSum: 0, minDevelopmentGoals: 1 };
    expect(closingProgress({ ...complete, performanceGoals: [], cycle })).toEqual({
      met: CLOSING_CONDITION_COUNT,
      total: CLOSING_CONDITION_COUNT,
    });
  });
});
