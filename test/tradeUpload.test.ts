import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stampForLootLog, type TEngineStamp } from "../src/main/engineRef.js";
import { createHeldStore, heldUploadsFilePath, loadHeldRanges } from "../src/main/heldUploads.js";
import {
  ETradeWithheld,
  MAX_TRADE_LINE_LENGTH,
  tradeLineVerdict,
  tradeStreamLine,
} from "../src/main/tradeLines.js";
import {
  TRADE_MISSING_ROUTE_DELAY_MS,
  TRADE_STREAM,
  tradeFileFor,
  tradeFileThisSession,
  tradesBroken,
  withTradeEvents,
} from "../src/main/tradeUpload.js";
import {
  ENGINE_HEADER,
  EUploadOutcome,
  LOOT_RULES_HEADER,
  uploadBatch,
  uploadTradeBatch,
} from "../src/main/uploadClient.js";
import { BOT_REFUSED, createUploader, EUploaderState, retryDelayMs } from "../src/main/uploader.js";
import type { THeldRange } from "../src/main/uploadPlan.js";
import type { TBrokenHandler } from "../src/shared/captureTypes.js";
import { lootBroken } from "../src/shared/engineHealth.js";
import { REAL_TRADE_LINES } from "./fixtures/realTradeLines.js";

/**
 * The trade upload (raid-bot ADR 0168, Q69; the build plan's slice 1), end to end with no network
 * and no Electron: the engine's real journal lines, through the allow-list, the uploader with the
 * trade stream, and the wire.
 *
 * The record moves a debt between two members, so the properties pinned here are the ones that
 * fail silently: a trade sent twice under two keys, a line sent under the wrong index, a name the
 * game hid, a line the guild must never see — and the loot upload slowed or held by any of it.
 */

const L = REAL_TRADE_LINES;
const ITEM_TRADES = [3, 5, 6];
const SILVER_ONLY = [0, 1, 2, 4];

type TRecord = Record<string, unknown>;

/** Line 6 of the real journal (the plan's example) with one change, re-serialised. */
const edited = (edit: (record: TRecord) => void, line = L[6]!): string => {
  const record = JSON.parse(line) as TRecord;
  edit(record);
  return JSON.stringify(record);
};

describe("the engine's real journal, as this app reads it", () => {
  it("is record v1 on every line — nothing the engine writes today is refused", () => {
    for (const [i, line] of L.entries()) {
      const verdict = tradeLineVerdict(line);
      expect(verdict.ok || verdict.reason === ETradeWithheld.SilverOnly, `line ${i}`).toBe(true);
    }
  });

  it("withholds the four silver-only payouts and sends the three item trades", () => {
    expect(SILVER_ONLY.map((i) => tradeLineVerdict(L[i]!))).toEqual(
      SILVER_ONLY.map(() => ({ ok: false, reason: ETradeWithheld.SilverOnly, why: null })),
    );
    expect(ITEM_TRADES.map((i) => tradeLineVerdict(L[i]!).ok)).toEqual([true, true, true]);
  });

  it("sends an item trade's text verbatim — its silver included (owner, 2026-10-05)", () => {
    for (const i of ITEM_TRADES) {
      // The same string, not a re-serialisation: what the bot's text pin holds is what goes.
      expect(tradeStreamLine(L[i]!)).toBe(L[i]);
    }
    expect(JSON.parse(L[3]!)).toMatchObject({ silverGave: 0, silverGot: 5000000 });
    expect(JSON.parse(L[5]!)).toMatchObject({ silverGave: 0, silverGot: 10000 });
  });

  it("withholds an empty trade too — nothing moved, nothing to send", () => {
    expect(tradeLineVerdict(edited((r) => Object.assign(r, { gave: [], silverGave: 0, silverGot: 0 })))).toEqual({
      ok: false,
      reason: ETradeWithheld.SilverOnly,
      why: null,
    });
  });
});

