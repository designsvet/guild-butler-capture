/**
 * A count before a noun, in each of the app's languages.
 *
 * English gets by with "1 line" and "2 lines"; Ukrainian and Russian need four forms (1 рядок,
 * 2 рядки, 5 рядків, and one for fractions), and the forms follow rules no `n === 1` reproduces.
 * `Intl.PluralRules` holds those rules, so a catalog line names its forms and this picks one.
 *
 * A form a language does not write falls back to `other`: French and Portuguese answer `many` for
 * round millions ("1 000 000 de lignes"), and a catalog that wrote only `one` and `other` must not
 * print nothing there.
 *
 * Pure and dependency-free (it is compiled for the main process, the old window and the v5 shell
 * alike), and tested in test/plural.test.ts.
 */

import type { TLang } from "./i18n.js";

/** The locale each language formats and counts in. Portuguese is Brazil's, as the bot's is. */
export const LOCALE_OF: Record<TLang, string> = {
  en: "en",
  uk: "uk",
  ru: "ru",
  de: "de",
  fr: "fr",
  pt: "pt-BR",
};

/** The forms a line can write; `#` in each is replaced by the count, in the language's digits. */
export type TPluralForms = {
  one?: string;
  few?: string;
  many?: string;
  other: string;
};

/** A whole number in the language's own grouping: 1,284 · 1 284 · 1.284. */
export const formatCount = (lang: TLang, n: number): string => {
  return new Intl.NumberFormat(LOCALE_OF[lang], { maximumFractionDigits: 0 }).format(n);
};

export const plural = (lang: TLang, n: number, forms: TPluralForms): string => {
  const category = new Intl.PluralRules(LOCALE_OF[lang]).select(n);
  const form = category === "one" || category === "few" || category === "many" ? forms[category] : undefined;
  return (form ?? forms.other).replaceAll("#", formatCount(lang, n));
};
