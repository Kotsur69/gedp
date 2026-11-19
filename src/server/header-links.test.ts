import { describe, expect, it, vi } from "vitest";
import { loadHeaderLinks, readHeaderLinks, type HeaderLinksDb } from "./header-links";

describe("[HOME-16] readHeaderLinks (Q-08: URLs not decided yet)", () => {
  it("hides both links while nothing is configured", () => {
    expect(readHeaderLinks({})).toEqual({ hrContacts: null, toolkit: null });
  });

  it("treats blank values as not configured", () => {
    expect(readHeaderLinks({ GEDP_HR_CONTACTS_URL: "", GEDP_TOOLKIT_URL: "   " })).toEqual({
      hrContacts: null,
      toolkit: null,
    });
  });

  it("returns configured https URLs in normalised form", () => {
    expect(
      readHeaderLinks({
        GEDP_HR_CONTACTS_URL: " https://intranet.example.com/hr/contacts ",
        GEDP_TOOLKIT_URL: "https://example.com/gedp-toolkit?lang=pl",
      }),
    ).toEqual({
      hrContacts: "https://intranet.example.com/hr/contacts",
      toolkit: "https://example.com/gedp-toolkit?lang=pl",
    });
  });

  it.each(["http://example.com", "javascript:alert(1)", "data:text/html,x", "/relative", "not a url"])(
    "fails loudly on %j instead of rendering an unsafe or broken link",
    (value) => {
      expect(() => readHeaderLinks({ GEDP_TOOLKIT_URL: value })).toThrow(/GEDP_TOOLKIT_URL/);
    },
  );
});

describe("[HR-06] loadHeaderLinks (addresses published by HR)", () => {
  const NOW = new Date("2027-02-03T10:00:00Z");
  const ENV = { GEDP_HR_CONTACTS_URL: "https://env.example.com/hr", GEDP_TOOLKIT_URL: "https://env.example.com/toolkit" };

  function fakeDb(blocks: Record<string, { contentPl: string; contentEn: string } | null>) {
    const findFirst = vi.fn(({ where }: { where: { key: string } }) =>
      Promise.resolve(blocks[where.key] ? { version: 2, ...blocks[where.key] } : null),
    );
    return { findFirst, db: { contentBlock: { findFirst } } as unknown as HeaderLinksDb };
  }

  it("uses the env values while HR has published nothing", async () => {
    const { db } = fakeDb({});
    await expect(loadHeaderLinks(db, "pl", ENV, NOW)).resolves.toEqual({
      hrContacts: "https://env.example.com/hr",
      toolkit: "https://env.example.com/toolkit",
    });
  });

  it("prefers HR's address in the current language; a blank one hides the link", async () => {
    const { db, findFirst } = fakeDb({
      LINK_KONTAKTY_HR: { contentPl: "https://intranet.example.com/kontakty", contentEn: "https://intranet.example.com/contacts" },
      LINK_GEDP_TOOLKIT: { contentPl: "", contentEn: "http://toolkit.example.com" },
    });
    await expect(loadHeaderLinks(db, "pl", ENV, NOW)).resolves.toEqual({
      hrContacts: "https://intranet.example.com/kontakty",
      toolkit: null,
    });
    await expect(loadHeaderLinks(db, "en", ENV, NOW)).resolves.toEqual({
      hrContacts: "https://intranet.example.com/contacts",
      toolkit: "http://toolkit.example.com/",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { key: "LINK_KONTAKTY_HR", publishedAt: { not: null, lte: NOW } },
      orderBy: { version: "desc" },
      select: { version: true, contentPl: true, contentEn: true },
    });
  });

  it("ignores a broken env value once HR manages both links", async () => {
    const { db } = fakeDb({
      LINK_KONTAKTY_HR: { contentPl: "https://a.example.com", contentEn: "" },
      LINK_GEDP_TOOLKIT: { contentPl: "https://b.example.com", contentEn: "" },
    });
    await expect(loadHeaderLinks(db, "pl", { GEDP_TOOLKIT_URL: "javascript:alert(1)" }, NOW)).resolves.toEqual({
      hrContacts: "https://a.example.com/",
      toolkit: "https://b.example.com/",
    });
  });

  it("reads only the env value of the link HR has not published", async () => {
    const { db } = fakeDb({ LINK_KONTAKTY_HR: { contentPl: "https://a.example.com", contentEn: "" } });
    await expect(
      loadHeaderLinks(db, "pl", { GEDP_HR_CONTACTS_URL: "http://unused.example.com", GEDP_TOOLKIT_URL: ENV.GEDP_TOOLKIT_URL }, NOW),
    ).resolves.toEqual({ hrContacts: "https://a.example.com/", toolkit: "https://env.example.com/toolkit" });
  });

  it.each(["javascript:alert(1)", "data:text/html,x"])("hides a stored %j instead of rendering it", async (value) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      LINK_KONTAKTY_HR: { contentPl: value, contentEn: value },
      LINK_GEDP_TOOLKIT: { contentPl: "", contentEn: "" },
    });
    await expect(loadHeaderLinks(db, "pl", {}, NOW)).resolves.toEqual({ hrContacts: null, toolkit: null });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("LINK_KONTAKTY_HR"));
    errorSpy.mockRestore();
  });
});
