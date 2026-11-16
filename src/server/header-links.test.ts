import { describe, expect, it } from "vitest";
import { readHeaderLinks } from "./header-links";

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
