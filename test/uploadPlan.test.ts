import { describe, expect, it } from "vitest";

import {
  advanceCursor,
  clampLine,
  ENewRunReason,
  MAX_BATCH_LINES,
  MAX_LINE_LENGTH,
  newRunReason,
  nextBatch,
  splitLines,
  type TUploadCursor,
} from "../src/main/uploadPlan.js";

/**
 * The offset arithmetic the server's idempotence rests on. Every failure here
 * is silent in production — lines swallowed as duplicates, or an upload wedged
 * forever — so the boundaries are pinned rather than discovered.
 */

const cursor = (over: Partial<TUploadCursor> = {}): TUploadCursor => ({
  run: "run-1",
  file: "/logs/loot-events-2026-08-22.txt",
  sentThrough: 0,
  ...over,
});

describe("splitLines", () => {
  it("drops the trailing newline the engine always leaves", () => {
    // Counting it would send an empty string whose index the next append wants.
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n\n")).toEqual([]);
  });

  it("keeps blank lines that are not at the end", () => {
    expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });
});

describe("newRunReason", () => {
  it("starts a run on the first file", () => {
    expect(newRunReason(null, "/logs/a.txt", 10)).toBe(ENewRunReason.FirstFile);
  });

  it("starts a NEW run when the engine rolls the file", () => {
    // The one that loses data if missed: the second file's line numbers start
    // at 0 again, so continuing the run would send indices the first file
    // already used and the server would swallow them all as duplicates.
    expect(newRunReason(cursor({ sentThrough: 500 }), "/logs/b.txt", 3)).toBe(ENewRunReason.FileChanged);
  });

  it("starts a new run when the file is shorter than what we sent", () => {
    expect(newRunReason(cursor({ sentThrough: 100 }), cursor().file, 4)).toBe(ENewRunReason.FileShrank);
  });

  it("continues the run while the same file only grows", () => {
    expect(newRunReason(cursor({ sentThrough: 10 }), cursor().file, 10)).toBeNull();
    expect(newRunReason(cursor({ sentThrough: 10 }), cursor().file, 99)).toBeNull();
  });
});

describe("nextBatch", () => {
  const lines = Array.from({ length: 1200 }, (_, i) => `line-${i}`);

  it("sends from the cursor, capped at the server's batch limit", () => {
    const first = nextBatch(0, lines);
    expect(first?.from).toBe(0);
    expect(first?.lines).toHaveLength(MAX_BATCH_LINES);
    expect(first?.lines[0]).toBe("line-0");
  });

  it("resumes exactly where it left off", () => {
    const second = nextBatch(MAX_BATCH_LINES, lines);
    expect(second?.from).toBe(MAX_BATCH_LINES);
    expect(second?.lines[0]).toBe(`line-${MAX_BATCH_LINES}`);
  });

  it("returns null when the server is already up to date", () => {
    expect(nextBatch(lines.length, lines)).toBeNull();
    // …and if somehow ahead, still null rather than a negative slice.
    expect(nextBatch(lines.length + 10, lines)).toBeNull();
  });

  it("includes the header row — the server counts what was SENT", () => {
    const withHeader = ["timestamp_utc;looted_by__alliance", "real;line"];
    const batch = nextBatch(0, withHeader);
    expect(batch?.lines).toHaveLength(2);
    expect(batch?.from).toBe(0);
  });
});

describe("clampLine", () => {
  it("leaves a normal loot line alone", () => {
    const line = "2026-08-22T20:15:03.123Z;ALLY;VITRYLA;Borys;T8_BAG;Elder's Bag;1;;Foes;DeadGuy";
    expect(clampLine(line)).toBe(line);
  });

  it("truncates instead of dropping, so one corrupt line cannot wedge uploads forever", () => {
    // Dropping would shift every later index and break the server's key;
    // leaving it would make the server refuse the whole batch, which this
    // client would then retry identically until the end of time.
    const huge = "x".repeat(MAX_LINE_LENGTH + 500);
    expect(clampLine(huge)).toHaveLength(MAX_LINE_LENGTH);
  });

  it("keeps a line of exactly the cap", () => {
    expect(clampLine("y".repeat(MAX_LINE_LENGTH))).toHaveLength(MAX_LINE_LENGTH);
  });
});

describe("advanceCursor", () => {
  const batch = { from: 100, lines: ["a", "b", "c"] };

  it("trusts the server's nextFrom", () => {
    expect(advanceCursor(100, batch, 103)).toBe(103);
  });

  it("falls back to local arithmetic when the reply is missing or absurd", () => {
    expect(advanceCursor(100, batch, null)).toBe(103);
    expect(advanceCursor(100, batch, "103")).toBe(103);
    expect(advanceCursor(100, batch, 1.5)).toBe(103);
  });

  it("NEVER moves backwards, whatever the server says", () => {
    // A stale or malformed reply must not make the client re-send a batch that
    // was already accepted — that is how a retry loop is born.
    expect(advanceCursor(500, batch, 10)).toBe(500);
    expect(advanceCursor(500, batch, -1)).toBe(500);
  });

  it("takes the server's word when it is AHEAD of us", () => {
    // Another device, or an earlier run of this one, got further. Believe it.
    expect(advanceCursor(100, batch, 900)).toBe(900);
  });
});
