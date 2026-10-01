import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadSettings, saveSettings, settingsFilePath, type TSettings } from "../src/main/settings.js";
import type { TWindowState } from "../src/main/windowBounds.js";
import {
  createWindowStateKeeper,
  loadWindowState,
  saveWindowState,
  windowStateFilePath,
} from "../src/main/windowState.js";

const userData = (): string => mkdtempSync(join(tmpdir(), "gbc-window-"));

const STATE: TWindowState = { bounds: { x: 120, y: 90, width: 1400, height: 900 }, maximized: false };

/** A settings.json as a paired member has it: the token is the one thing in it worth losing. */
const PAIRED: TSettings = {
  pairing: {
    tokenEnc: "c2VjcmV0LXRva2Vu",
    guildId: "123456789012345678",
    userId: "876543210987654321",
    deviceId: 7,
    deviceName: "MacBook",
    pairedAt: 1_759_300_000_000,
  },
  theme: "parchment",
  shell: "v5",
};

/** The file's bytes and its modification time to the nanosecond — a rewrite of the same bytes still shows. */
const fingerprint = (file: string): { bytes: string; mtimeNs: bigint } => ({
  bytes: readFileSync(file, "utf8"),
  mtimeNs: statSync(file, { bigint: true }).mtimeNs,
});

describe("windowState: its own file", () => {
  it("is window-state.json in the data folder, not settings.json", () => {
    const dir = userData();
    expect(windowStateFilePath(dir)).toBe(join(dir, "window-state.json"));
    expect(windowStateFilePath(dir)).not.toBe(settingsFilePath(dir));
  });

  it("round-trips a saved state", () => {
    const file = windowStateFilePath(userData());
    expect(saveWindowState(file, STATE)).toBe(true);
    expect(loadWindowState(file)).toEqual(STATE);
    const maximized = { ...STATE, maximized: true };
    expect(saveWindowState(file, maximized)).toBe(true);
    expect(loadWindowState(file)).toEqual(maximized);
  });

  it("reads no file, broken JSON or a bad shape as nothing (the window then opens at the first-open size)", () => {
    const dir = userData();
    const file = windowStateFilePath(dir);
    expect(loadWindowState(file)).toBeNull();
    writeFileSync(file, "{ not json", "utf8");
    expect(loadWindowState(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ bounds: { x: 0, y: 0, width: "wide", height: 800 } }), "utf8");
    expect(loadWindowState(file)).toBeNull();
  });

  it("creates the data folder when it is not there yet", () => {
    const file = windowStateFilePath(join(userData(), "nested", "folder"));
    expect(saveWindowState(file, STATE)).toBe(true);
    expect(loadWindowState(file)).toEqual(STATE);
  });
});

describe("windowState: a write never touches settings.json", () => {
  it("saving the window's place, again and again, leaves settings.json byte-identical and unwritten", () => {
    const dir = userData();
    const settingsFile = settingsFilePath(dir);
    saveSettings(settingsFile, PAIRED);
    const before = fingerprint(settingsFile);

    const file = windowStateFilePath(dir);
    for (let i = 0; i < 5; i += 1) {
      expect(saveWindowState(file, { bounds: { x: 100 + i, y: 80, width: 1280 + i, height: 800 }, maximized: i % 2 === 0 })).toBe(
        true,
      );
    }

    expect(fingerprint(settingsFile)).toEqual(before);
    expect(loadSettings(settingsFile)).toEqual(PAIRED);
    // and nothing else appeared: no temp file left behind, no second copy anywhere
    expect(readdirSync(dir).sort()).toEqual(["settings.json", "window-state.json"]);
  });

  it("the keeper's whole path — the one index.ts wires — writes only window-state.json", () => {
    const dir = userData();
    const settingsFile = settingsFilePath(dir);
    saveSettings(settingsFile, PAIRED);
    const before = fingerprint(settingsFile);

    const timers: Array<() => void> = [];
    let current: TWindowState = STATE;
    const keeper = createWindowStateKeeper({
      read: () => current,
      write: (next) => saveWindowState(windowStateFilePath(dir), next),
      delayMs: 500,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => undefined,
    });
    keeper.schedule();
    timers.shift()?.();
    current = { bounds: { ...STATE.bounds, x: 400 }, maximized: true };
    keeper.flush();

    expect(fingerprint(settingsFile)).toEqual(before);
    expect(loadWindowState(windowStateFilePath(dir))).toEqual(current);
    expect(readdirSync(dir).sort()).toEqual(["settings.json", "window-state.json"]);
  });
});

describe("windowState: temp file, then rename", () => {
  it("a write that fails part-way leaves the previous state whole", () => {
    const dir = userData();
    const file = windowStateFilePath(dir);
    expect(saveWindowState(file, STATE)).toBe(true);
    // Block the temp file's path with a folder: the write cannot happen, the rename never runs.
    mkdirSync(`${file}.${process.pid}.tmp`);
    expect(saveWindowState(file, { ...STATE, maximized: true })).toBe(false);
    expect(loadWindowState(file)).toEqual(STATE);
  });

  it("a rename that fails reports it, and does not leave its temp file behind", () => {
    const dir = userData();
    const file = windowStateFilePath(dir);
    // A folder where the file should be: the temp write succeeds, the rename over it cannot.
    mkdirSync(file);
    writeFileSync(join(file, "keep"), "x", "utf8");
    expect(saveWindowState(file, STATE)).toBe(false);
    expect(readdirSync(dir)).toEqual(["window-state.json"]);
  });
});