describe("the field allow-list: only record v1 leaves the machine", () => {
  const refused = (line: string): string | null => {
    const verdict = tradeLineVerdict(line);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return null;
    }
    expect(verdict.reason).toBe(ETradeWithheld.Refused);
    return verdict.why;
  };

  /** Line 6 with `key: value` added — to the record, to `self` or `partner`, or to its first given stack. */
  const adding = (where: "line" | "self" | "partner" | "gave", key: string, value: unknown): string =>
    edited((r) => {
      const target = where === "line" ? r : where === "gave" ? (r.gave as TRecord[])[0]! : (r[where] as TRecord);
      target[key] = value;
    });
  const receivedStack = { index: 1, item: "T4_BAG", qty: 1, quality: 1, spells: [] };

  it.each([
    ["a crafter beside the record", adding("line", "crafter", "Crafter1"), "unknown key crafter"],
    ["an object id beside the record", adding("line", "objId", 643240000), "unknown key objId"],
    ["the partner's object id", adding("partner", "objId", 212924), "unknown key partner.objId"],
    ["a field on self", adding("self", "id", 7), "unknown key self.id"],
    ["a crafter on a stack", adding("gave", "crafter", "Crafter1"), "unknown key gave.crafter"],
    ["durability on a stack", adding("gave", "durability", 683440000), "unknown key gave.durability"],
    ["spells on a received stack", adding("line", "got", [receivedStack]), "unknown key got.spells"],
    ["a key a later engine adds", adding("line", "position", [1, 2]), "unknown key position"],
  ])("refuses %s — naming the key, never its value", (_label, line, why) => {
    expect(refused(line)).toBe(why);
    expect(tradeStreamLine(line)).toEqual({ withheld: ETradeWithheld.Refused, why });
  });

  /** Line 6's text with its partner object swapped for `partner`, written as given — no re-serialising. */
  const withPartnerText = (partner: string): string => {
    const original = '"partner":{"name":"Partner7","guild":"OurGuild","hidden":false}';
    expect(L[6]).toContain(original);
    return L[6]!.replace(original, `"partner":${partner}`);
  };

  it.each([
    // The case the text check exists for: a parse keeps the LAST copy of a key, so this reads as a
    // hidden partner — while the name the game hid is still in the bytes that would be sent.
    [
      "a hidden partner whose name rides in a repeated key",
      withPartnerText('{"name":"Leaked","guild":"LeakGuild","name":null,"guild":null,"hidden":true}'),
      "not the engine's own text",
    ],
    ["a repeated top-level key", L[6]!.replace('"zone":', '"zone":"elsewhere","zone":'), "not the engine's own text"],
    ["padding inside the line", L[6]!.replace('{"v":1,', '{ "v":1, '), "not the engine's own text"],
    ["padding after it", `${L[6]} `, "not the engine's own text"],
    ["an escape the engine never writes", L[6]!.replace('"Me"', String.raw`"\u004de"`), "not the engine's own text"],
    ["the record's keys reordered", L[6]!.replace('{"v":1,"t":"trade",', '{"t":"trade","v":1,'), "keys out of order"],
    [
      "a partner's keys reordered",
      withPartnerText('{"guild":"OurGuild","name":"Partner7","hidden":false}'),
      "partner keys out of order",
    ],
    [
      "a stack's keys reordered",
      L[6]!.replace('{"index":570,"item":"T7_POTION_REVIVE"', '{"item":"T7_POTION_REVIVE","index":570'),
      "gave keys out of order",
    ],
  ])("refuses %s — the text is what is sent, so the text is what is checked", (_label, line, why) => {
    expect(line).not.toBe(L[6]);
    expect(refused(line)).toBe(why);
  });

  it("finds every real engine line to be its own canonical text", () => {
    for (const line of L) {
      expect(JSON.stringify(JSON.parse(line))).toBe(line);
    }
  });

  it("refuses a record with a key missing", () => {
    expect(refused(edited((r) => delete r.silverGot))).toBe("missing key silverGot");
    expect(refused(edited((r) => delete (r.partner as TRecord).hidden))).toBe("missing key partner.hidden");
  });

  it("refuses anything that is not a v1 trade record", () => {
    expect(refused(edited((r) => Object.assign(r, { v: 2 })))).toBe("not a v1 trade record");
    expect(refused(edited((r) => Object.assign(r, { t: "loot" })))).toBe("not a v1 trade record");
    // The display name, which the engine draft once wrote: the bot refuses it, so does this app.
    expect(refused(edited((r) => Object.assign(r, { server: "Europe" })))).toBe("a value of the wrong kind");
    expect(refused(edited((r) => Object.assign(r, { silverGot: -1 })))).toBe("a value of the wrong kind");
    expect(refused(edited((r) => Object.assign(r, { gave: {} })))).toBe("gave or got is not a list");
    expect(refused("not json")).toBe("not JSON");
    expect(refused("[]")).toBe("line is not an object");
    expect(refused('{"v":1,"t":"trade"')).toBe("not JSON");
  });

  it("refuses a hidden partner that carries a name — a name the game hid stays hidden", () => {
    const masked = (partner: object): string => edited((r) => Object.assign(r, { partner }));
    expect(tradeLineVerdict(masked({ name: null, guild: null, hidden: true })).ok).toBe(true);
    const leak = "a hidden partner with a name or guild";
    expect(refused(masked({ name: "Partner7", guild: null, hidden: true }))).toBe(leak);
    expect(refused(masked({ name: null, guild: "OurGuild", hidden: true }))).toBe(leak);
  });

  it("takes an unknown partner and a member in no alliance as the engine writes them", () => {
    const partner = { name: null, guild: null, hidden: false };
    const unknown = edited((r) => Object.assign(r, { initiator: null, complete: false, partner }));
    expect(tradeLineVerdict(unknown).ok).toBe(true);
    expect(tradeLineVerdict(edited((r) => Object.assign(r.self as object, { alliance: null }))).ok).toBe(true);
    const unplaced = edited((r) => Object.assign(r, { acceptedRevision: null, server: null, zone: null }));
    expect(tradeLineVerdict(unplaced).ok).toBe(true);
  });

  it("refuses a line longer than a trade can be, rather than cutting JSON in half", () => {
    const long = edited((r) => Object.assign(r, { zone: "z".repeat(MAX_TRADE_LINE_LENGTH) }));
    expect(refused(long)).toBe(`longer than ${MAX_TRADE_LINE_LENGTH} characters`);
  });
});

