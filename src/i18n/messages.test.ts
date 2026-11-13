import { describe, expect, it } from "vitest";
import { createTranslator, type IntlError } from "next-intl";
import en from "../../messages/en.json";
import pl from "../../messages/pl.json";
import { LOCALES } from "./config";

type Tree = { [key: string]: string | Tree };
const CATALOGS: Readonly<Record<(typeof LOCALES)[number], Tree>> = { pl, en };

/** Flattens nested messages into "a.b.c" -> text. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** Top-level ICU argument names, e.g. "{min, plural, one {# x}}" -> ["min"]. */
function argumentsOf(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort();
}

/** Rich-text tag names, e.g. "<b>x</b> <link>y</link>" -> ["b", "link"]. */
function tagsOf(message: string): string[] {
  return [...new Set([...message.matchAll(/<\/?([a-zA-Z][\w-]*)>/g)].map((m) => m[1]))].sort();
}

const flat = { pl: flatten(pl), en: flatten(en) };

describe("glossary / messages (NFR-01, NFR-02)", () => {
  it("[NFR-02] every key exists in both languages", () => {
    const plKeys = [...flat.pl.keys()].sort();
    const enKeys = [...flat.en.keys()].sort();
    expect(plKeys.filter((k) => !flat.en.has(k)), "missing in en.json").toEqual([]);
    expect(enKeys.filter((k) => !flat.pl.has(k)), "missing in pl.json").toEqual([]);
  });

  it("[NFR-02] no message is empty", () => {
    for (const locale of LOCALES) {
      const empty = [...flat[locale]].filter(([, text]) => text.trim() === "").map(([key]) => key);
      expect(empty, `empty in ${locale}.json`).toEqual([]);
    }
  });

  it("both languages use the same placeholders and rich-text tags for every key", () => {
    const same = (key: string, extract: (text: string) => string[]) =>
      extract(flat.pl.get(key) ?? "").join() === extract(flat.en.get(key) ?? "").join();
    expect([...flat.pl.keys()].filter((key) => !same(key, argumentsOf)), "placeholders").toEqual([]);
    expect([...flat.pl.keys()].filter((key) => !same(key, tagsOf)), "tags").toEqual([]);
  });

  it("the parity helpers really detect a mismatch", () => {
    expect(argumentsOf("Witaj {name}, {count, plural, one {# cel} other {# cele}}")).toEqual(["count", "name"]);
    expect(tagsOf("<b>Uwaga</b> <link>więcej</link>")).toEqual(["b", "link"]);
    expect(tagsOf("plain")).toEqual([]);
  });

  it("every message is valid ICU and formats with sample values", () => {
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const t = createTranslator({
        locale,
        messages: CATALOGS[locale],
        onError: (error: IntlError) => errors.push(error.message),
      });
      for (const [key, text] of flat[locale]) {
        const values = Object.fromEntries(argumentsOf(text).map((name) => [name, 2]));
        // Keys are checked dynamically here; the typed API is exercised by the pages.
        (t as unknown as (key: string, values: Record<string, number>) => string)(key, values);
      }
      expect(errors, `ICU errors in ${locale}.json`).toEqual([]);
    }
  });

  it("[NFR-02] Polish uses the agreed terms, not eGEDP machine translations", () => {
    expect(flat.pl.get("glossary.goalCentre")).toBe("Centrum celów");
    expect(flat.pl.get("glossary.goals")).toBe("Cele");
    expect(flat.pl.get("glossary.documentStatus.SZKIC")).toBe("Szkic");
    expect(flat.pl.get("glossary.goalProgress.ONGOING")).toBe("W trakcie");
    expect(flat.pl.get("glossary.teamLevel")).toBe("Poziom zespołu");

    const banned = [/bramk/i, /pobór/i, /serial trwa/i, /drużyn/i, /uczciwości i uczciwości/i];
    const offenders = [...flat.pl].filter(([, text]) => banned.some((re) => re.test(text))).map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("[NFR-02] every document status, goal state, cycle status and target type is translated", () => {
    const required = [
      "glossary.documentStatus.SZKIC",
      "glossary.documentStatus.DO_WALIDACJI",
      "glossary.documentStatus.ZWROCONY",
      "glossary.documentStatus.ZATWIERDZONY",
      "glossary.goalState.SZKIC",
      "glossary.goalState.W_PLANIE",
      "glossary.goalState.ANULOWANY",
      "glossary.cycleStatus.PRZYGOTOWANIE",
      "glossary.cycleStatus.OTWARTY",
      "glossary.cycleStatus.ZAMKNIETY",
      "glossary.groupGoalTypes.PRZYWODZTWO",
      "glossary.groupGoalTypes.WARTOSCI",
      "glossary.groupGoalTypes.BHP",
      ...["LICZBA", "TEKST", "PROCENT", "TONY", "EURO", "USD"].map((code) => `glossary.targetTypes.${code}`),
    ];
    for (const locale of LOCALES) {
      expect(required.filter((key) => !flat[locale].has(key)), locale).toEqual([]);
    }
  });

  it("Polish plurals read naturally", () => {
    const t = createTranslator({ locale: "pl", messages: pl });
    expect(t("workflow.conditions.minPerformanceGoals", { min: 1 })).toBe("co najmniej 1 celu wydajnościowego w planie");
    expect(t("workflow.conditions.minPerformanceGoals", { min: 2 })).toBe("co najmniej 2 celów wydajnościowych w planie");
    expect(t("reports.overdueFor", { days: 1 })).toBe("Dłużej niż 1 dzień");
    expect(t("reports.overdueFor", { days: 5 })).toBe("Dłużej niż 5 dni");
    expect(t("reports.overdueFor", { days: 22 })).toBe("Dłużej niż 22 dni");
  });
});
