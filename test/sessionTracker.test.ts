import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionTracker } from "../src/main/sessionTracker.js";
import { createSessionTail } from "../src/main/sessionFiles.js";
import { listSessionFiles, readSessionBytes, saveSessionSummary } from "../src/main/sessionDisk.js";
import type { TSession } from "../src/shared/session/model.js";
const directories: string[] = [];
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), "loot-session-"));
  directories.push(path);
  return path;
};
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});
const fame = (at: number, gain = 101) =>
  JSON.stringify({ v: 1, t: "fame", at, char: "Member", zone: "1354", gain, premium: false }) + "\n";
const tracker = (folder: string) => {
  let clock = 100;
  let id = 0;
  let tick = () => {};
  const pushes: TSession[] = [];
  const save = vi.fn((s: TSession) => saveSessionSummary(folder, s));
  const log = vi.fn();
  const session = createSessionTracker({
    list: () => listSessionFiles(folder),
    read: readSessionBytes,
    log,
    id: () => `session-${++id}`,
    now: () => clock,
    onSnapshot: (s) => {
      pushes.push(s);
    },
    save,
    setInterval: (fn, ms) => {
      expect(ms).toBe(250);
      tick = fn;
      return 1;
    },
    clearInterval: vi.fn(),
  });
  return {
    session,
    pushes,
    save,
    log,
    tick: () => tick(),
    clock: (at: number) => {
      clock = at;
    },
  };
};
describe("real file tails and session boundaries", () => {
  it("tails partial UTF-8/JSON once, across both streams and file rotations", async () => {
    const folder = dir();
    const file = join(folder, "activity-events-one.jsonl");
    const raw = Buffer.from(fame(110).replace("Member", "Гравець"));
    const split = raw.indexOf(Buffer.from("Г")) + 1;
    writeFileSync(file, raw.subarray(0, split));
    const h = tracker(folder);
    await h.session.poll();
    expect(h.session.snapshot().events).toBe(0);
    writeFileSync(file, raw);
    writeFileSync(join(folder, "activity-events-two.jsonl"), fame(120, 102));
    writeFileSync(
      join(folder, "loot-events-one.txt"),
      "timestamp_utc;header\n2026-09-21T11:00:00.000Z;;;Other;T6_HIDE;Robust Hide;2;;;Chest;Europe\n",
    );
    await h.session.poll();
    await h.session.poll();
    expect(h.session.snapshot().activityLines).toBe(2);
    expect(h.session.snapshot().lootLines).toBe(1);
    expect(h.session.snapshot().totals.fame).toBe(203);
    expect(h.session.snapshot().character).toBe("Member");
    expect(h.session.snapshot().files).toHaveLength(3);
    await h.session.stop();
  });
  it("New session saves the old range, continues the same file and never rereads a pickup", async () => {
    const folder = dir();
    const file = join(folder, "activity-events-one.jsonl");
    writeFileSync(file, fame(110));
    const h = tracker(folder);
    await h.session.poll();
    h.clock(200);
    await h.session.newSession();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.session.snapshot().totals.fame).toBeNull();
    writeFileSync(file, fame(110) + fame(210));
    await h.session.poll();
    expect(h.session.snapshot().totals.fame).toBe(101);
    expect(h.session.snapshot().files[0]).toMatchObject({
      path: file,
      fromLine: 2,
      toLine: 2,
      fromByte: Buffer.byteLength(fame(110)),
      toByte: Buffer.byteLength(fame(110) + fame(210)),
    });
    await h.session.stop();
    await h.session.stop();
    expect(h.save).toHaveBeenCalledTimes(2);
    const summaries = ["session-1", "session-2"].map(
      (id) => JSON.parse(readFileSync(join(folder, "sessions", id, "session.json"), "utf8")) as TSession,
    );
    expect(summaries[0]?.files[0]?.toLine).toBe(1);
    expect(summaries[1]?.files[0]?.fromLine).toBe(2);
    expect(summaries.every((s) => s.endedAt != null)).toBe(true);
  });
  it("preserves counters when saving fails", async () => {
    const folder = dir();
    writeFileSync(join(folder, "activity-events-one.jsonl"), fame(110));
    const h = tracker(folder);
    await h.session.poll();
    h.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(h.session.newSession()).rejects.toThrow("disk full");
    expect(h.session.snapshot().totals.fame).toBe(101);
    await h.session.newSession();
    expect(h.session.snapshot().events).toBe(0);
    await h.session.stop();
  });
  it("sorts an entire multi-chunk backlog before newer files and keeps the whole physical range", async () => {
    const folder = dir();
    const zone = (at: number, id: string) =>
      JSON.stringify({ v: 1, t: "zone", at, char: "Member", zone: id, items: "none" }) + "\n";
    const older =
      zone(100, "older") + Array.from({ length: 4000 }, (_, i) => fame(101 + i)).join("") + zone(5000, "second");
    const newer = zone(10_000, "third");
    writeFileSync(join(folder, "activity-events-one.jsonl"), older);
    writeFileSync(join(folder, "activity-events-two.jsonl"), newer);
    const h = tracker(folder);
    await h.session.poll();
    expect(h.session.snapshot().currentZone).toBe("third");
    expect(h.session.snapshot().totals.fame).toBe(404_000);
    expect(h.session.snapshot().zones.older?.ms).toBe(4900);
    expect(h.session.snapshot().zones.second?.ms).toBe(5000);
    expect(h.session.snapshot().files[0]).toMatchObject({
      fromLine: 1,
      toLine: 4002,
      fromByte: 0,
      toByte: Buffer.byteLength(older),
    });
    await h.session.stop();
  });
  it("records byte ranges at existing EOF when a new engine run appends to the same filename", async () => {
    const file = "activity-events-same-second.jsonl";
    const before = fame(110);
    const after = fame(120);
    const rows: unknown[] = [];
    const tail = createSessionTail({
      initialOffsets: new Map([[file, before.length]]),
      list: async () => [{ path: file, size: before.length + after.length }],
      read: async (_path, offset, length) => (before + after).slice(offset, offset + length),
      onLines: (lines) => {
        rows.push(...lines);
      },
      log: vi.fn(),
    });
    await tail.poll();
    await tail.poll();
    expect(rows).toEqual([
      expect.objectContaining({
        line: 1,
        originByte: before.length,
        fromByte: before.length,
        toByte: before.length + after.length,
        event: expect.objectContaining({ at: 120 }),
      }),
    ]);
  });
  it("keeps the entire physical byte range when timestamps run backwards", async () => {
    const folder = dir();
    const file = join(folder, "activity-events-one.jsonl");
    const raw = fame(200) + fame(100);
    writeFileSync(file, raw);
    const h = tracker(folder);
    await h.session.poll();
    expect(h.session.snapshot().files[0]).toMatchObject({
      fromLine: 1,
      toLine: 2,
      fromByte: 0,
      toByte: Buffer.byteLength(raw),
    });
    await h.session.stop();
  });
  it("keeps the current zone and audit baseline across New session and resets elapsed time", async () => {
    const folder = dir();
    const file = join(folder, "activity-events-one.jsonl");
    const zone = (at: number, total: number) =>
      JSON.stringify({ v: 1, t: "zone", at, char: "Member", zone: "1354", items: "live", fame_total: total }) + "\n";
    const before = zone(110, 1000) + fame(120);
    writeFileSync(file, before);
    const h = tracker(folder);
    await h.session.poll();
    h.clock(200);
    await h.session.newSession();
    expect(h.session.snapshot().currentZone).toBe("1354");
    expect(h.session.snapshot().zoneSince).toBe(200);
    expect(h.session.snapshot().zones["1354"]?.ms).toBe(0);
    writeFileSync(file, before + fame(210) + zone(220, 1202));
    await h.session.poll();
    expect(h.session.snapshot().totals.fame).toBe(101);
    expect(Object.values(h.session.snapshot().audits)[0]).toMatchObject({ spans: 1, mismatches: 0 });
    h.clock(300);
    await h.session.stop();
    expect(h.session.snapshot().zones["1354"]?.ms).toBe(100);
  });
  it("refuses malformed complete lines but does not count them as events", async () => {
    const folder = dir();
    writeFileSync(join(folder, "activity-events-one.jsonl"), "{}\n" + fame(110));
    const h = tracker(folder);
    await h.session.poll();
    expect(h.session.snapshot().refused).toBe(1);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining(":1"));
    expect(h.session.snapshot().activityLines).toBe(1);
    await h.session.stop();
  });
  it("closes the rendered session even when Stop cannot write its summary", async () => {
    const folder = dir();
    writeFileSync(join(folder, "activity-events-one.jsonl"), fame(110));
    const h = tracker(folder);
    await h.session.poll();
    h.clock(200);
    h.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(h.session.stop()).rejects.toThrow("disk full");
    expect(h.session.snapshot().endedAt).toBe(200);
    expect(h.pushes.at(-1)?.totals.fame).toBe(101);
    expect(h.pushes.at(-1)?.endedAt).toBe(200);
  });
  it("still drains and saves Stop when an overlapping New session save fails", async () => {
    const folder = dir();
    writeFileSync(join(folder, "activity-events-one.jsonl"), fame(110));
    const h = tracker(folder);
    h.save.mockRejectedValueOnce(new Error("disk full"));
    const changing = h.session.newSession();
    const stopping = h.session.stop();
    await expect(changing).rejects.toThrow("disk full");
    await stopping;
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.session.snapshot().endedAt).not.toBeNull();
    expect(h.session.snapshot().totals.fame).toBe(101);
  });
  it("coalesces polls, limits each byte read, and handles a truncated file without double counting", async () => {
    let release: (s: string) => void = () => {};
    let size = fame(110).length;
    const onLines = vi.fn();
    const read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const tail = createSessionTail({
      list: () => Promise.resolve([{ path: "activity-events-one.jsonl", size }]),
      read,
      onLines,
      log: vi.fn(),
    });
    const first = tail.poll();
    expect(tail.poll()).toBe(first);
    await Promise.resolve();
    release(fame(110));
    await first;
    expect(read).toHaveBeenCalledTimes(1);
    expect(onLines).toHaveBeenCalledTimes(1);
    size = 0;
    await tail.poll();
    expect(onLines).toHaveBeenCalledTimes(1);
  });
});
