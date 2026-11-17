import { describe, expect, it, vi } from "vitest";
import {
  AnnouncementError,
  loadUnseenStartAnnouncement,
  markStartAnnouncementSeen,
  START_ANNOUNCEMENT_KEY,
  type ContentDb,
} from "./content";

const NOW = new Date("2027-02-03T10:00:00Z");
const EMPLOYEE_ID = 42;

interface FakeDbSetup {
  block?: unknown;
  seen?: unknown;
}

function fakeDb({ block = null, seen = null }: FakeDbSetup) {
  const db = {
    contentBlock: { findFirst: vi.fn().mockResolvedValue(block) },
    announcementSeen: {
      findUnique: vi.fn().mockResolvedValue(seen),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { db, typed: db as unknown as ContentDb };
}

const BLOCK = { version: 3, contentPl: "## Nowości\n\n- **jeden**", contentEn: "## News\n\n- **one**" };

describe("loadUnseenStartAnnouncement", () => {
  it("returns the newest published version in the current language when not seen yet", async () => {
    const { db, typed } = fakeDb({ block: BLOCK });

    await expect(loadUnseenStartAnnouncement(typed, EMPLOYEE_ID, "pl", NOW)).resolves.toEqual({
      version: 3,
      markdown: BLOCK.contentPl,
    });
    await expect(loadUnseenStartAnnouncement(typed, EMPLOYEE_ID, "en", NOW)).resolves.toEqual({
      version: 3,
      markdown: BLOCK.contentEn,
    });
    expect(db.contentBlock.findFirst).toHaveBeenCalledWith({
      where: { key: START_ANNOUNCEMENT_KEY, publishedAt: { not: null, lte: NOW } },
      orderBy: { version: "desc" },
      select: { version: true, contentPl: true, contentEn: true },
    });
    expect(db.announcementSeen.findUnique).toHaveBeenCalledWith({
      where: { employeeId_contentVersion: { employeeId: EMPLOYEE_ID, contentVersion: 3 } },
      select: { seenAt: true },
    });
  });

  it("returns null once this version was seen", async () => {
    const { typed } = fakeDb({ block: BLOCK, seen: { seenAt: NOW } });
    await expect(loadUnseenStartAnnouncement(typed, EMPLOYEE_ID, "pl", NOW)).resolves.toBeNull();
  });

  it("returns null when nothing is published", async () => {
    const { db, typed } = fakeDb({});
    await expect(loadUnseenStartAnnouncement(typed, EMPLOYEE_ID, "pl", NOW)).resolves.toBeNull();
    expect(db.announcementSeen.findUnique).not.toHaveBeenCalled();
  });

  it("shows nothing for blank content (HOME-03), without checking seen state", async () => {
    const { db, typed } = fakeDb({ block: { ...BLOCK, contentPl: "  \n\t", contentEn: "" } });
    await expect(loadUnseenStartAnnouncement(typed, EMPLOYEE_ID, "pl", NOW)).resolves.toBeNull();
    await expect(loadUnseenStartAnnouncement(typed, EMPLOYEE_ID, "en", NOW)).resolves.toBeNull();
    expect(db.announcementSeen.findUnique).not.toHaveBeenCalled();
  });
});

describe("markStartAnnouncementSeen", () => {
  it("records a published version idempotently", async () => {
    const { db, typed } = fakeDb({ block: { id: 7 } });

    await markStartAnnouncementSeen(typed, EMPLOYEE_ID, { version: 3 }, NOW);

    expect(db.contentBlock.findFirst).toHaveBeenCalledWith({
      where: { key: START_ANNOUNCEMENT_KEY, version: 3, publishedAt: { not: null, lte: NOW } },
      select: { id: true },
    });
    expect(db.announcementSeen.createMany).toHaveBeenCalledWith({
      data: [{ employeeId: EMPLOYEE_ID, contentVersion: 3 }],
      skipDuplicates: true,
    });
  });

  it.each([null, undefined, {}, { version: 0 }, { version: -1 }, { version: 1.5 }, { version: "3" }, { version: 3, employeeId: 1 }])(
    "rejects %j as invalid input",
    async (input) => {
      const { db, typed } = fakeDb({ block: { id: 7 } });
      await expect(markStartAnnouncementSeen(typed, EMPLOYEE_ID, input, NOW)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      expect(db.announcementSeen.createMany).not.toHaveBeenCalled();
    },
  );

  it("rejects a version that is not published", async () => {
    const { db, typed } = fakeDb({});
    const result = markStartAnnouncementSeen(typed, EMPLOYEE_ID, { version: 99 }, NOW);
    await expect(result).rejects.toBeInstanceOf(AnnouncementError);
    await expect(result).rejects.toMatchObject({ code: "NOT_PUBLISHED" });
    expect(db.announcementSeen.createMany).not.toHaveBeenCalled();
  });
});