describe("windowState: the keeper decides when to write", () => {
  const harness = (
    initial: TWindowState | null = STATE,
  ): {
    keeper: ReturnType<typeof createWindowStateKeeper>;
    writes: TWindowState[];
    pending: () => number;
    fire: () => void;
    setState: (next: TWindowState | null) => void;
    failWrites: (fail: boolean) => void;
  } => {
    let state = initial;
    let fail = false;
    let nextId = 1;
    const timers = new Map<number, () => void>();
    const writes: TWindowState[] = [];
    const keeper = createWindowStateKeeper({
      read: () => state,
      write: (next) => {
        if (fail) {
          return false;
        }
        writes.push(next);
        return true;
      },
      delayMs: 500,
      setTimer: (fn, ms) => {
        expect(ms).toBe(500);
        const id = nextId;
        nextId += 1;
        timers.set(id, fn);
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id as number);
      },
    });
    return {
      keeper,
      writes,
      pending: () => timers.size,
      fire: () => {
        const due = [...timers.values()];
        timers.clear();
        for (const fn of due) {
          fn();
        }
      },
      setState: (next) => {
        state = next;
      },
      failWrites: (f) => {
        fail = f;
      },
    };
  };

  it("a drag's many moves make one write, once the window is still", () => {
    const h = harness();
    for (let i = 0; i < 30; i += 1) {
      h.setState({ ...STATE, bounds: { ...STATE.bounds, x: i } });
      h.keeper.schedule();
    }
    expect(h.writes).toEqual([]);
    expect(h.pending()).toBe(1);
    h.fire();
    expect(h.writes).toEqual([{ ...STATE, bounds: { ...STATE.bounds, x: 29 } }]);
  });

  it("closing writes at once and drops the write still waiting", () => {
    const h = harness();
    h.keeper.schedule();
    h.keeper.flush();
    expect(h.writes).toEqual([STATE]);
    expect(h.pending()).toBe(0);
  });

  it("closing writes even when nothing moved since the window opened", () => {
    const h = harness();
    h.keeper.flush();
    expect(h.writes).toEqual([STATE]);
  });

  it("does not write the same state twice", () => {
    const h = harness();
    h.keeper.schedule();
    h.fire();
    h.keeper.schedule();
    h.fire();
    h.keeper.flush();
    expect(h.writes).toEqual([STATE]);
  });

  it("a failed write is not remembered as written: the next chance tries again", () => {
    const h = harness();
    h.failWrites(true);
    h.keeper.schedule();
    h.fire();
    expect(h.writes).toEqual([]);
    h.failWrites(false);
    h.keeper.flush();
    expect(h.writes).toEqual([STATE]);
  });

  it("a window that cannot say where it is (minimized) leaves the place it last said to be written", () => {
    const maximized: TWindowState = { ...STATE, maximized: true };
    const h = harness(maximized);
    // maximized, then minimized before the write was due: the timer still writes the maximized place
    h.keeper.schedule();
    h.setState(null);
    h.fire();
    expect(h.writes).toEqual([maximized]);
    // and quitting from the Dock or the taskbar writes nothing over it
    h.keeper.flush();
    expect(h.writes).toEqual([maximized]);
  });

  it("closing while minimized writes the place the window had on screen", () => {
    const h = harness();
    h.keeper.schedule();
    h.fire();
    const moved: TWindowState = { bounds: { ...STATE.bounds, x: 640 }, maximized: true };
    h.setState(moved);
    h.keeper.schedule();
    h.setState(null);
    h.keeper.flush();
    expect(h.writes).toEqual([STATE, moved]);
    expect(h.pending()).toBe(0);
  });

  it("writes nothing when the window never said where it was", () => {
    const h = harness(null);
    h.keeper.schedule();
    h.fire();
    h.keeper.flush();
    expect(h.writes).toEqual([]);
  });

  it("dispose drops a waiting write without writing", () => {
    const h = harness();
    h.keeper.schedule();
    h.keeper.dispose();
    expect(h.pending()).toBe(0);
    expect(h.writes).toEqual([]);
  });
});

describe("windowState: index.ts writes the place before the close handler can return", () => {
  // On a Mac the window's own close handler returns at once (closing is not quitting there); the
  // close-time write must already have run by then, or the next window opens from a stale file.
  const INDEX = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");
  const createWindow = INDEX.slice(INDEX.indexOf("const createWindow = "));

  it("rememberPlace — whose close listener flushes — is wired before win.on(\"close\")", () => {
    expect(INDEX).toMatch(/w\.on\("close", keeper\.flush\);/);
    const remember = createWindow.indexOf("rememberPlace(win);");
    const closeHandler = createWindow.indexOf('win.on("close"');
    expect(remember).toBeGreaterThan(-1);
    expect(closeHandler).toBeGreaterThan(remember);
  });
});