// --- the follower ---------------------------------------------------------------------------------

type TBody = { run: string; file: string; from: number; lines: string[] };

type TWorld = {
  /** Text of each file, as the engine has written it so far. */
  files: Map<string, string>;
  /** The loot log the engine announced (state.logFile in main). */
  lootFile: string | null;
  /** state.logFile as this capture session started (main's startUploadLoop): the LAST session's. */
  lootFileAtStart: string | null;
  /** A trade line the bot answers 400 for, whatever batch carries it. */
  refuseTrade: string | null;
  broken: TBrokenHandler[] | null;
  received: Array<{ url: string; engine: string | undefined; lootRules: string | undefined } & TBody>;
  /** Status the bot answers on `/trades` (200 = take the batch). */
  tradeStatus: number;
  clock: { now: number };
  logs: string[];
  runs: number;
};

const LOOT = "/captures/loot-events-2026-09-16-14-43-52.txt";
const TRADES = "/captures/trade-events-2026-09-16-14-43-52.jsonl";

const world = (): TWorld => ({
  files: new Map(),
  lootFile: LOOT,
  lootFileAtStart: null,
  refuseTrade: null,
  broken: null,
  received: [],
  tradeStatus: 200,
  clock: { now: 1_000 },
  logs: [],
  runs: 0,
});

/** The engine appends finished lines, as `trade-log.js` does: one line and its newline per trade. */
const append = (w: TWorld, file: string, lines: readonly string[]): void => {
  w.files.set(file, `${w.files.get(file) ?? ""}${lines.map((line) => `${line}\n`).join("")}`);
};

const memoryHolds = (): { list: () => readonly THeldRange[]; add: (r: THeldRange) => boolean } => {
  const ranges: THeldRange[] = [];
  return {
    list: () => ranges,
    add: (range) => {
      ranges.push(range);
      return true;
    },
  };
};

type THolds = ReturnType<typeof memoryHolds>;

const fetchFor = (w: TWorld): Parameters<typeof createUploader>[0]["fetchLike"] => async (url, init) => {
  const status = url.endsWith("/trades") ? w.tradeStatus : 200;
  if (status !== 200) {
    return { ok: false, status, text: async () => "{}" };
  }
  const body = JSON.parse(init.body) as TBody;
  if (url.endsWith("/trades") && w.refuseTrade != null && body.lines.includes(w.refuseTrade)) {
    return { ok: false, status: 400, text: async () => JSON.stringify({ error: "bad line" }) };
  }
  w.received.push({ url, engine: init.headers[ENGINE_HEADER], lootRules: init.headers[LOOT_RULES_HEADER], ...body });
  const reply = { accepted: body.lines.length, duplicate: 0, rejected: 0, nextFrom: body.from + body.lines.length };
  return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
};

/** The two uploaders main builds, with main's rules: the loot hold, and the trade hold beside it. */
const apps = (
  w: TWorld,
  holds: THolds = memoryHolds(),
  engine: () => TEngineStamp | null = () => ({ ref: "0123456789abcdef0123456789abcdef01234567", lootRules: 1 }),
) => {
  const common = {
    fetchLike: fetchFor(w),
    base: "https://bot",
    token: () => "tok",
    enabled: () => true,
    readFile: async (path: string) => {
      const text = w.files.get(path);
      if (text == null) {
        throw new Error("ENOENT");
      }
      return text;
    },
    newRunId: () => `run-${++w.runs}`,
    now: () => w.clock.now,
    log: (line: string) => w.logs.push(line),
    holds,
    engine,
  };
  return {
    loot: createUploader({ ...common, currentFile: () => w.lootFile, held: () => lootBroken(w.broken) }),
    trades: createUploader({
      ...common,
      currentFile: () => tradeFileThisSession(w.lootFile, w.lootFileAtStart),
      held: () => tradesBroken(w.broken),
      stream: TRADE_STREAM,
    }),
  };
};

const tradeBatches = (w: TWorld) =>
  w.received.filter((r) => r.url.endsWith("/trades")).map(({ run, file, from, lines }) => ({ run, file, from, lines }));
