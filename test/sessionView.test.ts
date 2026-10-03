import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { closeSession, newSession, reduceSession, type TSession } from "../src/shared/session/model.js";
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
const render = (session: TSession, lang: TLang, now = 100) =>
  require("react-dom/server").renderToStaticMarkup(
    createElement(loaded.exports.SessionData, { session, lang, now, onReveal: () => {} }),
  ) as string;
describe("Session's rendered values", () => {
  it("uses the dump's avatar identity for supplied mob portraits and keeps unsupported mobs safe", () => {
    let session = reduceSession(newSession("portraits", 100), {
      v: 1,
      t: "kill",
      at: 110,
      char: "Me",
      zone: null,
      mob: 2571,
      hp: null,
    });
    expect(render(session, "en")).toContain('src="./albion/mob-KEEPERDRUID1.png"');
    session = reduceSession(session, { v: 1, t: "kill", at: 120, char: "Me", zone: null, mob: 999999, hp: null });
    const html = render(session, "en");
    expect(html).toContain('src="./albion/u-skull_gold.png"');
    expect(html).not.toContain("mob-undefined");
    expect(html).not.toContain("mob-999999");
  });
  it("renders a localized hourly rate and source share, freezing the rate at Stop", () => {
    const session = reduceSession(newSession("half-hour", 100), {
      v: 1,
      t: "fame",
      at: 1_800_100,
      char: "Me",
      zone: null,
      gain: 1_000_000,
      premium: false,
    });
    for (const lang of SUPPORTED_LANGS) {
      expect(render(session, lang)).not.toContain("data-hourly");
      const live = render(session, lang, 1_800_100);
      const stopped = render(closeSession(session, 1_800_100), lang, 36_000_100);
      for (const html of [live, stopped]) {
        expect(html).toContain('data-hourly="200"');
        expect(html).toContain(sessionStrings(lang).perHour("200"));
        expect(html).toContain('data-source-amount="1000000" data-source-total="1000000"');
      }
    }
  });
  it("offers a real PvE route only when kills or chests make that page available", () => {
    expect(render(newSession("empty", 100), "en")).not.toContain('href="#/pve"');
    const session = reduceSession(newSession("one-chest", 100), {
      v: 1,
      t: "chest",
      at: 110,
      char: "Me",
      zone: null,
      name: null,
      rarity: 3,
    });
    const html = render(session, "en");
    expect(html.match(/href="#\/pve"/g)).toHaveLength(2);
    expect(html).toContain('data-rarity="3" data-chest-count="1"');
  });
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
      expect(html).toContain('src="./albion/u-fame.png"');
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
    const journal = reduceSession(empty, { ...activity, t: "journal", item: "UNKNOWN_123", index: 123, qty: 2 });
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
