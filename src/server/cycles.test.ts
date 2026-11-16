import { describe, expect, it, vi } from "vitest";

// Pure rules only; the session lookup (next-auth) is not needed here.
vi.mock("@/server/current-employee", () => ({ requireEmployee: vi.fn() }));

import { isCycleReadOnly, parseCycleYear, pickCycle, visibleCycleStatuses, type CycleOption } from "./cycles";

// Newest first, as loadCycleOptions returns them.
const OPTIONS: readonly CycleOption[] = [
  { year: 2028, status: "PRZYGOTOWANIE" },
  { year: 2027, status: "OTWARTY" },
  { year: 2026, status: "ZAMKNIETY" },
];

describe("parseCycleYear", () => {
  it.each([
    ["2027", 2027],
    [2026, 2026],
  ])("accepts %j", (raw, year) => {
    expect(parseCycleYear(raw)).toBe(year);
  });

  it.each([undefined, null, "", "27", "20270", "2027 ", " 2027", "2027.0", "1999", "2101", 2026.5, {}, ["2027"]])(
    "rejects %j",
    (raw) => {
      expect(parseCycleYear(raw)).toBeNull();
    },
  );
});

describe("[NFR-05] isCycleReadOnly: only an open cycle accepts changes", () => {
  it.each([
    ["OTWARTY", false],
    ["ZAMKNIETY", true],
    ["PRZYGOTOWANIE", true],
  ] as const)("%s -> read-only %s", (status, readOnly) => {
    expect(isCycleReadOnly(status)).toBe(readOnly);
  });
});

describe("visibleCycleStatuses", () => {
  it("employees and managers see open and closed cycles", () => {
    expect(visibleCycleStatuses(false)).toEqual(["OTWARTY", "ZAMKNIETY"]);
  });

  it("HR also sees a cycle in preparation", () => {
    expect(visibleCycleStatuses(true)).toEqual(["PRZYGOTOWANIE", "OTWARTY", "ZAMKNIETY"]);
  });
});

describe("[NFR-05] pickCycle", () => {
  it("defaults to the open cycle when nothing was chosen", () => {
    expect(pickCycle(OPTIONS, null)).toEqual({ year: 2027, status: "OTWARTY", isReadOnly: false });
  });

  it("returns the chosen year, read-only when it is closed", () => {
    expect(pickCycle(OPTIONS, 2026)).toEqual({ year: 2026, status: "ZAMKNIETY", isReadOnly: true });
  });

  it("a cycle in preparation is read-only", () => {
    expect(pickCycle(OPTIONS, 2028)).toEqual({ year: 2028, status: "PRZYGOTOWANIE", isReadOnly: true });
  });

  it("ignores a chosen year that is not on offer (stale or tampered cookie)", () => {
    expect(pickCycle(OPTIONS, 2019)).toEqual({ year: 2027, status: "OTWARTY", isReadOnly: false });
  });

  it("falls back to the newest cycle when none is open", () => {
    const closedOnly: CycleOption[] = [
      { year: 2026, status: "ZAMKNIETY" },
      { year: 2025, status: "ZAMKNIETY" },
    ];
    expect(pickCycle(closedOnly, null)).toEqual({ year: 2026, status: "ZAMKNIETY", isReadOnly: true });
  });

  it("returns null when there is no cycle at all", () => {
    expect(pickCycle([], 2027)).toBeNull();
  });
});