const lootLines = (w: TWorld): string[] => w.received.filter((r) => r.url.endsWith("/upload")).flatMap((r) => r.lines);

/** Pass after pass, as main's 10-second timer would, until nothing changes. */
const settle = async (uploader: { tick: () => Promise<void> }, w: TWorld, passes = 4): Promise<void> => {
  for (let i = 0; i < passes; i += 1) {
    w.clock.now += 10_000;
    await uploader.tick();
  }
};

describe("following the trade journal", () => {
  it("finds the journal by the loot log's name — the engine's own rule", () => {
    expect(tradeFileFor(LOOT)).toBe(TRADES);
    expect(tradeFileFor(null)).toBeNull();
    expect(tradeFileFor("/captures/engine-output-1.log")).toBeNull();
    expect(tradeFileFor("/captures/loot-events-x.csv")).toBeNull();
  });

  it("follows only this session's journal — nothing while the loot log is still the last session's", () => {
    expect(tradeFileThisSession(LOOT, null)).toBe(TRADES);
    expect(tradeFileThisSession(LOOT, LOOT)).toBeNull();
    expect(tradeFileThisSession(null, null)).toBeNull();
    expect(tradeFileThisSession(LOOT, "/captures/loot-events-2026-09-15-10-00-00.txt")).toBe(TRADES);
  });

  it("a new session never sends the last session's trades again, under a new run", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, [L[3]!, L[6]!]);
    await settle(trades, w);
    const first = { run: "run-1", file: TRADES, from: 0, lines: [L[3], L[6]] };
    expect(tradeBatches(w)).toEqual([first]);

    // Start again (main's startUploadLoop): the cursor is reset, and main still names the last log
    // until the new engine prints its own — seconds, or longer when its version check stalls.
    w.lootFileAtStart = w.lootFile;
    trades.resetSession();
    await settle(trades, w, 6);
    expect(tradeBatches(w)).toEqual([first]);
    expect(w.runs).toBe(1);

    // This session's engine names its log: its journal, and only it, is followed — from its line 0.
    w.lootFile = "/captures/loot-events-2026-09-17-00-00-00.txt";
    const next = "/captures/trade-events-2026-09-17-00-00-00.jsonl";
    append(w, next, [L[5]!]);
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([first, { run: "run-2", file: next, from: 0, lines: [L[5]] }]);
  });

  it("sends the item trades at their indices in the file, each line verbatim", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, L);
    await settle(trades, w);
    // 0–2 silver-only: passed over; 3 sent alone (4 is withheld); then 5–6 together.
    expect(tradeBatches(w)).toEqual([
      { run: "run-1", file: TRADES, from: 3, lines: [L[3]] },
      { run: "run-1", file: TRADES, from: 5, lines: [L[5], L[6]] },
    ]);
    expect(trades.status().state).toBe(EUploaderState.UpToDate);
    expect(trades.status().withheld).toEqual({ [ETradeWithheld.SilverOnly]: 4 });
  });

  it("counts a withheld line once, however many passes read it", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, L.slice(0, 3));
    await settle(trades, w, 6);
    expect(trades.status().withheld).toEqual({ [ETradeWithheld.SilverOnly]: 3 });
    expect(tradeBatches(w)).toEqual([]);
    // A later item trade still gets ITS index — the silver-only lines before it kept theirs.
    append(w, TRADES, [L[3]!]);
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 3, lines: [L[3]] }]);
    expect(trades.status().withheld).toEqual({ [ETradeWithheld.SilverOnly]: 3 });
  });

  it("logs a refused line by its reason, never its content", async () => {
    const w = world();
    const { trades } = apps(w);
    const leaky = edited((r) => Object.assign((r.gave as object[])[0]!, { crafter: "Crafter1" }));
    append(w, TRADES, [leaky, L[6]!]);
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 1, lines: [L[6]] }]);
    expect(trades.status().withheld).toEqual({ [ETradeWithheld.Refused]: 1 });
    expect(w.logs).toContain(`[trades] line 0 of ${TRADES} is not sent: refused (unknown key gave.crafter)`);
    expect(w.logs.join("\n")).not.toContain("Crafter1");
    expect(w.logs.join("\n")).not.toContain("Partner7");
  });

  it("waits for a line the engine is still writing, then sends it whole", async () => {
    const w = world();
    const { trades } = apps(w);
    const line = L[6]!;
    w.files.set(TRADES, line.slice(0, 40));
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([]);
    expect(trades.status().withheld).toEqual({});
    w.files.set(TRADES, `${line}\n`);
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 0, lines: [line] }]);
  });

  it("waits quietly while no trade has finished (no journal yet)", async () => {
    const w = world();
    const { trades } = apps(w);
    await settle(trades, w);
    expect(w.received).toEqual([]);
    expect(trades.status().state).not.toBe(EUploaderState.Blocked);
    expect(trades.status().failures).toBe(0);
  });

  it("retries a failed batch under the same run and index — the bot's key makes it a no-op", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, [L[6]!]);
    w.tradeStatus = 503;
    await trades.tick();
    expect(trades.status().state).toBe(EUploaderState.Retrying);
    w.tradeStatus = 200;
    w.clock.now += retryDelayMs(1) + 1;
    await trades.tick();
    await trades.tick();
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 0, lines: [L[6]] }]);
  });

  it("passes over a line the bot refuses even alone — the trades after it still go", async () => {
    const w = world();
    const { trades } = apps(w);
    w.refuseTrade = L[5]!;
    append(w, TRADES, [L[3]!, L[5]!, L[6]!]);
    for (let i = 0; i < 10; i += 1) {
      w.clock.now += retryDelayMs(99);
      await trades.tick();
    }
    // Halved to the one line, refused there, withheld at its index; the line after it keeps index 2.
    expect(tradeBatches(w)).toEqual([
      { run: "run-1", file: TRADES, from: 0, lines: [L[3]] },
      { run: "run-1", file: TRADES, from: 2, lines: [L[6]] },
    ]);
    expect(trades.status().state).toBe(EUploaderState.UpToDate);
    expect(trades.status().withheld).toEqual({ [BOT_REFUSED]: 1 });
    expect(w.logs).toContain(`[trades] line 1 of ${TRADES} is not sent: ${BOT_REFUSED} (rejected bad line)`);
    expect(w.logs.join("\n")).not.toContain("Partner6");
  });

  it("never stops for one: a bot that refuses every line leaves the uploader asking, never Blocked", async () => {
    const w = world();
    const { trades } = apps(w);
    w.refuseTrade = L[6]!;
    append(w, TRADES, [L[6]!]);
    await trades.tick();
    expect(trades.status().state).toBe(EUploaderState.Retrying);
    expect(trades.status().withheld).toEqual({ [BOT_REFUSED]: 1 });
    // Paced by the backoff, not hammered: the next try waits for it.
    append(w, TRADES, [L[3]!]);
    w.refuseTrade = L[3]!;
    await trades.tick();
    expect(trades.status().withheld).toEqual({ [BOT_REFUSED]: 1 });
    w.clock.now += retryDelayMs(1);
    await trades.tick();
    expect(trades.status().withheld).toEqual({ [BOT_REFUSED]: 2 });
    expect(trades.status().state).not.toBe(EUploaderState.Blocked);
    expect(tradeBatches(w)).toEqual([]);
  });

  it("rolls with the loot log: the next journal is a new run, from its own line 0", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, [L[3]!]);
    await settle(trades, w);
    w.lootFile = "/captures/loot-events-2026-09-17-00-00-00.txt";
    const next = "/captures/trade-events-2026-09-17-00-00-00.jsonl";
    append(w, next, [L[6]!]);
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([
      { run: "run-1", file: TRADES, from: 0, lines: [L[3]] },
      { run: "run-2", file: next, from: 0, lines: [L[6]] },
    ]);
  });
});

