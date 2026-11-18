import { describe, expect, it } from "vitest";
import { tabForSegments } from "./tabs";

describe("tabForSegments", () => {
  it("the start page is the GEDP cycle tab, and only the start page", () => {
    expect(tabForSegments([])).toBe("gedpCycle");
    expect(tabForSegments(["goal-centre"])).toBeNull();
    expect(tabForSegments(["goal-centre", "performance"])).toBeNull();
  });

  it("[WF-20] the team view and a report's document belong to 'Mój zespół'", () => {
    expect(tabForSegments(["goal-centre", "team"])).toBe("myTeam");
    expect(tabForSegments(["goal-centre", "team", "42"])).toBe("myTeam");
  });

  it("matches whole segments, not text prefixes", () => {
    expect(tabForSegments(["admin"])).toBe("administrator");
    expect(tabForSegments(["admin", "employees", "7"])).toBe("administrator");
    expect(tabForSegments(["administrator"])).toBeNull();
    expect(tabForSegments(["team"])).toBeNull();
  });
});
