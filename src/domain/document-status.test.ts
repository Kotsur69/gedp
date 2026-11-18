import { describe, expect, it } from "vitest";
import {
  availableActions,
  canValidatorEditGoals,
  CLOSING_CONDITION_COUNT,
  closingProgress,
  DOCUMENT_STATUSES,
  EDITABLE_DOCUMENT_STATUSES,
  findTransition,
  goalEditScope,
  isCommentRequired,
  isDocumentStatus,
  missingClosingConditions,
  TRANSITIONS,
  WORKFLOW_ACTIONS,
  workflowCommentSchema,
  type ClosingInput,
} from "./document-status";

describe("transition table (WF-01, WF-03)", () => {
  // The only legal moves; every other (action, from) pair must be refused.
  const LEGAL = new Map([
    ["SEND:SZKIC", "DO_WALIDACJI"],
    ["SEND:ZWROCONY", "DO_WALIDACJI"],
    ["APPROVE:DO_WALIDACJI", "ZATWIERDZONY"],
    ["RETURN:DO_WALIDACJI", "ZWROCONY"],
  ]);

  it("has exactly the four one-step N+1 transitions", () => {
    expect(TRANSITIONS).toHaveLength(LEGAL.size);
  });

  for (const action of WORKFLOW_ACTIONS) {
    for (const from of DOCUMENT_STATUSES) {
      const expected = LEGAL.get(`${action}:${from}`) ?? null;
      it(`${action} from ${from} -> ${expected ?? "refused"}`, () => {
        expect(findTransition(action, from)?.to ?? null).toBe(expected);
      });
    }
  }

  it("the owner sends, the validator approves and returns", () => {
    expect(TRANSITIONS.filter((t) => t.actor === "OWNER").map((t) => t.action)).toEqual(["SEND", "SEND"]);
    expect(TRANSITIONS.filter((t) => t.actor === "VALIDATOR").map((t) => t.action)).toEqual(["APPROVE", "RETURN"]);
  });

  it("only a return needs a comment; only a send needs the closing conditions", () => {
    expect(WORKFLOW_ACTIONS.filter(isCommentRequired)).toEqual(["RETURN"]);
    expect(TRANSITIONS.filter((t) => t.requiresClosingConditions).every((t) => t.action === "SEND")).toBe(true);
  });

  it("offers each role only its own buttons", () => {
    const owner = { isOwner: true, isValidator: false };
    const validator = { isOwner: false, isValidator: true };
    expect(availableActions("SZKIC", owner)).toEqual(["SEND"]);
    expect(availableActions("ZWROCONY", owner)).toEqual(["SEND"]);
    expect(availableActions("DO_WALIDACJI", owner)).toEqual([]);
    expect(availableActions("DO_WALIDACJI", validator)).toEqual(["APPROVE", "RETURN"]);
    expect(availableActions("SZKIC", validator)).toEqual([]);
    expect(availableActions("ZATWIERDZONY", { isOwner: true, isValidator: true })).toEqual([]);
  });

  it("narrows database text to a status", () => {
    expect(isDocumentStatus("ZATWIERDZONY")).toBe(true);
    expect(isDocumentStatus("APPROVED")).toBe(false);
  });
});

describe("edit locks (WF-02, WF-05, Q-13)", () => {
  it("full editing in SZKIC and ZWROCONY, none while in validation, progress only once approved", () => {
    expect(DOCUMENT_STATUSES.map((status) => goalEditScope(status, true))).toEqual([
      "FULL",
      "NONE",
      "FULL",
      "PROGRESS_ONLY",
    ]);
  });

  it("a cycle that is not open is view only whatever the status", () => {
    expect(DOCUMENT_STATUSES.map((status) => goalEditScope(status, false))).toEqual(["NONE", "NONE", "NONE", "NONE"]);
  });

  it("[WF-04] the validator edits goals only while the document is in validation and the cycle is open", () => {
    expect(DOCUMENT_STATUSES.filter((status) => canValidatorEditGoals(status, true))).toEqual(["DO_WALIDACJI"]);
    expect(DOCUMENT_STATUSES.filter((status) => canValidatorEditGoals(status, false))).toEqual([]);
  });

  it("derives the editable statuses from the same table", () => {
    expect(EDITABLE_DOCUMENT_STATUSES).toEqual(["SZKIC", "ZWROCONY"]);
  });
});