describe("a bot that does not take trades yet", () => {
  it("keeps the lines, asks again every half hour, says so once — and the member hears nothing", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, [L[3]!]);
    w.tradeStatus = 404;
    await trades.tick();
    expect(trades.status()).toMatchObject({ state: EUploaderState.BotOutdated, lastError: EUploadOutcome.NotDeployed });

    // Not every few seconds: nothing until the half hour is up.
    let asked = 0;
    const counting = createUploader({
      fetchLike: async () => {
        asked += 1;
        return { ok: false, status: 404, text: async () => "{}" };
      },
      base: "https://bot",
      token: () => "tok",
      enabled: () => true,
      currentFile: () => TRADES,
      readFile: async () => `${L[3]}\n`,
      newRunId: () => "run-x",
      now: () => w.clock.now,
      log: (line) => w.logs.push(line),
      held: () => false,
      holds: memoryHolds(),
      stream: TRADE_STREAM,
    });
    await counting.tick();
    for (let t = 0; t < TRADE_MISSING_ROUTE_DELAY_MS; t += 60_000) {
      w.clock.now += 60_000;
      await counting.tick();
    }
    expect(asked).toBe(2);
    expect(w.logs.filter((l) => l.includes("no route for them yet"))).toHaveLength(2); // once per uploader

    // The bot is updated: the very next try sends what was kept, at its index.
    w.tradeStatus = 200;
    w.clock.now += TRADE_MISSING_ROUTE_DELAY_MS;
    await trades.tick();
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 0, lines: [L[3]] }]);
    expect(trades.status().state).toBe(EUploaderState.UpToDate);
  });

  it("reads a 405 the same way — the other answer a bot without the route gives", async () => {
    const w = world();
    const { trades } = apps(w);
    append(w, TRADES, [L[6]!]);
    w.tradeStatus = 405;
    await trades.tick();
    expect(trades.status()).toMatchObject({ state: EUploaderState.BotOutdated, lastError: EUploadOutcome.NotDeployed });
    w.tradeStatus = 200;
    w.clock.now += TRADE_MISSING_ROUTE_DELAY_MS - 1;
    await trades.tick();
    expect(tradeBatches(w)).toEqual([]);
    w.clock.now += 1;
    await trades.tick();
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 0, lines: [L[6]] }]);
  });

  it("never slows the loot upload beside it", async () => {
    const w = world();
    const { loot, trades } = apps(w);
    w.tradeStatus = 404;
    append(w, TRADES, [L[3]!]);
    for (let i = 0; i < 5; i += 1) {
      append(w, LOOT, [`loot-${i}`]);
      w.clock.now += 10_000;
      await Promise.all([loot.tick(), trades.tick()]);
    }
    expect(lootLines(w)).toEqual(["loot-0", "loot-1", "loot-2", "loot-3", "loot-4"]);
    expect(loot.status().state).toBe(EUploaderState.UpToDate);
    expect(tradeBatches(w)).toEqual([]);
  });

  it("is the trade stream's rule only — loot's missing route keeps the ordinary backoff", async () => {
    const w = world();
    const up = createUploader({
      fetchLike: async () => ({ ok: false, status: 404, text: async () => "{}" }),
      base: "https://bot",
      token: () => "tok",
      enabled: () => true,
      currentFile: () => LOOT,
      readFile: async () => "a\n",
      newRunId: () => "run-1",
      now: () => w.clock.now,
      log: (line) => w.logs.push(line),
      held: () => false,
      holds: memoryHolds(),
    });
    await up.tick();
    expect(up.status().state).toBe(EUploaderState.BotOutdated);
    expect(w.logs.at(-1)).toContain(`retrying in ${retryDelayMs(1) / 1000}s`);
  });
});

