import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, LOCALES, localizedPath, resolveLocale } from "./config";
import { FIRST_DAY_OF_WEEK, formatDate } from "./format";

describe("locale config (NFR-01)", () => {
  it("defaults to Polish and supports exactly pl + en", () => {
    expect(DEFAULT_LOCALE).toBe("pl");
    expect([...LOCALES]).toEqual(["pl", "en"]);
  });

  it.each([
    [undefined, "pl"],
    ["", "pl"],
    ["en", "en"],
    ["pl", "pl"],
    ["EN", "pl"],
    ["de", "pl"],
    ["constructor", "pl"],
    ["en/../admin", "pl"],
  ])("cookie %j resolves to %s", (cookie, expected) => {
    expect(resolveLocale(cookie)).toBe(expected);
  });

  it.each([
    ["/", undefined, "/pl"],
    ["/", "en", "/en"],
    ["/login", undefined, "/pl/login"],
    ["/login", "en", "/en/login"],
    ["/goal-centre/performance", "en", "/en/goal-centre/performance"],
    ["/login", "../admin", "/pl/login"],
    ["/pl", "en", "/en/pl"],
  ])("page %s with cookie %j is rewritten to %s", (pathname, cookie, expected) => {
    expect(localizedPath(pathname, cookie)).toBe(expected);
  });

  it.each(["/api", "/api/locale", "/robots.txt", "/sitemap.xml", "/reports/export.csv"])(
    "%s is not a page and passes through unchanged",
    (pathname) => {
      expect(localizedPath(pathname, "en")).toBeNull();
    },
  );

  it("isLocale rejects non-strings", () => {
    expect(isLocale(1)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(["en"])).toBe(false);
  });
});

describe("date format (NFR-06)", () => {
  const newYearsEve = new Date("2026-12-31T12:00:00Z");

  it("uses one format per language", () => {
    expect(formatDate(newYearsEve, "pl")).toBe("31.12.2026");
    expect(formatDate(newYearsEve, "en")).toBe("31 Dec 2026");
  });

  it("pads Polish days and months", () => {
    expect(formatDate(new Date("2027-03-05T12:00:00Z"), "pl")).toBe("05.03.2027");
  });

  it("shows the company-time (Europe/Warsaw) day, not UTC", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Warsaw.
    expect(formatDate(new Date("2026-12-31T23:30:00Z"), "pl")).toBe("01.01.2027");
  });

  it("rejects an invalid date instead of printing 'Invalid Date'", () => {
    expect(() => formatDate(new Date("nope"), "pl")).toThrow(RangeError);
  });

  it("[G2-13] calendar weeks start on Monday", () => {
    expect(FIRST_DAY_OF_WEEK).toBe(1);
  });
});
