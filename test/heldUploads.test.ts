import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createHeldStore, heldUploadsFilePath, loadHeldRanges, saveHeldRanges } from "../src/main/heldUploads.js";
import { settingsFilePath } from "../src/main/settings.js";
import {
  heldRangeFor,
  heldRangeOn,
  parseHeldRanges,
  sendableLines,
  type THeldRange,
} from "../src/main/uploadPlan.js";

/**
 * The held lines' record (src/main/heldUploads.ts; the rules are src/main/uploadPlan.ts): which lines
 * of which file must never reach the guild, because the decoder was broken when they were written.
 * It has to outlive the app — the update that fixes the decoder is an app restart — and it errs
 * toward holding: a damaged record holds more, never less.
 */

const userData = (): string => mkdtempSync(join(tmpdir(), "gbc-held-store-"));

const A: THeldRange = { file: "/logs/loot-events-2026-10-01-14-02-11.txt", from: 120, run: "run-1", at: 1_759_300_000_000 };
const B: THeldRange = { file: "/logs/loot-events-2026-10-01-15-40-00.txt", from: 0, run: null, at: 1_759_305_000_000 };

describe("the held ranges: the rules", () => {
  it("a hold starts where the uploader stands in the file, or at the file's first line", () => {
    const cursor = { run: "run-7", file: A.file, sentThrough: 120 };
    expect(heldRangeFor(cursor, A.file, 5)).toEqual({ file: A.file, from: 120, run: "run-7", at: 5 });
    // a new file the uploader has sent nothing of: all of it, under no run
    expect(heldRangeFor(cursor, B.file, 5)).toEqual({ file: B.file, from: 0, run: null, at: 5 });
    expect(heldRangeFor(null, B.file, 5)).toEqual({ file: B.file, from: 0, run: null, at: 5 });
  });

  it("only the lines before a file's hold may ever be sent; other files are untouched", () => {
    expect(sendableLines([A], A.file, 500)).toBe(120);
    expect(sendableLines([A], A.file, 80)).toBe(80);
    expect(sendableLines([A, B], B.file, 40)).toBe(0);
    expect(sendableLines([A, B], "/logs/other.txt", 40)).toBe(40);
  });

  it("a file held twice is held from the earlier start", () => {
    expect(heldRangeOn([{ ...A, from: 300 }, A], A.file)?.from).toBe(120);
    expect(heldRangeOn([A], B.file)).toBeNull();
  });

  it("reads a damaged record toward holding more, never less", () => {
    expect(
      parseHeldRanges({
        held: [
          A,
          // no readable start: the whole file is held
          { file: B.file, from: -3, run: 7, at: "yesterday" },
          { file: "/logs/c.txt", from: 1.5 },
          // nothing to name: holds nothing
          { from: 10 },
          { file: "", from: 10 },
          null,
          "a.txt",
        ],
      }),
    ).toEqual([A, { file: B.file, from: 0, run: null, at: 0 }, { file: "/logs/c.txt", from: 0, run: null, at: 0 }]);
    expect(parseHeldRanges(null)).toEqual([]);
    expect(parseHeldRanges({ held: "x" })).toEqual([]);
  });
});

describe("the held ranges: the file", () => {
  it("is held-uploads.json in the data folder, not settings.json", () => {
    const dir = userData();
    expect(heldUploadsFilePath(dir)).toBe(join(dir, "held-uploads.json"));
    expect(heldUploadsFilePath(dir)).not.toBe(settingsFilePath(dir));
  });

  it("round-trips, and a new store — the next app — reads what the last one wrote", () => {
    const file = heldUploadsFilePath(userData());
    const first = createHeldStore(file, () => undefined);
    expect(first.list()).toEqual([]);
    expect(first.add(A)).toBe(true);
    expect(first.add(B)).toBe(true);
    expect(createHeldStore(file, () => undefined).list()).toEqual([A, B]);
    expect(loadHeldRanges(file)).toEqual({ ranges: [A, B], damaged: false });
  });

  it("no file is no holds, and not damage", () => {
    expect(loadHeldRanges(join(userData(), "held-uploads.json"))).toEqual({ ranges: [], damaged: false });
  });

  it("moves an unreadable record aside rather than write over it, and logs it", () => {
    const dir = userData();
    const file = heldUploadsFilePath(dir);
    writeFileSync(file, "{ not json", "utf8");
    const logs: string[] = [];
    const store = createHeldStore(file, (line) => logs.push(line));
    expect(logs.some((l) => l.includes("could not be read"))).toBe(true);
    expect(store.add(A)).toBe(true);
    const aside = readdirSync(dir).filter((name) => name.startsWith("held-uploads.json.damaged-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0] ?? ""), "utf8")).toBe("{ not json");
    expect(loadHeldRanges(file).ranges).toEqual([A]);
  });

  it("holds in memory when the disk refuses, and says the write failed", () => {
    const dir = userData();
    // a directory where the file should be: every write fails
    const file = heldUploadsFilePath(dir);
    mkdirSync(file);
    const logs: string[] = [];
    const store = createHeldStore(file, (line) => logs.push(line));
    expect(store.add(A)).toBe(false);
    expect(store.list()).toEqual([A]);
    expect(logs.some((l) => l.includes("for this session only"))).toBe(true);
    expect(saveHeldRanges(file, [A])).toBe(false);
    // no stray temp file left behind
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
