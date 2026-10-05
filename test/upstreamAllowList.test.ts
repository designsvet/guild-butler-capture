import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TRADE_PARTNER_KEYS,
  TRADE_RECORD_KEYS,
  TRADE_SELF_KEYS,
  TRADE_STACK_KEYS,
} from "../src/main/tradeLines.js";
import { REAL_TRADE_LINES } from "./fixtures/realTradeLines.js";

/**
 * What leaves this computer for the guild's bot — the guard raid-bot ADR 0110 §5 promised ("a test
 * on the app's upstream event whitelist fails if a presence event is ever forwarded") and nobody
 * wrote until the trade upload (ADR 0168) made it urgent.
 *
 * Three allow-lists, each failing on something NEW rather than checking something known:
 *
 *  1. the bot's routes this app calls — a new route is a new stream, and a new stream is reviewed
 *     against ADR 0110's admission test (server truth with no personal dimension; loot attribution
 *     and, since ADR 0168, the member's own trades the standing exceptions) in its PR, with this list
 *     edited in the same diff;
 *  2. the engine lines main forwards to the bot as they arrive — a new forwarder is how a presence
 *     line (the engine decodes every nearby character's name and guild for loot attribution) would
 *     leave;
 *  3. the fields a trade line may carry — record v1 exactly, top level and nested: a crafter, an
 *     object id, durability or any key the engine adds later is not sent (src/main/tradeLines.ts
 *     refuses the line; test/tradeUpload.test.ts holds the refusals).
 *
 * Editing a list here is the review step, not a formality: say in the PR what the new entry sends.
 */

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** Every source file the app is built from (main, preload, renderer, the v5 shell, shared). */
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return /\.(ts|tsx|js|cjs|mjs|html)$/.test(name) ? [path] : [];
  });

/** The bot's routes this app may call. Each line: the route, and what it carries. */
const ALLOWED_ROUTES = [
  // trade a one-time pairing code for this device's token
  "/control/capture/pair",
  // the loot log's lines (ADR 0092 P2)
  "/control/capture/upload",
  // the trade journal's lines — item trades the member took part in, naming the other trader
  // (ADR 0168; silver-only trades never)
  "/control/capture/trades",
  // the daily bonus rotation (ADR 0102) — server truth
  "/control/capture/festivities",
  // the guild's siphoned-energy total (ADR 0022)
  "/control/capture/energy",
  // a page of the guild's energy log (ADR 0022)
  "/control/capture/energy-log",
  // which decoder handlers a game update broke (ADR 0092 amendment, 2026-09-28)
  "/control/capture/engine-health",
].sort();

describe("the bot's routes this app calls", () => {
  const found = new Map<string, Set<string>>();
  for (const file of sources(SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(/\/control\/[A-Za-z0-9/_-]+/g)) {
      const route = match[0];
      found.set(route, (found.get(route) ?? new Set()).add(relative(ROOT, file)));
    }
  }

  it("are exactly the allow-list — a new route fails here until it is reviewed and listed", () => {
    expect([...found.keys()].sort()).toEqual(ALLOWED_ROUTES);
  });

  it("are all spoken to from one file, so the list above is the whole story", () => {
    for (const [route, files] of found) {
      expect([...files], route).toEqual(["src/main/uploadClient.ts"]);
    }
  });
});

describe("the engine lines main forwards to the bot as they arrive", () => {
  const MAIN = readFileSync(join(SRC, "main", "index.ts"), "utf8");

  it("are the festivities, energy and energy-log lines — nothing about another player", () => {
    const kinds = [...MAIN.matchAll(/toBot && ev\.type === "engine-line" && ev\.event\.kind === "([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    expect(kinds.sort()).toEqual(["energy", "energy-log", "festivities"]);
  });

  it("go through the four forwarders and no fifth", () => {
    const forwarders = [...MAIN.matchAll(/const (forward[A-Z]\w*) = /g)].map((m) => m[1]);
    expect(forwarders.sort()).toEqual(["forwardEnergy", "forwardEnergyLog", "forwardEngineHealth", "forwardFestivities"]);
  });

  it("and the files main uploads are the loot log and the trade journal — two uploaders, no third", () => {
    expect(MAIN.split("createUploader(").length - 1).toBe(2);
    expect(MAIN.split("stream: TRADE_STREAM").length - 1).toBe(1);
  });
});

describe("the fields a trade line may carry", () => {
  it("are record v1's, exactly", () => {
    expect(TRADE_RECORD_KEYS).toEqual([
      "v",
      "t",
      "at",
      "server",
      "zone",
      "tradeId",
      "initiator",
      "self",
      "partner",
      "revision",
      "acceptedRevision",
      "complete",
      "gave",
      "got",
      "silverGave",
      "silverGot",
    ]);
    expect(TRADE_SELF_KEYS).toEqual(["name", "guild", "alliance"]);
    expect(TRADE_PARTNER_KEYS).toEqual(["name", "guild", "hidden"]);
    expect(TRADE_STACK_KEYS).toEqual(["index", "item", "qty", "quality"]);
  });

  it("are what the real engine writes, in its order — the allow-list and the engine agree", () => {
    for (const line of REAL_TRADE_LINES) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(record)).toEqual([...TRADE_RECORD_KEYS]);
      expect(Object.keys(record.self as object)).toEqual([...TRADE_SELF_KEYS]);
      expect(Object.keys(record.partner as object)).toEqual([...TRADE_PARTNER_KEYS]);
      for (const stack of [...(record.gave as object[]), ...(record.got as object[])]) {
        expect(Object.keys(stack)).toEqual([...TRADE_STACK_KEYS]);
      }
    }
  });

  it("never include a crafter, an object id or durability", () => {
    const every = [...TRADE_RECORD_KEYS, ...TRADE_SELF_KEYS, ...TRADE_PARTNER_KEYS, ...TRADE_STACK_KEYS].map((k) =>
      k.toLowerCase(),
    );
    for (const banned of ["crafter", "crafted", "objid", "objectid", "durability", "spells", "passives", "position"]) {
      expect(every.filter((key) => key.includes(banned)), banned).toEqual([]);
    }
  });
});
