import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntroMarkdown, safeIntroUrl } from "./intro-markdown";

// HOME-11: the intro text is HR-edited markdown, so the rendered HTML must never carry script,
// raw HTML or unsafe URLs, whatever react-markdown version is installed.

function render(markdown: string): string {
  return renderToStaticMarkup(<IntroMarkdown markdown={markdown} newTabLabel="(new tab)" />);
}

const HOSTILE_INPUTS = [
  "[x](javascript:alert(1))",
  "[x]( JaVaScRiPt:alert(1))",
  "[x](java&#115;cript:alert(1))",
  "[x](data:text/html;base64,PHNjcmlwdD4=)",
  "[x](vbscript:msgbox(1))",
  "<javascript:alert(1)>",
  "[x][r]\n\n[r]: javascript:alert(1)",
  "<script>alert(1)</script>",
  'Hi <img src=x onerror="alert(1)"> there',
  "![pic](https://example.com/a.png)",
  '<a href="https://example.com" onclick="alert(1)">x</a>',
];

describe("IntroMarkdown", () => {
  // A rejected URL may still show up as visible text (e.g. an autolink becomes a <span>); what
  // matters is that no attribute carries it and no executable element or handler is emitted.
  it.each(HOSTILE_INPUTS)("neutralises %j", (markdown) => {
    const html = render(markdown).toLowerCase();
    expect(html).not.toMatch(/\s(href|src)="(?!https?:\/\/|mailto:)/);
    expect(html).not.toMatch(/\son\w+=/);
    for (const tag of ["<script", "<img", "<iframe"]) {
      expect(html).not.toContain(tag);
    }
  });

  it("keeps safe links, opening them in a new tab without opener access", () => {
    const html = render("See [GEDP Toolkit](https://example.com/toolkit).");
    expect(html).toContain('href="https://example.com/toolkit"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(new tab)");
  });

  it("renders lists and emphasis but unwraps headings to text", () => {
    const html = render("# Title\n\n- **one**\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>one</strong>");
    expect(html).not.toContain("<h1");
    expect(html).toContain("Title");
  });
});

describe("safeIntroUrl", () => {
  it.each(["https://a.example/x", "http://a.example", "mailto:hr@example.com", "  https://a.example  "])(
    "allows %j",
    (url) => {
      expect(safeIntroUrl(url)).toBe(url.trim());
    },
  );

  it.each(["javascript:alert(1)", "//evil.example", "/relative", "ftp://a.example", "data:text/html,x", ""])(
    "rejects %j",
    (url) => {
      expect(safeIntroUrl(url)).toBe("");
    },
  );
});