describe("the hold: what was decoded while broken is never sent", () => {
  const TRADE_UPDATE = { handler: "EvPlayerTradeUpdate", failures: 6, calls: 6 };
  const ATTACH = { handler: "EvAttachItemContainer", failures: 5, calls: 5 };
  const ENERGY = { handler: "OpGuildEnergyDrain", failures: 6, calls: 6 };

  it("decides when trades hold: a trade handler, or anything that holds loot", () => {
    expect(tradesBroken(null)).toBe(false);
    expect(tradesBroken([ENERGY])).toBe(false);
    expect(tradesBroken([TRADE_UPDATE])).toBe(true);
    expect(tradesBroken([ATTACH])).toBe(true);
    // A handler nobody has heard of feeds loot (NON_LOOT_HANDLERS), so it holds trades too.
    expect(tradesBroken([{ handler: "EvSomethingNew", failures: 5, calls: 5 }])).toBe(true);
  });

  it("a broken trade decoder holds the trades only — the loot goes on", async () => {
    const w = world();
    const holds = memoryHolds();
    const { loot, trades } = apps(w, holds);
    append(w, TRADES, [L[3]!]);
    await settle(trades, w, 1);
    w.broken = [TRADE_UPDATE];
    append(w, TRADES, [L[5]!, L[6]!]);
    append(w, LOOT, ["loot-0", "loot-1"]);
    await settle(trades, w);
    await settle(loot, w);
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 0, lines: [L[3]] }]);
    expect(trades.status().state).toBe(EUploaderState.Held);
    expect(lootLines(w)).toEqual(["loot-0", "loot-1"]);
    expect(loot.status().state).toBe(EUploaderState.UpToDate);
    expect(holds.list()).toEqual([expect.objectContaining({ file: TRADES, from: 1, run: "run-1" })]);
  });

  it("a broken loot decoder holds both", async () => {
    const w = world();
    const holds = memoryHolds();
    const { loot, trades } = apps(w, holds);
    w.broken = [ATTACH];
    append(w, TRADES, [L[3]!]);
    append(w, LOOT, ["loot-0"]);
    await settle(trades, w);
    await settle(loot, w);
    expect(w.received).toEqual([]);
    expect(holds.list().map((r) => [r.file, r.from])).toEqual([
      [TRADES, 0],
      [LOOT, 0],
    ]);
  });

  it("holds even before the journal exists: trades finished while broken are never sent", async () => {
    const w = world();
    const holds = memoryHolds();
    const { trades } = apps(w, holds);
    w.broken = [TRADE_UPDATE];
    await settle(trades, w, 1);
    expect(holds.list()).toEqual([expect.objectContaining({ file: TRADES, from: 0, run: null })]);
    w.broken = null;
    append(w, TRADES, [L[3]!, L[6]!]);
    await settle(trades, w);
    expect(tradeBatches(w)).toEqual([]);
  });

  it("survives the restart into the fix, in ONE store with the loot's ranges", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gbc-trade-held-"));
    const file = heldUploadsFilePath(dir);
    const w = world();
    const store = createHeldStore(file, () => undefined);
    const broken = apps(w, store);
    append(w, TRADES, [L[3]!]);
    append(w, LOOT, ["loot-0"]);
    await settle(broken.trades, w, 1);
    await settle(broken.loot, w, 1);
    w.broken = [ATTACH];
    append(w, TRADES, [L[5]!, L[6]!]);
    append(w, LOOT, ["loot-1"]);
    await settle(broken.trades, w, 1);
    await settle(broken.loot, w, 1);
    // Both streams' holds, side by side in the one file: neither store wrote over the other.
    expect(loadHeldRanges(file).ranges.map((r) => [r.file, r.from, r.run])).toEqual([
      [TRADES, 1, "run-1"],
      [LOOT, 1, "run-2"],
    ]);

    // The update is an app restart: new uploaders, the break forgotten, the same files handed back.
    w.broken = null;
    w.runs = 0;
    const fixed = apps(w, createHeldStore(file, () => undefined));
    append(w, TRADES, [L[3]!]);
    await settle(fixed.trades, w);
    await settle(fixed.loot, w);
    expect(tradeBatches(w)).toEqual([{ run: "run-1", file: TRADES, from: 0, lines: [L[3]] }]);
    expect(lootLines(w)).toEqual(["loot-0"]);
  });
});

