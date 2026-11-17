import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  clampDay,
  daysInMonth,
  endOfWeek,
  isoWeekday,
  monthWeeks,
  moveToYear,
  parseIsoDate,
  sameDay,
  startOfWeek,
  toIsoDate,
  weekdayOrder,
} from "./calendar-date";

const MONDAY = 1;
const SUNDAY = 7;
const day = (iso: string) => {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(`bad test date ${iso}`);
  return parsed;
};

describe("ISO calendar dates", () => {
  it("parses real dates and refuses malformed or impossible ones", () => {
    expect(parseIsoDate("2027-02-28")).toEqual({ year: 2027, month: 2, day: 28 });
    for (const bad of ["2027-02-29", "2027-13-01", "30.11.2027", "", "2027-1-1"]) {
      expect(parseIsoDate(bad)).toBeNull();
    }
  });

  it("round-trips through toIsoDate with zero padding", () => {
    expect(toIsoDate({ year: 2027, month: 3, day: 7 })).toBe("2027-03-07");
  });

  it("knows month lengths, leap years included", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2027, 12)).toBe(31);
  });
});

describe("date arithmetic for keyboard navigation", () => {
  it("adds days across month and year ends", () => {
    expect(toIsoDate(addDays(day("2027-12-31"), 1))).toBe("2028-01-01");
    expect(toIsoDate(addDays(day("2027-03-01"), -1))).toBe("2027-02-28");
  });

  it("adds months keeping the day where possible (PageUp / PageDown)", () => {
    expect(toIsoDate(addMonths(day("2027-01-31"), 1))).toBe("2027-02-28");
    expect(toIsoDate(addMonths(day("2027-01-15"), -1))).toBe("2026-12-15");
    expect(toIsoDate(addMonths(day("2027-06-15"), 12))).toBe("2028-06-15");
  });

  it("moves a date to another year; 29 Feb becomes 28 Feb (copy from last year)", () => {
    expect(toIsoDate(moveToYear(day("2028-02-29"), 2029))).toBe("2029-02-28");
    expect(toIsoDate(moveToYear(day("2026-12-31"), 2027))).toBe("2027-12-31");
  });

  it("finds the week's first and last day with Monday first (Home / End)", () => {
    // 2027-01-06 is a Wednesday.
    expect(isoWeekday(day("2027-01-06"))).toBe(3);
    expect(toIsoDate(startOfWeek(day("2027-01-06"), MONDAY))).toBe("2027-01-04");
    expect(toIsoDate(endOfWeek(day("2027-01-06"), MONDAY))).toBe("2027-01-10");
    expect(toIsoDate(startOfWeek(day("2027-01-10"), MONDAY))).toBe("2027-01-04");
    expect(toIsoDate(startOfWeek(day("2027-01-06"), SUNDAY))).toBe("2027-01-03");
  });

  it("clamps a day into a range", () => {
    const first = day("2027-01-01");
    const last = day("2027-12-31");
    expect(clampDay(day("2026-12-30"), first, last)).toEqual(first);
    expect(clampDay(day("2028-01-02"), first, last)).toEqual(last);
    expect(clampDay(day("2027-05-05"), first, last)).toEqual(day("2027-05-05"));
    expect(sameDay(first, day("2027-01-01"))).toBe(true);
    expect(sameDay(first, null)).toBe(false);
  });
});

describe("month grid (G2-13: the week starts on Monday)", () => {
  it("orders weekday headers from the first day of the week", () => {
    expect(weekdayOrder(MONDAY)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdayOrder(SUNDAY)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });

  it("pads the first and last week with empty cells", () => {
    // September 2026 starts on a Tuesday.
    const weeks = monthWeeks(2026, 9, MONDAY);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBeNull();
    expect(weeks[0][1]).toEqual({ year: 2026, month: 9, day: 1 });
    expect(weeks[4].filter(Boolean).map((cell) => cell?.day)).toEqual([28, 29, 30]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("a month starting on Monday needs no leading padding", () => {
    // February 2027 starts on a Monday and has exactly four weeks.
    const weeks = monthWeeks(2027, 2, MONDAY);
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toEqual({ year: 2027, month: 2, day: 1 });
  });
});
