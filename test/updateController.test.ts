import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  CHECK_INTERVAL_MS,
  createUpdateController,
  FIRST_CHECK_DELAY_MS,
  updaterEnabled,
  type TAutoUpdaterLike,
  type TUpdateDeps,
} from "../src/main/updateController.js";
import { ERestartRefusal, EUpdatePhase } from "../src/shared/captureTypes.js";
import { IPC } from "../src/shared/ipc.js";

/**
 * The auto-update lifecycle, driven with no Electron and no network. The one
 * rule under test throughout: updating never interferes with capturing —
 * install-on-quit by default, and Restart-now refused while the engine runs.
 */

type TStubUpdater = TAutoUpdaterLike & {
  emit: (event: string, payload?: unknown) => void;
  checkCalls: number;
  rejectNext: Error | null;
  installed: boolean;
};

const stubUpdater = (): TStubUpdater => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const stub: TStubUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkCalls: 0,
    rejectNext: null,
    installed: false,
    on: (event, listener) => {
      const list = listeners.get(event) ?? [];
      list.push(listener as (...args: unknown[]) => void);
      listeners.set(event, list);
      return stub;
    },
    checkForUpdates: () => {
      stub.checkCalls += 1;
      if (stub.rejectNext != null) {
        const err = stub.rejectNext;
        stub.rejectNext = null;
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    },
    quitAndInstall: () => {
      stub.installed = true;
    },
    emit: (event, payload) => {
      for (const l of listeners.get(event) ?? []) {
        l(payload);
      }
    },
  };
  return stub;
};

type THarness = {
  updater: TStubUpdater;
  controller: ReturnType<typeof createUpdateController>;
  statuses: { phase: EUpdatePhase; version: string | null; percent: number | null; error: string | null }[];
  pending: { fn: () => void; ms: number }[];
  fireNext: () => void;
  engineRunning: boolean;
};

const harness = (over: Partial<TUpdateDeps> = {}): THarness => {
  const updater = stubUpdater();
  const h = {
    updater,
    statuses: [],
    pending: [],
    engineRunning: false,
  } as unknown as THarness;
  h.fireNext = () => {
    const next = h.pending.shift();
    next?.fn();
  };
  h.controller = createUpdateController({
    updater,
    enabled: true,
    engineRunning: () => h.engineRunning,
    schedule: (fn, ms) => {
      h.pending.push({ fn, ms });
      return () => {
        h.pending = h.pending.filter((p) => p.fn !== fn);
      };
    },
    log: vi.fn(),
    onStatus: (s) => {
      h.statuses.push({ ...s });
    },
    ...over,
  });
  return h;
};

describe("updaterEnabled", () => {
  it("is Windows + packaged only, with an env kill switch", () => {
    expect(updaterEnabled("win32", true, {})).toBe(true);
    // macOS waits on signing (Squirrel.Mac refuses unsigned updates).
    expect(updaterEnabled("darwin", true, {})).toBe(false);
    // A dev build is not installed — nothing to update.
    expect(updaterEnabled("win32", false, {})).toBe(false);
    expect(updaterEnabled("win32", true, { GBC_NO_AUTO_UPDATE: "1" })).toBe(false);
  });
});

describe("createUpdateController", () => {
  it("disabled: reports Off, never wires the updater, never schedules", () => {
    const h = harness({ enabled: false });
    h.controller.start();
    expect(h.controller.status().phase).toBe(EUpdatePhase.Off);
    expect(h.pending).toHaveLength(0);
    h.updater.emit("update-available", { version: "9.9.9" });
    expect(h.controller.status().phase).toBe(EUpdatePhase.Off);
  });

  it("enabled: install-on-quit is the default posture, first check waits out startup", () => {
    const h = harness();
    h.controller.start();
    expect(h.updater.autoDownload).toBe(true);
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
    expect(h.pending[0]?.ms).toBe(FIRST_CHECK_DELAY_MS);
    expect(h.updater.checkCalls).toBe(0);
  });

  it("walks available → progress → ready, keeping the version", async () => {
    const h = harness();
    h.controller.start();
    h.fireNext();
    await Promise.resolve();
    expect(h.updater.checkCalls).toBe(1);
    h.updater.emit("checking-for-update");
    h.updater.emit("update-available", { version: "0.5.0" });
    h.updater.emit("download-progress", { percent: 41.7 });
    h.updater.emit("update-downloaded", { version: "0.5.0" });
    const phases = h.statuses.map((s) => s.phase);
    expect(phases).toContain(EUpdatePhase.Checking);
    expect(phases).toContain(EUpdatePhase.Downloading);
    const during = h.statuses.find((s) => s.percent === 41);
    expect(during?.phase).toBe(EUpdatePhase.Downloading);
    const final = h.controller.status();
    expect(final.phase).toBe(EUpdatePhase.Ready);
    expect(final.version).toBe("0.5.0");
    expect(final.percent).toBeNull();
  });

  it("re-schedules on the steady interval after a check, success or failure", async () => {
    const h = harness();
    h.controller.start();
    h.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.pending[0]?.ms).toBe(CHECK_INTERVAL_MS);
    h.updater.rejectNext = new Error("net down");
    h.fireNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.controller.status().phase).toBe(EUpdatePhase.Error);
    expect(h.controller.status().error).toBe("net down");
    // A failed check still books the next one — quiet retry, never a dead state.
    expect(h.pending[0]?.ms).toBe(CHECK_INTERVAL_MS);
  });

  it("an updater 'error' event is a muted line and a retry, nothing more", () => {
    const h = harness();
    h.controller.start();
    h.updater.emit("error", new Error("HttpError: 503"));
    expect(h.controller.status().phase).toBe(EUpdatePhase.Error);
    expect(h.controller.status().error).toBe("HttpError: 503");
  });

  it("Restart now: refused before ready, refused while the engine runs, installs when idle", () => {
    const h = harness();
    h.controller.start();
    expect(h.controller.restartNow()).toEqual({ ok: false, reason: ERestartRefusal.NotReady });

    h.updater.emit("update-downloaded", { version: "0.5.0" });
    h.engineRunning = true;
    // The one rule: never cut a live capture.
    expect(h.controller.restartNow()).toEqual({ ok: false, reason: ERestartRefusal.Capturing });
    expect(h.updater.installed).toBe(false);

    h.engineRunning = false;
    expect(h.controller.restartNow()).toEqual({ ok: true });
    expect(h.updater.installed).toBe(true);
  });

  it("start() is idempotent — a second call adds no second schedule", () => {
    const h = harness();
    h.controller.start();
    h.controller.start();
    expect(h.pending).toHaveLength(1);
  });
});

describe("IPC channel copies stay in lockstep", () => {
  it("preload's CH mirrors shared IPC exactly", () => {
    // The preload is CommonJS and calls contextBridge at import time, so it
    // cannot be imported here — read it as text instead (the same pinning
    // trick the web bundle uses). Every "key: \"value\"" pair in shared IPC
    // must appear verbatim in the preload's own CH copy; this test failed the
    // day updateChanged existed on one side only.
    const preload = readFileSync(new URL("../src/preload/index.cts", import.meta.url), "utf8");
    for (const [key, value] of Object.entries(IPC)) {
      expect(preload, `${key}: "${value}" missing from preload CH`).toContain(`${key}: "${value}"`);
    }
  });
});