describe("the engine version and its loot-rules level, on both line routes", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const capture = () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const fetchLike: Parameters<typeof uploadBatch>[0] = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, status: 200, text: async () => JSON.stringify({ accepted: 1, nextFrom: 1 }) };
    };
    return { calls, fetchLike };
  };
  const batch = { from: 0, lines: ["a"] };

  it("names it in the X-Capture-Engine header — never in the body, whose keys stay /upload's", async () => {
    const { calls, fetchLike } = capture();
    const bundled = { ref: SHA, lootRules: 1 };
    expect((await uploadBatch(fetchLike, "https://bot", "tok", "run", "f.txt", batch, bundled)).outcome).toBe(
      EUploadOutcome.Accepted,
    );
    const dev = { ref: "dev", lootRules: null };
    expect((await uploadTradeBatch(fetchLike, "https://bot", "tok", "run", "t.jsonl", batch, dev)).outcome).toBe(
      EUploadOutcome.Accepted,
    );
    expect(calls.map((c) => [c.url, c.headers[ENGINE_HEADER], c.headers.authorization])).toEqual([
      ["https://bot/control/capture/upload", SHA, "Bearer tok"],
      ["https://bot/control/capture/trades", "dev", "Bearer tok"],
    ]);
    for (const call of calls) {
      expect(Object.keys(call.body)).toEqual(["run", "file", "from", "lines"]);
    }
    expect(ENGINE_HEADER).toBe("x-capture-engine");
  });

  it("sends the level beside it as X-Capture-Loot-Rules, in plain decimal, on both routes", async () => {
    const { calls, fetchLike } = capture();
    await uploadBatch(fetchLike, "https://bot", "tok", "run", "f.txt", batch, { ref: SHA, lootRules: 1 });
    await uploadTradeBatch(fetchLike, "https://bot", "tok", "run", "t.jsonl", batch, { ref: SHA, lootRules: 1 });
    // Zero is a level like any other — sent, never mistaken for "none".
    await uploadBatch(fetchLike, "https://bot", "tok", "run", "f.txt", batch, { ref: SHA, lootRules: 0 });
    await uploadTradeBatch(fetchLike, "https://bot", "tok", "run", "t.jsonl", batch, { ref: SHA, lootRules: 12 });
    expect(calls.map((c) => [c.url.split("/").at(-1), c.headers[LOOT_RULES_HEADER]])).toEqual([
      ["upload", "1"],
      ["trades", "1"],
      ["upload", "0"],
      ["trades", "12"],
    ]);
    for (const call of calls) {
      expect(Object.keys(call.body)).toEqual(["run", "file", "from", "lines"]);
    }
    expect(LOOT_RULES_HEADER).toBe("x-capture-loot-rules");
  });

  it("leaves the level out when the app cannot vouch for one — never empty, never 0, never `unknown`", async () => {
    const { calls, fetchLike } = capture();
    await uploadBatch(fetchLike, "https://bot", "tok", "run", "f.txt", batch, { ref: "unknown", lootRules: null });
    await uploadTradeBatch(fetchLike, "https://bot", "tok", "run", "t.jsonl", batch, { ref: "dev", lootRules: null });
    for (const call of calls) {
      expect(call.headers[ENGINE_HEADER]).toBeDefined();
      expect(call.headers).not.toHaveProperty(LOOT_RULES_HEADER);
    }
  });

  it("sends neither header when the caller names no engine", async () => {
    const { calls, fetchLike } = capture();
    await uploadBatch(fetchLike, "https://bot", "tok", "run", "f.txt", batch);
    await uploadTradeBatch(fetchLike, "https://bot", "tok", "run", "t.jsonl", batch, null);
    for (const call of calls) {
      expect(call.headers).not.toHaveProperty(ENGINE_HEADER);
      expect(call.headers).not.toHaveProperty(LOOT_RULES_HEADER);
    }
  });

  it("rides every batch both uploaders send", async () => {
    const w = world();
    const { loot, trades } = apps(w);
    append(w, LOOT, ["loot-0"]);
    append(w, TRADES, [L[6]!]);
    await settle(loot, w, 1);
    await settle(trades, w, 1);
    expect(w.received.map((r) => [r.url.split("/").at(-1), r.engine, r.lootRules])).toEqual([
      ["upload", SHA, "1"],
      ["trades", SHA, "1"],
    ]);
  });

  it("is read per batch, so neither uploader sends a level its engine no longer vouches for", async () => {
    const w = world();
    let stamp: { ref: string; lootRules: number | null } = { ref: SHA, lootRules: 1 };
    const { loot, trades } = apps(w, undefined, () => stamp);
    append(w, LOOT, ["loot-0"]);
    append(w, TRADES, [L[6]!]);
    await settle(loot, w, 1);
    await settle(trades, w, 1);
    // A new Start over a dev engine: the same uploaders, the next batches without a level.
    stamp = { ref: "dev", lootRules: null };
    append(w, LOOT, ["loot-1"]);
    append(w, TRADES, [L[3]!]);
    await settle(loot, w, 1);
    await settle(trades, w, 1);
    expect(w.received.map((r) => [r.url.split("/").at(-1), r.engine, r.lootRules])).toEqual([
      ["upload", SHA, "1"],
      ["trades", SHA, "1"],
      ["upload", "dev", undefined],
      ["trades", "dev", undefined],
    ]);
  });
});

