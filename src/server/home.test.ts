import { describe, expect, it, vi } from "vitest";
import { buildHomeTasks, loadOwnDocumentSummary, loadPublishedContent, type HomeDb } from "./home";

const UPDATED = new Date("2027-02-03T10:00:00Z");

describe("buildHomeTasks", () => {
  it("asks to fill in goals while the own document is a draft in an open cycle", () => {
    const tasks = buildHomeTasks({
      cycle: { year: 2027, isReadOnly: false },
      document: { status: "SZKIC", updatedAt: UPDATED },
    });
    expect(tasks).toEqual([{ kind: "FILL_GOALS", href: "/goal-centre", updatedAt: UPDATED }]);
  });

  it("asks to fill in goals before the document exists (it is created on first Goal Centre visit)", () => {
    const tasks = buildHomeTasks({ cycle: { year: 2027, isReadOnly: false }, document: null });
    expect(tasks).toEqual([{ kind: "FILL_GOALS", href: "/goal-centre", updatedAt: null }]);
  });

  it.each(["DO_WALIDACJI", "ZATWIERDZONY"] as const)("has no owner task once the document is %s", (status) => {
    const tasks = buildHomeTasks({
      cycle: { year: 2027, isReadOnly: false },
      document: { status, updatedAt: UPDATED },
    });
    expect(tasks).toEqual([]);
  });

  it("a returned document becomes 'Dokument zwrócony do poprawy'", () => {
    const tasks = buildHomeTasks({
      cycle: { year: 2027, isReadOnly: false },
      document: { status: "ZWROCONY", updatedAt: UPDATED },
    });
    expect(tasks).toEqual([{ kind: "DOCUMENT_RETURNED", href: "/goal-centre", updatedAt: UPDATED }]);
  });

  it("a validator with waiting documents gets one 'Dokumenty do walidacji' task next to their own", () => {
    const tasks = buildHomeTasks({
      cycle: { year: 2027, isReadOnly: false },
      document: { status: "SZKIC", updatedAt: UPDATED },
      toValidate: { count: 3, lastUpdatedAt: UPDATED },
    });
    expect(tasks).toEqual([
      { kind: "FILL_GOALS", href: "/goal-centre", updatedAt: UPDATED },
      { kind: "DOCUMENTS_TO_VALIDATE", href: "/goal-centre/team", updatedAt: UPDATED, count: 3 },
    ]);
  });

  it("no validation task when nothing waits or the year is view-only", () => {
    const approved = { status: "ZATWIERDZONY" as const, updatedAt: UPDATED };
    const open = { year: 2027, isReadOnly: false };
    expect(buildHomeTasks({ cycle: open, document: approved, toValidate: { count: 0, lastUpdatedAt: null } })).toEqual([]);
    expect(
      buildHomeTasks({ cycle: { ...open, isReadOnly: true }, document: approved, toValidate: { count: 2, lastUpdatedAt: UPDATED } }),
    ).toEqual([]);
  });

  it("has no tasks in a view-only year or without a cycle", () => {
    expect(
      buildHomeTasks({ cycle: { year: 2026, isReadOnly: true }, document: { status: "SZKIC", updatedAt: UPDATED } }),
    ).toEqual([]);
    expect(buildHomeTasks({ cycle: null, document: null })).toEqual([]);
  });
});

function fakeDb(overrides: { contentBlock?: unknown; gedpDocument?: unknown }): HomeDb {
  return {
    contentBlock: { findFirst: vi.fn().mockResolvedValue(overrides.contentBlock ?? null) },
    gedpDocument: { findFirst: vi.fn().mockResolvedValue(overrides.gedpDocument ?? null) },
  } as unknown as HomeDb;
}

describe("loadPublishedContent", () => {
  it("returns the text in the requested language", async () => {
    const db = fakeDb({ contentBlock: { contentPl: "Cześć", contentEn: "Hello" } });
    await expect(loadPublishedContent(db, "TEKST_POWITALNY", "en")).resolves.toBe("Hello");
    await expect(loadPublishedContent(db, "TEKST_POWITALNY", "pl")).resolves.toBe("Cześć");
  });

  it("asks for the newest version already published", async () => {
    const db = fakeDb({});
    const now = new Date("2027-01-01T00:00:00Z");
    await loadPublishedContent(db, "TEKST_POWITALNY", "pl", now);
    expect(db.contentBlock.findFirst).toHaveBeenCalledWith({
      where: { key: "TEKST_POWITALNY", publishedAt: { not: null, lte: now } },
      orderBy: { version: "desc" },
      select: { contentPl: true, contentEn: true },
    });
  });

  it("returns null when nothing is published or the text is blank", async () => {
    await expect(loadPublishedContent(fakeDb({}), "TEKST_POWITALNY", "pl")).resolves.toBeNull();
    const blank = fakeDb({ contentBlock: { contentPl: "  \n", contentEn: "x" } });
    await expect(loadPublishedContent(blank, "TEKST_POWITALNY", "pl")).resolves.toBeNull();
  });
});

describe("loadOwnDocumentSummary", () => {
  it("reads only the viewer's document for the year", async () => {
    const row = { status: "SZKIC", updatedAt: UPDATED };
    const db = fakeDb({ gedpDocument: row });
    await expect(loadOwnDocumentSummary(db, 7, 2027)).resolves.toEqual(row);
    expect(db.gedpDocument.findFirst).toHaveBeenCalledWith({
      where: { employeeId: 7, cycle: { year: 2027 } },
      select: { status: true, updatedAt: true },
    });
  });
});