describe("workflow comment", () => {
  const parse = (value: unknown) => workflowCommentSchema.safeParse(value);

  it("trims; blank, null and missing become null", () => {
    expect(parse("  Please fix weights  ").data).toBe("Please fix weights");
    expect(parse("   ").data).toBeNull();
    expect(parse(null).data).toBeNull();
    expect(parse(undefined).data).toBeNull();
  });

  it("refuses text over the limit and NUL", () => {
    expect(parse("x".repeat(2001)).error?.issues[0]?.message).toBe("COMMENT_TOO_LONG");
    expect(parse("x".repeat(2000)).success).toBe(true);
    expect(parse("a\u0000b").error?.issues[0]?.message).toBe("INVALID_INPUT");
    expect(parse(42).success).toBe(false);
  });
});

describe("closing conditions (WF-C1..C5)", () => {
  const complete: ClosingInput = {
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
    rules: { minPerformanceGoals: 1, requiredWeightSum: 100, minDevelopmentGoals: 1 },
  };

  it("a complete document has nothing missing", () => {
    expect(missingClosingConditions(complete)).toEqual([]);
  });

  it("an empty document misses everything, in slide order, without a redundant weight message", () => {
    expect(
      missingClosingConditions({
        ...complete,
        groupGoals: complete.groupGoals.map((goal) => ({ ...goal, isAcknowledged: false, commitment: null })),
        performanceGoals: [],
        developmentGoals: [],
      }),
    ).toEqual([
      { code: "leadershipAcknowledged" },
      { code: "valuesAcknowledged" },
      { code: "safetyCommitment" },
      { code: "minPerformanceGoals", min: 1, current: 0 },
      { code: "minDevelopmentGoals", min: 1, current: 0 },
    ]);
  });

  it("reports the current weight sum ('sum of weights 100% - currently 80%')", () => {
    const input = { ...complete, performanceGoals: [{ state: "W_PLANIE" as const, weight: 80 }] };
    expect(missingClosingConditions(input)).toEqual([{ code: "weightSum", required: 100, current: 80 }]);
  });

  it("counts only goals in the plan: drafts and cancelled goals neither count nor add weight", () => {
    const input: ClosingInput = {
      ...complete,
      performanceGoals: [
        { state: "W_PLANIE", weight: 100 },
        { state: "SZKIC", weight: 20 },
        { state: "ANULOWANY", weight: 50 },
      ],
      developmentGoals: [{ state: "SZKIC" }, { state: "ANULOWANY" }],
    };
    expect(missingClosingConditions(input)).toEqual([{ code: "minDevelopmentGoals", min: 1, current: 0 }]);
  });

  it("an acknowledged BHP goal with a blank commitment is still missing", () => {
    const groupGoals = complete.groupGoals.map((goal) => (goal.type === "BHP" ? { ...goal, commitment: "  " } : goal));
    expect(missingClosingConditions({ ...complete, groupGoals })).toEqual([{ code: "safetyCommitment" }]);
  });

  it("a Group goal type HR never configured counts as missing, not as done", () => {
    const groupGoals = complete.groupGoals.filter((goal) => goal.type !== "WARTOSCI");
    expect(missingClosingConditions({ ...complete, groupGoals })).toEqual([{ code: "valuesAcknowledged" }]);
  });

  it("follows the cycle's own rules (Q-03)", () => {
    const rules = { minPerformanceGoals: 3, requiredWeightSum: 100, minDevelopmentGoals: 2 };
    expect(missingClosingConditions({ ...complete, rules })).toEqual([
      { code: "minPerformanceGoals", min: 3, current: 2 },
      { code: "minDevelopmentGoals", min: 2, current: 1 },
    ]);
  });

  describe("completion for the team view (WF-21)", () => {
    it("a complete document meets every condition", () => {
      expect(closingProgress(complete)).toEqual({ met: CLOSING_CONDITION_COUNT, total: CLOSING_CONDITION_COUNT });
    });

    it("an empty document meets none: the folded weight message still counts as unmet", () => {
      const empty: ClosingInput = {
        ...complete,
        groupGoals: complete.groupGoals.map((goal) => ({ ...goal, isAcknowledged: false, commitment: null })),
        performanceGoals: [],
        developmentGoals: [],
      };
      expect(closingProgress(empty)).toEqual({ met: 0, total: CLOSING_CONDITION_COUNT });
    });

    it("a wrong weight sum costs exactly one condition", () => {
      const input = { ...complete, performanceGoals: [{ state: "W_PLANIE" as const, weight: 80 }] };
      expect(closingProgress(input)).toEqual({ met: CLOSING_CONDITION_COUNT - 1, total: CLOSING_CONDITION_COUNT });
    });

    it("no goal in the plan meets a required weight sum of 0", () => {
      const input: ClosingInput = {
        ...complete,
        performanceGoals: [],
        rules: { minPerformanceGoals: 0, requiredWeightSum: 0, minDevelopmentGoals: 1 },
      };
      expect(closingProgress(input)).toEqual({ met: CLOSING_CONDITION_COUNT, total: CLOSING_CONDITION_COUNT });
    });
  });
});
