import { describe, expect, it } from "vitest";
import { planWeightWithGoal, type WeightedGoal } from "./performance-goal";

// G2-23: the form shows the plan's total weight live, with the weight being typed included.

const GOALS: WeightedGoal[] = [
  { id: 1, state: "W_PLANIE", weight: 30 },
  { id: 2, state: "W_PLANIE", weight: 20 },
  { id: 3, state: "SZKIC", weight: 40 },
  { id: 4, state: "ANULOWANY", weight: 10 },
];

describe("planWeightWithGoal (live weight total)", () => {
  it("a new goal adds its weight to the goals already in the plan", () => {
    expect(planWeightWithGoal(GOALS, null, 25)).toBe(75);
    expect(planWeightWithGoal(GOALS, null, null)).toBe(50);
  });

  it("an edited goal in the plan is counted once, with the weight being typed", () => {
    expect(planWeightWithGoal(GOALS, 1, 50)).toBe(70);
    expect(planWeightWithGoal(GOALS, 1, null)).toBe(20);
  });

  it("drafts and cancelled goals never count; editing a draft adds only the typed weight", () => {
    expect(planWeightWithGoal(GOALS, 3, 40)).toBe(90);
  });

  it.each([0, 101, -5, 12.5, Number.NaN])("an invalid weight (%s) adds nothing", (weight) => {
    expect(planWeightWithGoal(GOALS, null, weight)).toBe(50);
  });

  it("a missing weight on a goal in the plan counts as 0", () => {
    expect(planWeightWithGoal([{ id: 9, state: "W_PLANIE", weight: null }], null, 10)).toBe(10);
  });
});
