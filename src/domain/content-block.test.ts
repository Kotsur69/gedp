import { describe, expect, it } from "vitest";
import {
  linkProblem,
  markdownLinkTargets,
  markdownProblem,
  MAX_MARKDOWN_LENGTH,
  publishContentSchema,
  contentFieldErrors,
  safeHttpUrl,
} from "./content-block";

// HR-06: what HR may publish as content blocks.

const ANNOUNCEMENT = [
  "## Nowości",
  "",
  "- **Cele na 2027** są już dostępne",
  "- Szczegóły: [GEDP Toolkit](https://example.com/toolkit) i <https://example.com/faq>",
  "",
  "Pytania: [napisz](mailto:hr@example.com) lub <hr@example.com>.",
].join("\n");

describe("[HR-06] markdownProblem", () => {
  it("accepts headings, lists, bold and http(s) / mailto links", () => {
    expect(markdownProblem(ANNOUNCEMENT)).toBeNull();
    expect(markdownProblem("")).toBeNull();
  });

  it.each([
    "[klik](javascript:alert(1))",
    "[klik]( JAVASCRIPT:alert(1) )",
    "[klik](<javascript:alert(1)>)",
    "[klik](data:text/html;base64,PHNjcmlwdD4=)",
    "[klik](vbscript:msgbox)",
    "[klik](java&#x73;cript:alert(1))",
    "[klik](/relative/path)",
    "[klik][ref]\n\n[ref]: javascript:alert(1)",
    "<javascript:alert(1)>",
    "<data:text/html,x>",
    "![obraz](data:image/png;base64,AAAA)",
    "[pusty](https://)",
    "[pusty](mailto:)",
    "> [ref]: javascript:alert(1)",
    "- [ref]: data:text/html,x",
    "[ref]:\n  javascript:alert(1)",
  ])("refuses the link target in %j", (markdown) => {
    expect(markdownProblem(markdown)).toBe("UNSAFE_LINK");
  });

  it.each(["<script>alert(1)</script>", '<a href="https://x.pl">x</a>', "tekst <br/> dalej", "<!-- komentarz -->", '<img src=x onerror="alert(1)">', "<div\nukryty tekst"])(
    "refuses raw HTML %j",
    (markdown) => {
      expect(markdownProblem(markdown)).toBe("HTML_NOT_ALLOWED");
    },
  );

  it("refuses hidden control characters and over-long text", () => {
    expect(markdownProblem("tekst‮odwrócony")).toBe("INVALID_TEXT");
    expect(markdownProblem("x".repeat(MAX_MARKDOWN_LENGTH + 1))).toBe("TEXT_TOO_LONG");
  });

  it("does not take a comparison for a tag", () => {
    expect(markdownProblem("a < b oraz c > d")).toBeNull();
  });
});

describe("markdownLinkTargets", () => {
  it("finds inline, reference and autolink targets", () => {
    expect(markdownLinkTargets("[a](https://a.pl) [b][r] <https://c.pl>\n\n[r]: <https://b.pl>")).toEqual([
      "https://a.pl",
      "https://b.pl",
      "https://c.pl",
    ]);
  });
});

describe("[HR-06] header link addresses", () => {
  it("normalises http and https addresses", () => {
    expect(safeHttpUrl(" https://intranet.example.com/hr ")).toBe("https://intranet.example.com/hr");
    expect(safeHttpUrl("http://intranet.example.com")).toBe("http://intranet.example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "ftp://example.com",
    "//example.com",
    "/relative",
    "example.com",
    "https://user:secret@example.com",
    "https://exa mple.com",
    "https://example.com/​x",
  ])("refuses %j", (value) => {
    expect(safeHttpUrl(value)).toBeNull();
    expect(linkProblem(value.trim())).toBe("INVALID_URL");
  });

  it("allows a blank address (the link is hidden)", () => {
    expect(linkProblem("")).toBeNull();
  });
});

describe("[HR-06] publishContentSchema", () => {
  it("normalises line endings and outer whitespace of markdown", () => {
    const parsed = publishContentSchema.parse({
      key: "KOMUNIKAT_STARTOWY",
      baseVersion: 1,
      contentPl: "  ## Tytuł\r\n\r\n- punkt  ",
      contentEn: "",
    });
    expect(parsed).toEqual({ key: "KOMUNIKAT_STARTOWY", baseVersion: 1, contentPl: "## Tytuł\n\n- punkt", contentEn: "" });
  });

  it("stores header link addresses in normalised form", () => {
    const parsed = publishContentSchema.parse({
      key: "LINK_GEDP_TOOLKIT",
      baseVersion: null,
      contentPl: " https://example.com ",
      contentEn: "",
    });
    expect(parsed.contentPl).toBe("https://example.com/");
  });

  it("reports the field with the unsafe value", () => {
    const result = publishContentSchema.safeParse({
      key: "LINK_KONTAKTY_HR",
      baseVersion: null,
      contentPl: "https://example.com",
      contentEn: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(contentFieldErrors(result.error)).toEqual({ contentEn: "INVALID_URL" });
  });

  it("applies markdown rules to markdown keys only", () => {
    const result = publishContentSchema.safeParse({
      key: "TEKST_POWITALNY",
      baseVersion: 2,
      contentPl: "[x](data:text/html,x)",
      contentEn: "<b>x</b>",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(contentFieldErrors(result.error)).toEqual({ contentPl: "UNSAFE_LINK", contentEn: "HTML_NOT_ALLOWED" });
    }
  });

  it.each([
    { key: "OTHER", baseVersion: null, contentPl: "", contentEn: "" },
    { key: "TEKST_POWITALNY", baseVersion: 0, contentPl: "", contentEn: "" },
    { key: "TEKST_POWITALNY", baseVersion: null, contentPl: 1, contentEn: "" },
    { key: "TEKST_POWITALNY", baseVersion: null, contentPl: "", contentEn: "", extra: true },
  ])("refuses a malformed payload %j", (payload) => {
    expect(publishContentSchema.safeParse(payload).success).toBe(false);
  });
});
