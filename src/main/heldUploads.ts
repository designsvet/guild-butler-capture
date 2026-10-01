/**
 * The held lines, remembered across app restarts: `held-uploads.json` in the data folder, a file of
 * its own (settings.json holds the pairing token and is rewritten whole; this is written whenever a
 * hold begins). What a range means is src/main/uploadPlan.ts `THeldRange`; why there are any is the
 * held upload (src/main/uploader.ts).
 *
 * Why a file at all: the break, and so the hold, lasts until the app restarts — and the update that
 * fixes the decoder IS an app restart. An uploader that remembered its holds only in memory would
 * meet a held file after the update knowing nothing about it. The engine starts a new file every
 * run, so that should not happen; this is what makes "should not" into "cannot".
 *
 * Written to a temp file and renamed over the old one, so a crash mid-write leaves the previous
 * list rather than half a file. A list that cannot be read is moved aside, never written over: it
 * is the only record of which lines must never reach the guild, and support may need it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseHeldRanges, type THeldRange } from "./uploadPlan.js";

export const heldUploadsFilePath = (userDataDir: string): string => {
  return join(userDataDir, "held-uploads.json");
};

/** The stored ranges; `damaged` when a file is there and could not be read as one. */
export const loadHeldRanges = (file: string): { ranges: THeldRange[]; damaged: boolean } => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ranges: [], damaged: false };
  }
  try {
    const raw: unknown = JSON.parse(text);
    const shaped = typeof raw === "object" && raw != null && Array.isArray((raw as { held?: unknown }).held);
    return { ranges: parseHeldRanges(raw), damaged: !shaped };
  } catch {
    return { ranges: [], damaged: true };
  }
};

/** Temp file, then rename. Never throws — it runs inside an upload pass — and says whether it worked. */
export const saveHeldRanges = (file: string, ranges: readonly THeldRange[]): boolean => {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify({ held: ranges }, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // a stray temp file is harmless; the next save replaces it
    }
    return false;
  }
};

export type THeldStore = {
  list: () => readonly THeldRange[];
  /** Remember a range: at once in memory, then on disk. False when the disk write failed. */
  add: (range: THeldRange) => boolean;
};

export const createHeldStore = (file: string, log: (line: string) => void): THeldStore => {
  const loaded = loadHeldRanges(file);
  let ranges: readonly THeldRange[] = loaded.ranges;
  let damaged = loaded.damaged;
  if (damaged) {
    log(`[upload] ${file} could not be read; it is kept aside on the next hold`);
  }
  return {
    list: () => ranges,
    add: (range) => {
      // In memory first: whatever the disk does, this session never sends the range.
      ranges = [...ranges, range];
      if (damaged && existsSync(file)) {
        try {
          renameSync(file, `${file}.damaged-${Date.now()}`);
        } catch {
          log(`[upload] could not move the unreadable ${file} aside`);
          return false;
        }
      }
      damaged = false;
      const ok = saveHeldRanges(file, ranges);
      if (!ok) {
        log(`[upload] could not write ${file}: the hold stands for this session only`);
      }
      return ok;
    },
  };
};
