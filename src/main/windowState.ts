/**
 * The v5 window's remembered size and place, in a file of its own: `window-state.json`, beside
 * `settings.json` in the app's data folder and never inside it. settings.json holds the pairing
 * token and is read whole and written back whole; a window that saves on every move would turn
 * each drag into another rewrite of the one file whose loss un-pairs the computer. Here the worst
 * a bad write can cost is the window's place.
 *
 * Written to a temp file and renamed over the old one, so a crash mid-write leaves the previous
 * state rather than half a file. The keeper below decides when to write; the shapes and the
 * placement rules are windowBounds.ts.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseWindowState, type TWindowState } from "./windowBounds.js";

export const windowStateFilePath = (userDataDir: string): string => {
  return join(userDataDir, "window-state.json");
};

/** The stored state, or nothing: no file, unreadable JSON and a bad shape all mean "first open". */
export const loadWindowState = (file: string): TWindowState | null => {
  try {
    return parseWindowState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
};

/**
 * Write the state: temp file, then rename. Never throws — it runs from the window's close
 * handler, where an exception would stop the window closing — and says whether it worked, so the
 * caller can log a failure and the keeper can try again on the next change.
 */
export const saveWindowState = (file: string, state: TWindowState): boolean => {
  // Unique per process: two app instances (dev has no single-instance lock) must not interleave
  // writes into the same temp file.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

export type TWindowStateKeeper = {
  /** The window moved or resized: write once it has been still for the delay. */
  schedule: () => void;
  /** Write now (the window is closing), dropping any write still waiting. */
  flush: () => void;
  /** Drop a waiting write without writing (the window is gone). */
  dispose: () => void;
};

/**
 * When to write. A drag fires `move` dozens of times a second, so writes wait until the window
 * has been still for `delayMs`; closing writes at once. A state equal to the last one written is
 * not written again, and a failed write is not remembered as written, so the next change retries.
 * `read` returns null once the window is destroyed — nothing is written then.
 */
export const createWindowStateKeeper = (deps: {
  read: () => TWindowState | null;
  write: (state: TWindowState) => boolean;
  delayMs: number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}): TWindowStateKeeper => {
  let pending: unknown = null;
  let lastWritten: string | null = null;

  const cancel = (): void => {
    if (pending != null) {
      deps.clearTimer(pending);
      pending = null;
    }
  };

  const writeNow = (): void => {
    cancel();
    const state = deps.read();
    if (state == null) {
      return;
    }
    const json = JSON.stringify(state);
    if (json === lastWritten) {
      return;
    }
    if (deps.write(state)) {
      lastWritten = json;
    }
  };

  return {
    schedule: () => {
      cancel();
      pending = deps.setTimer(() => {
        pending = null;
        writeNow();
      }, deps.delayMs);
    },
    flush: writeNow,
    dispose: cancel,
  };
};
