/**
 * Which language the app speaks — following the OS, never a setting.
 *
 * The set mirrors the bot's SUPPORTED_LANGS (EN, UK, FR, RU, PT-BR, DE): a
 * member whose Discord speaks Ukrainian should not meet an English desktop
 * app halfway through the same task. There is deliberately no language picker;
 * `detectLang` reads the locale the OS already declares (navigator.language in
 * the renderer, app.getLocale() in main) and an unrecognised one falls back to
 * English rather than guessing.
 *
 * Pure and dependency-free so both processes and the tests share one rule.
 */

export type TLang = "en" | "uk" | "ru" | "de" | "fr" | "pt";

export const SUPPORTED_LANGS: readonly TLang[] = ["en", "uk", "ru", "de", "fr", "pt"];

/**
 * OS locale → app language. Case-insensitive, region-tolerant ("pt-BR",
 * "de_AT", "fr-CA" all land where a reader expects). `ru` deliberately does
 * NOT swallow other Cyrillic locales — "uk" is its own branch, and mapping
 * unknown ones to Russian would be exactly wrong for this guild.
 */
export const detectLang = (locale: string | null | undefined): TLang => {
  const base = (locale ?? "").trim().toLowerCase().replace("_", "-").split("-")[0];
  switch (base) {
    case "uk": {
      return "uk";
    }
    case "ru": {
      return "ru";
    }
    case "de": {
      return "de";
    }
    case "fr": {
      return "fr";
    }
    case "pt": {
      return "pt";
    }
    default: {
      return "en";
    }
  }
};
