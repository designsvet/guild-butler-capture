import { describe, expect, it } from "vitest";

import {
  countDataLines,
  createLogFileTracker,
  isLootLogName,
  pickNewestLog,
  type TLogCandidate,
} from "../src/main/logFileTracker.js";
import { HEADER, buildLootLine } from "../tools/mock-engine.cjs";

describe("log file tracker — pure helpers", () => {
  it("counts data lines: header and blanks excluded, CRLF tolerated", () => {
    const text = `${HEADER}\r\n${buildLootLine(1_755_600_000_000, 0)}\r\n\r\n${buildLootLine(1_755_600_001_000, 1)}\n`;
    expect(countDataLines(text)).toBe(2);
    expect(countDataLines("")).toBe(0);
    expect(countDataLines(`${HEADER}\n`)).toBe(0);
  });

  it("recognises the engine's file names and nothing else", () => {
    expect(isLootLogName("loot-events-2026-08-19T10-00-00-000Z.txt")).toBe(true);
    expect(isLootLogName("loot-events-x.TXT")).toBe(true);
    expect(isLootLogName("notes.txt")).toBe(false);
    expect(isLootLogName("loot-events-x.txt.bak")).toBe(false);
  });

  it("picks the newest candidate by mtime", () => {
    const files: TLogCandidate[] = [
      { path: "/a/loot-events-1.txt", mtimeMs: 100 },
      { path: "/b/loot-events-2.txt", mtimeMs: 300 },
      { path: "/a/loot-events-3.txt", mtimeMs: 200 },
    ];
    expect(pickNewestLog(files)?.path).toBe("/b/loot-events-2.txt");
    expect(pickNewestLog([])).toBeNull();
  });
});

describe("log file tracker — polling", () => {
  it("reports the newest fresh file's data lines, deduplicating unchanged reads", async () => {
    const files = new Map<string, { mtimeMs: number; text: string }>();
    const updates: { file: string; lines: number }[] = [];
    let tick: (() => void) | null = null;
    const sessionStart = 1_755_600_000_000;

    const tracker = createLogFileTracker({
      dirs: ["/engine", "/missing-dir"],
      sinceMs: sessionStart,
      listDir: (dir) => {
        if (dir === "/missing-dir") {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve([...files.entries()].map(([path, f]) => ({ path, mtimeMs: f.mtimeMs })));
      },
      readFile: (path) => {
        const f = files.get(path);
        return f == null ? Promise.reject(new Error("ENOENT")) : Promise.resolve(f.text);
      },
      onUpdate: (file, lines) => updates.push({ file, lines }),
      setInterval: (fn) => {
        tick = fn;
        return fn;
      },
      clearInterval: () => {
        tick = null;
      },
    });

    // nothing on disk yet
    await tracker.pollNow();
    expect(updates).toEqual([]);

    // a stale file from an earlier session (beyond the 5s mtime slack) is ignored…
    files.set("/engine/loot-events-old.txt", { mtimeMs: sessionStart - 60_000, text: `${HEADER}\nrow\n` });
    await tracker.pollNow();
    expect(updates).toEqual([]);

    // …a fresh one is reported, once per change
    files.set("/engine/loot-events-new.txt", {
      mtimeMs: sessionStart + 1000,
      text: `${HEADER}\n${buildLootLine(sessionStart, 0)}\n`,
    });
    await tracker.pollNow();
    await tracker.pollNow();
    expect(updates).toEqual([{ file: "/engine/loot-events-new.txt", lines: 1 }]);

    files.set("/engine/loot-events-new.txt", {
      mtimeMs: sessionStart + 2000,
      text: `${HEADER}\n${buildLootLine(sessionStart, 0)}\n${buildLootLine(sessionStart + 1000, 1)}\n`,
    });
    await tracker.pollNow();
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({ file: "/engine/loot-events-new.txt", lines: 2 });

    tracker.stop();
    expect(tick).toBeNull();
  });
});