describe("a re-sent log keeps the stamp of the engine that wrote it (stampForLootLog)", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const PREV = "/captures/loot-events-2026-09-16-12-00-00.txt";

  it("a Start over the bundled engine re-sends a dev engine's log without a level — never as level 1", async () => {
    const w = world();
    const written = new Map<string, TEngineStamp>();
    let session: TEngineStamp = { ref: "dev", lootRules: null };
    // As main wires it: the stamp of the file being sent, recorded when its engine named it.
    const { loot } = apps(w, undefined, () => stampForLootLog(w.lootFile, written, session));
    // Session 1, a dev (or Advanced-folder) engine: it names PREV and writes to it.
    w.lootFile = PREV;
    written.set(PREV, session);
    append(w, PREV, ["dev-0", "dev-1"]);
    await settle(loot, w, 1);
    // Session 2, the bundled engine at level 1. Start keeps PREV as the current log and resets the
    // cursor, and the engine has not named its own log yet (item table, version check): the first
    // pass sends PREV again from line 0, under a new run.
    session = { ref: SHA, lootRules: 1 };
    w.lootFileAtStart = PREV;
    loot.resetSession();
    await settle(loot, w, 1);
    // Then the bundled engine names its log and writes to it.
    w.lootFile = LOOT;
    written.set(LOOT, session);
    append(w, LOOT, ["bundled-0"]);
    await settle(loot, w, 1);
    expect(w.received.map((r) => [r.run, r.from, r.lines.join(","), r.engine, r.lootRules])).toEqual([
      ["run-1", 0, "dev-0,dev-1", "dev", undefined],
      // The re-send: a new run, the dev engine's lines — stamped as the dev engine's, with no level.
      ["run-2", 0, "dev-0,dev-1", "dev", undefined],
      ["run-3", 0, "bundled-0", SHA, "1"],
    ]);
  });
});

describe("the engine is asked for the journal only under the v5 flag", () => {
  it("sets TRADE_EVENTS for the v5 shell's engine and removes it for the old window's", () => {
    expect(withTradeEvents({ PATH: "/bin" }, true)).toEqual({ PATH: "/bin", TRADE_EVENTS: "1" });
    expect(withTradeEvents({ PATH: "/bin" }, false)).toEqual({ PATH: "/bin" });
    // Inherited from a developer's shell: the old window's engine still writes no journal.
    expect(withTradeEvents({ PATH: "/bin", TRADE_EVENTS: "1" }, false)).toEqual({ PATH: "/bin" });
  });

  it("does not touch the environment it is given", () => {
    const env = { TRADE_EVENTS: "1" };
    withTradeEvents(env, false);
    expect(env).toEqual({ TRADE_EVENTS: "1" });
  });
});
