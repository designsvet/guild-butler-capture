import { describe, expect, it } from "vitest";

import { formatCount, plural } from "../src/shared/plural.js";
import { stringsFor } from "../src/shared/strings.js";

/**
 * A count before a noun (src/shared/plural.ts): the form each language's own rules pick, and the
 * fallback when a catalog line does not write the form asked for.
 */

const FOUR = { one: "# рядок", few: "# рядки", many: "# рядків", other: "# рядка" };

describe("plural", () => {
  it("English: one, and everything else", () => {
    expect(plural("en", 1, { one: "# line", other: "# lines" })).toBe("1 line");
    expect(plural("en", 0, { one: "# line", other: "# lines" })).toBe("0 lines");
    expect(plural("en", 2, { one: "# line", other: "# lines" })).toBe("2 lines");
  });

  it("Ukrainian and Russian: one, few and many, by the last digits", () => {
    const pick = (n: number) => plural("uk", n, FOUR);
    expect([1, 21, 101].map(pick)).toEqual(["1 рядок", "21 рядок", "101 рядок"]);
    expect([2, 3, 4, 22].map(pick)).toEqual(["2 рядки", "3 рядки", "4 рядки", "22 рядки"]);
    expect([5, 11, 12, 14, 25].map(pick)).toEqual(["5 рядків", "11 рядків", "12 рядків", "14 рядків", "25 рядків"]);
    expect(plural("ru", 5, { one: "# строка", few: "# строки", many: "# строк", other: "# строки" })).toBe("5 строк");
  });

  it("falls back to other for a form the line does not write — French and Portuguese millions are `many`", () => {
    expect(new Intl.PluralRules("fr").select(1_000_000)).toBe("many");
    expect(plural("fr", 1_000_000, { one: "# ligne", other: "# lignes" })).toMatch(/lignes$/);
    expect(plural("fr", 0, { one: "# ligne", other: "# lignes" })).toBe("0 ligne");
    // The catalogs' own lines, which write only one and other: a million must still say something.
    expect(new Intl.PluralRules("pt-BR").select(1_000_000)).toBe("many");
    expect(stringsFor("pt").shell.foot.linesSent(1_000_000)).toBe("1.000.000 linhas enviadas");
    expect(stringsFor("fr").shell.foot.linesSent(1_000_000)).toMatch(/^1\s000\s000 lignes envoyées$/);
  });

  it("writes the count in the language's own grouping", () => {
    expect(formatCount("en", 1284)).toBe("1,284");
    expect(formatCount("de", 1284)).toBe("1.284");
    expect(formatCount("pt", 1284)).toBe("1.284");
  });
});

describe("the sidebar foot's line count, in every language", () => {
  it("picks a form for 1, 3, 5 and 21 lines in each catalog", () => {
    const sent = (lang: Parameters<typeof stringsFor>[0]) => [1, 3, 5, 21].map((n) => stringsFor(lang).shell.foot.linesSent(n));
    expect(sent("en")).toEqual(["1 line sent", "3 lines sent", "5 lines sent", "21 lines sent"]);
    expect(sent("uk")).toEqual(["1 рядок надіслано", "3 рядки надіслано", "5 рядків надіслано", "21 рядок надіслано"]);
    expect(sent("ru")).toEqual(["1 строка отправлена", "3 строки отправлены", "5 строк отправлено", "21 строка отправлена"]);
    expect(sent("de")).toEqual(["1 Zeile gesendet", "3 Zeilen gesendet", "5 Zeilen gesendet", "21 Zeilen gesendet"]);
  });
});
