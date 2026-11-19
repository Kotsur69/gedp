import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, insertPeople, resetTestDb } from "../../tests/setup/db-client";
import { loadUnseenStartAnnouncement, markStartAnnouncementSeen } from "./content";
import { CONTENT_AUDIT_ENTITY, ContentAdminError, loadContentForAdmin, publishContent, type ContentAdminDb } from "./content-admin";
import { loadHeaderLinks } from "./header-links";
import { loadPublishedContent } from "./home";
import { ForbiddenError, type Viewer } from "./permissions";

// HR-06 / HOME-02: HR publishes content blocks from the panel.

describe("content panel - without a database", () => {
  const untouchable = {
    $transaction: () => {
      throw new Error("the database must not be called for an invalid payload");
    },
  } as unknown as ContentAdminDb;
  const noQueries = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
  } as unknown as ContentAdminDb;
  const hr: Viewer = { id: 1, isHrAdmin: true };

  it("refuses a javascript: header link before any database call", async () => {
    const promise = publishContent(untouchable, hr, {
      key: "LINK_GEDP_TOOLKIT",
      baseVersion: null,
      contentPl: "javascript:alert(1)",
      contentEn: "data:text/html,x",
    });
    await expect(promise).rejects.toBeInstanceOf(ContentAdminError);
    await expect(promise).rejects.toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { contentPl: "INVALID_URL", contentEn: "INVALID_URL" },
    });
  });

  it("refuses an unsafe markdown link before any database call", async () => {
    await expect(
      publishContent(untouchable, hr, {
        key: "KOMUNIKAT_STARTOWY",
        baseVersion: 1,
        contentPl: "[x](javascript:alert(1))",
        contentEn: "ok",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", fieldErrors: { contentPl: "UNSAFE_LINK" } });
  });

  it("refuses a viewer without the HR role", async () => {
    await expect(
      publishContent(noQueries, { id: 2, isHrAdmin: false }, {
        key: "TEKST_POWITALNY",
        baseVersion: null,
        contentPl: "x",
        contentEn: "y",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe.skipIf(!hasTestDb)("content panel - database", () => {
  // skipIf still runs this body to collect tests, so only connect when a test DB exists.
  const db = hasTestDb ? createTestDb() : null!;
  let ids: Map<string, number>;
  const as = (amei: string): Viewer => ({ id: ids.get(amei) ?? -1, isHrAdmin: amei === "HR" });
  const NOW = new Date("2027-02-03T10:00:00.000Z");

  beforeEach(async () => {
    await resetTestDb(db);
    await db.contentBlock.deleteMany({});
    ids = await insertPeople(db, [
      { amei: "HR", managerAmei: null },
      { amei: "A", managerAmei: null },
      { amei: "B", managerAmei: null },
    ]);
    await db.employee.update({ where: { id: ids.get("HR") }, data: { isHrAdmin: true } });
    await db.contentBlock.create({
      data: { key: "KOMUNIKAT_STARTOWY", version: 1, contentPl: "Stary", contentEn: "Old", publishedAt: new Date("2027-01-01") },
    });
  });

  afterAll(async () => {
    await db.contentBlock.deleteMany({});
    await db.$disconnect();
  });

  it("[HOME-01] a published announcement shows once more to everyone, including people who closed the old one", async () => {
    const a = ids.get("A")!;
    const b = ids.get("B")!;
    await markStartAnnouncementSeen(db, a, { version: 1 }, NOW);
    expect(await loadUnseenStartAnnouncement(db, a, "pl", NOW)).toBeNull();

    const result = await publishContent(
      db,
      as("HR"),
      { key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: "## Nowe\n\n- punkt", contentEn: "## New\n\n- item" },
      NOW,
    );
    expect(result).toEqual({ changed: true, version: 2 });

    expect(await loadUnseenStartAnnouncement(db, a, "pl", NOW)).toEqual({ version: 2, markdown: "## Nowe\n\n- punkt" });
    expect(await loadUnseenStartAnnouncement(db, b, "en", NOW)).toEqual({ version: 2, markdown: "## New\n\n- item" });
    await markStartAnnouncementSeen(db, a, { version: 2 }, NOW);
    expect(await loadUnseenStartAnnouncement(db, a, "pl", NOW)).toBeNull();
  });

  it("[HR-06] every publish is audited with before and after", async () => {
    await publishContent(db, as("HR"), { key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: "Nowy", contentEn: "New" }, NOW);
    const rows = await db.auditLog.findMany({ where: { entity: CONTENT_AUDIT_ENTITY } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: ids.get("HR"),
      entityId: "KOMUNIKAT_STARTOWY",
      action: "PUBLISH",
      before: { version: 1, contentPl: "Stary", contentEn: "Old" },
      after: { version: 2, contentPl: "Nowy", contentEn: "New" },
    });
  });

  it("does not bump the version when nothing changed", async () => {
    await expect(
      publishContent(db, as("HR"), { key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: " Stary ", contentEn: "Old" }, NOW),
    ).resolves.toEqual({ changed: false, version: 1 });
    expect(await db.contentBlock.count()).toBe(1);
    expect(await db.auditLog.count({ where: { entity: CONTENT_AUDIT_ENTITY } })).toBe(0);
  });

  it("refuses an editor opened on an older version (another HR user published meanwhile)", async () => {
    await publishContent(db, as("HR"), { key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: "A", contentEn: "A" }, NOW);
    // The refusal carries the other version, so the editor can show it instead of overwriting it.
    await expect(
      publishContent(db, as("HR"), { key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: "B", contentEn: "B" }, NOW),
    ).rejects.toMatchObject({ code: "STALE", latest: { version: 2, contentPl: "A", contentEn: "A" } });
    await expect(
      publishContent(db, as("HR"), { key: "TEKST_POWITALNY", baseVersion: 3, contentPl: "B", contentEn: "B" }, NOW),
    ).rejects.toMatchObject({ code: "STALE", latest: null });
  });

  it("refuses an employee whose HR role was removed after sign-in", async () => {
    await db.employee.update({ where: { id: ids.get("HR") }, data: { isHrAdmin: false } });
    await expect(
      publishContent(db, as("HR"), { key: "TEKST_POWITALNY", baseVersion: null, contentPl: "x", contentEn: "y" }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("[HOME-11] the intro text and the header links are read from the newest version, no redeploy", async () => {
    await publishContent(db, as("HR"), { key: "TEKST_POWITALNY", baseVersion: null, contentPl: "Witaj", contentEn: "Hi" }, NOW);
    expect(await loadPublishedContent(db, "TEKST_POWITALNY", "en", NOW)).toBe("Hi");

    const env = { GEDP_HR_CONTACTS_URL: "https://env.example.com/hr", GEDP_TOOLKIT_URL: "https://env.example.com/toolkit" };
    expect(await loadHeaderLinks(db, "pl", env, NOW)).toEqual({
      hrContacts: "https://env.example.com/hr",
      toolkit: "https://env.example.com/toolkit",
    });
    await publishContent(
      db,
      as("HR"),
      { key: "LINK_GEDP_TOOLKIT", baseVersion: null, contentPl: "https://intranet.example.com/toolkit-pl", contentEn: "" },
      NOW,
    );
    expect(await loadHeaderLinks(db, "pl", env, NOW)).toEqual({
      hrContacts: "https://env.example.com/hr",
      toolkit: "https://intranet.example.com/toolkit-pl",
    });
    // A blank published address hides the link; it does not fall back to the env value.
    expect((await loadHeaderLinks(db, "en", env, NOW)).toolkit).toBeNull();
  });

  it("lists the newest version of every block for HR, blank for blocks never published", async () => {
    await publishContent(db, as("HR"), { key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: "Nowy", contentEn: "New" }, NOW);
    const blocks = await loadContentForAdmin(db, as("HR"));
    expect(blocks.map((block) => [block.key, block.version, block.contentPl])).toEqual([
      ["KOMUNIKAT_STARTOWY", 2, "Nowy"],
      ["TEKST_POWITALNY", null, ""],
      ["LINK_KONTAKTY_HR", null, ""],
      ["LINK_GEDP_TOOLKIT", null, ""],
    ]);
    await expect(loadContentForAdmin(db, as("A"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
