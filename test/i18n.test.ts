import { describe, expect, it } from "vitest";

import { detectLang, SUPPORTED_LANGS } from "../src/shared/i18n.js";
import { stringsFor } from "../src/shared/strings.js";

/**
 * The catalogs are already complete BY TYPE — a missing key in any language is
 * a tsc failure. What the compiler cannot see is content: an accidentally
 * empty string, or a parameterised line whose translation dropped the value.
 * That is what this walks for, in every language.
 */

type TNode = Record<string, unknown>;

const walk = (node: TNode, path: string, visit: (path: string, value: unknown) => void): void => {
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      walk(value as TNode, here, visit);
    } else {
      visit(here, value);
    }
  }
};

// Enough arguments for any signature in the catalog; string params get a
// marker we can assert survived into the output.
const ARG = "«X»";

describe("i18n catalogs", () => {
  for (const lang of SUPPORTED_LANGS) {
    it(`${lang}: every string is non-empty and every function keeps its parameter`, () => {
      walk(stringsFor(lang) as unknown as TNode, lang, (path, value) => {
        if (typeof value === "string") {
          expect(value.trim().length, path).toBeGreaterThan(0);
          return;
        }
        if (Array.isArray(value)) {
          expect(value.length, path).toBeGreaterThan(0);
          for (const item of value) {
            expect(String(item).trim().length, path).toBeGreaterThan(0);
          }
          return;
        }
        if (typeof value === "function") {
          const fn = value as (...args: unknown[]) => string;
          // Numeric-first signatures (seconds, counts) and string-first ones
          // (character, device, detail) both get exercised.
          const withString = fn(ARG, 42);
          const withNumber = fn(7, 42);
          expect(String(withString).trim().length, path).toBeGreaterThan(0);
          expect(String(withNumber).trim().length, path).toBeGreaterThan(0);
          // A translation that dropped its placeholder would render the same
          // sentence for every character/device/detail — catch it here. Only
          // asserted when the marker went in as the first arg and the function
          // actually uses a string there.
          if (withString.includes(ARG) || withNumber.includes("7")) {
            return;
          }
          throw new Error(`${path}: neither a string nor a numeric argument survives into the output`);
        }
        throw new Error(`${path}: unexpected leaf type ${typeof value}`);
      });
    });
  }

  it("catalogs agree on the key set with EN", () => {
    const shapeOf = (node: TNode): string[] => {
      const keys: string[] = [];
      walk(node, "", (path, value) => {
        keys.push(`${path}:${typeof value}`);
      });
      return keys.sort();
    };
    const en = shapeOf(stringsFor("en") as unknown as TNode);
    for (const lang of SUPPORTED_LANGS) {
      expect(shapeOf(stringsFor(lang) as unknown as TNode), lang).toEqual(en);
    }
  });
});

describe("detectLang", () => {
  it("maps OS locales, region- and case-tolerant", () => {
    expect(detectLang("en-US")).toBe("en");
    expect(detectLang("uk")).toBe("uk");
    expect(detectLang("uk-UA")).toBe("uk");
    expect(detectLang("ru-RU")).toBe("ru");
    expect(detectLang("de_AT")).toBe("de");
    expect(detectLang("fr-CA")).toBe("fr");
    expect(detectLang("pt-BR")).toBe("pt");
    expect(detectLang("PT-PT")).toBe("pt");
  });

  it("falls back to English rather than guessing", () => {
    expect(detectLang("pl-PL")).toBe("en");
    expect(detectLang("be")).toBe("en"); // Cyrillic but NOT Russian's problem to claim
    expect(detectLang("")).toBe("en");
    expect(detectLang(null)).toBe("en");
    expect(detectLang(undefined)).toBe("en");
  });
});
