import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseActivityLine, parseLootLine, type TSessionEvent } from "../src/shared/session/events.js";
import {
  closeSession,
  mobTotal,
  newSession,
  ownLoot,
  quantityTotal,
  reduceSession,
  restartSession,
} from "../src/shared/session/model.js";
const DIR = join(__dirname, "fixtures", "session");
const evening = () => {
  const events = readdirSync(DIR)
    .filter((file) => /\.(jsonl|txt)$/.test(file))
    .flatMap((file) =>
      readFileSync(join(DIR, file), "utf8")
        .trim()
        .split("\n")
        .flatMap((line) => {
          if (line.startsWith("timestamp_utc;")) {
            return [];
          }
          const ev = file.endsWith("jsonl") ? parseActivityLine(line) : parseLootLine(line);
          expect(ev, `${file}: ${line}`).not.toBeNull();
          return [{ file, ev: ev! }];
        }),
    )
    .sort((a, b) => a.ev.at - b.ev.at);
  return events.reduce(
    (state, { ev, file }) => reduceSession(state, ev, file),
    newSession("recording", events[0]!.ev.at),
  );
};
describe("September 21 evening through the session model", () => {
  it("matches every raw currency total without rounding individual gains", () => {
    const session = evening();
    expect(session.activityLines).toBe(361);
    expect(session.totals).toEqual({
      fame: 13307603664,
      respec: 2351349126,
      respecPaid: 2720068000,
      silverGross: 159818447,
      silverTax: 17655807,
      silver: 142162640,
      might: 159966314,
      favor: 70156519,
      faction: 113949404,
    });
    const raw = readdirSync(DIR)
      .filter((f) => f.endsWith("jsonl"))
      .flatMap((file) =>
        readFileSync(join(DIR, file), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      );
    expect(session.totals.fame).toBe(raw.filter((e) => e.t === "fame").reduce((n, e) => n + e.gain, 0));
    expect(Object.values(session.zones).reduce((n, z) => n + z.fame, 0)).toBe(session.totals.fame);
    expect(Object.values(session.zones).reduce((n, z) => n + z.silver, 0)).toBe(session.totals.silver);
  });
  it("reconciles all 38 join-to-join spans within the two observed engine runs", () => {
    const audits = Object.values(evening().audits);
    expect(audits.reduce((n, a) => n + a.spans, 0)).toBe(38);
    expect(audits.reduce((n, a) => n + a.mismatches, 0)).toBe(0);
  });
  it("counts mobs, chest openings, resource bonuses and actual catch quantities", () => {
    const session = evening();
    expect(mobTotal(session)).toBe(40);
    expect(session.chestCount).toBe(1);
    expect(session.fishing).toEqual({ landed: 1, escaped: 1 });
    expect(quantityTotal(session.catches)).toBe(4);
    expect(session.catches.T3_FISH_FRESHWATER_STEPPE_RARE?.qty).toBe(2);
    expect(session.catches.T1_SEAWEED?.qty).toBe(2);
    expect(quantityTotal(session.harvests)).toBe(19);
    const loot = readdirSync(DIR)
      .filter((f) => f.endsWith("txt"))
      .flatMap((file) =>
        readFileSync(join(DIR, file), "utf8")
          .trim()
          .split("\n")
          .slice(1)
          .map((line) => parseLootLine(line)!),
      );
    expect(session.lootLines).toBe(loot.length);
    expect(ownLoot(session)?.qty).toBe(loot.filter((l) => l.looter === "Recorder").reduce((n, l) => n + l.qty, 0));
    expect(Object.values(session.looters).reduce((n, l) => n + l.qty, 0)).toBe(loot.reduce((n, l) => n + l.qty, 0));
    expect(session.feed).toHaveLength(61);
  });
});
describe("session invariants", () => {
  const zone = { v: 1, t: "zone", at: 100, char: "Me", zone: "1354", items: "live", fame_total: 1000 } as const;
  const fame = { v: 1, t: "fame", at: 110, char: "Me", zone: "1354", gain: 101, premium: false } as const;
  it("keeps completed journals by item/index without inventing progress or counting a new session twice", () => {
    const book = {
      v: 1,
      t: "journal",
      at: 110,
      char: "Me",
      zone: "1354",
      item: "T8_JOURNAL_WARRIOR_FULL",
      index: 12055,
      qty: 1,
    } as const;
    const empty = newSession("one", 100);
    let session = reduceSession(empty, zone);
    for (const qty of [1, 4, 1]) {
      session = reduceSession(session, { ...book, qty });
    }
    session = reduceSession(session, { ...book, item: null, index: 99999, qty: 2 });
    expect(session.journals.T8_JOURNAL_WARRIOR_FULL?.qty).toBe(6);
    expect(session.journals["index:99999"]).toEqual({ item: null, index: 99999, qty: 2 });
    expect(empty.journals).toEqual({});
    expect(session.totals.fame).toBeNull();
    expect(restartSession(session, "two", 120).journals).toEqual({});
    const closed = closeSession(session, 120);
    expect(reduceSession(closed, book)).toBe(closed);
  });
  it("refuses malformed journal counts and preserves unknown names", () => {
    const book = { v: 1, t: "journal", at: 110, char: "Me", zone: null, item: null, index: 12055, qty: 1 };
    expect(parseActivityLine(JSON.stringify(book))).toEqual(book);
    for (const qty of [undefined, null, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseActivityLine(JSON.stringify({ ...book, qty }))).toBeNull();
    }
    for (const index of [undefined, null, "12055", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseActivityLine(JSON.stringify({ ...book, index }))).toBeNull();
    }
  });
  it("keeps unknown totals null and leaves the input immutable", () => {
    const empty = newSession("one", 100);
    const next = reduceSession(empty, zone);
    expect(next.totals.silver).toBeNull();
    expect(empty.zones).toEqual({});
    expect(empty.events).toBe(0);
  });
  it("keeps unlocated gains in an explicit unknown source", () => {
    const session = reduceSession(newSession("one", 100), { ...fame, zone: null });
    expect(session.unlocated.fame).toBe(101);
    expect(session.zones).toEqual({});
    expect(session.totals.fame).toBe(101);
  });
  it("counts identical genuine payloads and detects a missing gain", () => {
    let session = reduceSession(newSession("one", 100), zone);
    session = reduceSession(session, fame);
    session = reduceSession(session, fame);
    session = reduceSession(session, { ...zone, at: 120, fame_total: 1202 });
    expect(session.totals.fame).toBe(202);
    expect(session.audits.activity?.mismatches).toBe(0);
    session = reduceSession(session, { ...zone, at: 130, fame_total: 1250 });
    expect(session.audits.activity?.mismatches).toBe(1);
  });
  it("closes once, preserves late fame's original zone and never counts stopped time", () => {
    let session = reduceSession(newSession("one", 100), zone);
    session = reduceSession(session, { ...zone, at: 200, zone: "1339" });
    session = reduceSession(session, { ...fame, at: 220 });
    const closed = closeSession(session, 300);
    expect(closed.zones["1354"]?.fame).toBe(101);
    expect(closed.zones["1354"]?.ms).toBe(100);
    expect(closed.zones["1339"]?.ms).toBe(100);
    expect(closeSession(closed, 500)).toBe(closed);
    expect(reduceSession(closed, fame)).toBe(closed);
  });
  it("refuses future or malformed activity instead of making up zeros", () => {
    for (const row of [
      { ...fame, v: 2 },
      { ...fame, gain: "101" },
      { ...fame, gain: 1.5 },
      { ...fame, gain: Number.MAX_SAFE_INTEGER + 1 },
      { ...fame, t: "new-kind" },
    ]) {
      expect(parseActivityLine(JSON.stringify(row))).toBeNull();
    }
    expect(parseActivityLine("{")).toBeNull();
    expect(
      parseActivityLine(JSON.stringify({ ...fame, t: "fish", outcome: "escaped", catch: "malformed" })),
    ).toBeNull();
    expect(parseLootLine("timestamp_utc;header")).toBeNull();
  });
});
