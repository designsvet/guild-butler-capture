import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { newSession, reduceSession, type TSession } from "../src/shared/session/model.js";
import { SUPPORTED_LANGS, type TLang } from "../src/shared/i18n.js";
import { sessionStrings } from "../src/shared/sessionStrings.js";
import { resourceName } from "../src/shared/session/names.js";

// Assert the rendered sink, including locale formatting and unknown-data warnings.
const require = createRequire(import.meta.url);
const { outputFiles } = buildSync({
  entryPoints: [resolve("src/app/SessionData.tsx")],
  bundle: true,
  jsx: "automatic",
  write: false,
  platform: "node",
  format: "cjs",
  external: ["react", "react/*"],
});
const loaded = {
  exports: {} as {
    SessionData: (props: { session: TSession; lang: TLang; now: number; onReveal: () => void }) => ReactNode;
  },
};
new Function("require", "module", "exports", outputFiles[0]!.text)(require, loaded, loaded.exports);
const render = (session: TSession, lang: TLang) =>
  require("react-dom/server").renderToStaticMarkup(
    createElement(loaded.exports.SessionData, { session, lang, now: 100, onReveal: () => {} }),
  ) as string;
describe("Session's rendered values", () => {
  it("keeps raw totals and full precision in every locale without drawing missing metrics", () => {
    const session = reduceSession(newSession("one", 100), {
      v: 1,
      t: "fame",
      at: 100,
      char: "Me",
      zone: null,
      gain: 13307603664,
      premium: false,
    });
    for (const lang of SUPPORTED_LANGS) {
      const html = render(session, lang);
      expect(html).toContain('data-session-metric="fame"');
      expect(html).toContain('data-raw="13307603664"');
      expect(html).toContain(sessionStrings(lang).unknownSource);
      expect(html).not.toContain('data-session-metric="silver"');
      expect(html).not.toContain('data-session-metric="loot"');
    }
  });
  it("warns for UNKNOWN_ items from each stream and for malformed session data", () => {
    const empty = newSession("one", 100);
    const activity = { v: 1, at: 100, char: "Me", zone: null } as const;
    const harvest = reduceSession(empty, {
      ...activity,
      t: "harvest",
      item: "UNKNOWN_123",
      index: 123,
      std: 1,
      bonus: 0,
      premium: 0,
    });
    const fishing = reduceSession(empty, {
      ...activity,
      t: "fish",
      outcome: "landed",
      catch: [{ item: "UNKNOWN_123", index: 123, qty: 1 }],
    });
    const journal = reduceSession(empty, {
      ...activity,
      t: "journal",
      item: "UNKNOWN_123",
      index: 123,
      qty: 2,
    });
    const loot = reduceSession(empty, {
      t: "loot",
      at: 100,
      looter: "Me",
      item: "UNKNOWN_123",
      name: "Unknown item",
      qty: 1,
      from: "Chest",
      server: "Europe",
    });
    for (const lang of SUPPORTED_LANGS) {
      for (const state of [harvest, fishing, journal, loot]) {
        expect(render(state, lang)).toContain(sessionStrings(lang).tableWarning);
      }
      expect(render({ ...empty, refused: 1 }, lang)).toContain(sessionStrings(lang).auditWarning);
    }
  });
  it("renders observed completions in each locale's activity feed, with no guessed fame or progress", () => {
    const session = reduceSession(newSession("books", 100), {
      v: 1,
      t: "journal",
      at: 110,
      char: "Me",
      zone: null,
      item: "T8_JOURNAL_WARRIOR_FULL",
      index: 12055,
      qty: 4,
    });
    for (const lang of SUPPORTED_LANGS) {
      const html = render(session, lang);
      const words = sessionStrings(lang).feedJournal(resourceName("T8_JOURNAL_WARRIOR_FULL", lang)!, 4);
      expect(html).toContain(words.replaceAll("&", "&amp;").replaceAll("'", "&#x27;"));
      expect(html).not.toContain('data-session-metric="fame"');
    }
  });
});
