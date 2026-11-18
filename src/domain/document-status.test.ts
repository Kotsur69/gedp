import { describe, expect, it } from "vitest";
import {
  availableActions,
  canValidatorEditGoals,
  DOCUMENT_STATUSES,
  EDITABLE_DOCUMENT_STATUSES,
  findTransition,
  goalEditScope,
  isCommentRequired,
  isDocumentStatus,
  isRevertAllowed,
  revertTargets,
  TRANSITIONS,
  WORKFLOW_ACTIONS,
  workflowCommentSchema,
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

describe("[WF-08] HR status revert targets", () => {
  it("only ever goes back, nearest status first; a draft has nowhere to go", () => {
    expect(revertTargets("SZKIC")).toEqual([]);
    expect(revertTargets("ZWROCONY")).toEqual(["SZKIC"]);
    expect(revertTargets("DO_WALIDACJI")).toEqual(["ZWROCONY", "SZKIC"]);
    expect(revertTargets("ZATWIERDZONY")).toEqual(["DO_WALIDACJI", "ZWROCONY", "SZKIC"]);
  });

  it("refuses every forward or same-status move", () => {
    const order = ["SZKIC", "ZWROCONY", "DO_WALIDACJI", "ZATWIERDZONY"] as const;
    for (const [fromIndex, from] of order.entries()) {
      for (const [toIndex, to] of order.entries()) {
        expect(isRevertAllowed(from, to), `${from} -> ${to}`).toBe(toIndex < fromIndex);
      }
    }
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
