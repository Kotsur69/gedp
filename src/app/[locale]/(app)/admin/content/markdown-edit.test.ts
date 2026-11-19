import { describe, expect, it } from "vitest";
import { prefixLines, wrapSelection } from "./markdown-edit";

describe("[HR-06] markdown toolbar edits", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(wrapSelection("ala ma kota", 4, 6, "**", "**", "x")).toEqual({
      value: "ala **ma** kota",
      selectionStart: 6,
      selectionEnd: 8,
    });
  });

  it("inserts a selected placeholder when nothing is selected", () => {
    expect(wrapSelection("abc", 3, 3, "[", "](https://)", "tekst")).toEqual({
      value: "abc[tekst](https://)",
      selectionStart: 4,
      selectionEnd: 9,
    });
  });

  it("prefixes every touched line once", () => {
    const value = "jeden\n- dwa\ntrzy\ncztery";
    const edit = prefixLines(value, 2, 13, "- ", "punkt");
    expect(edit.value).toBe("- jeden\n- dwa\n- trzy\ncztery");
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe("- jeden\n- dwa\n- trzy");
  });

  it("starts at the first line when the cursor is at the very start", () => {
    expect(prefixLines("\nfoo", 0, 0, "- ", "punkt").value).toBe("- punkt\nfoo");
  });

  it("fills a blank line with a selected placeholder", () => {
    const edit = prefixLines("tekst\n", 6, 6, "## ", "Nagłówek");
    expect(edit.value).toBe("tekst\n## Nagłówek");
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe("Nagłówek");
  });
});
