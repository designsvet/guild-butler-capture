import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { reduceCaptureSession, type TSessionEvent } from "../src/main/captureSession.js";
import {
  createEngineSupervisor,
  defaultRestartDelayMs,
  type TEngineChild,
  type TEngineSupervisor,
} from "../src/main/engineSupervisor.js";
import { ECaptureStatus, EEngineErrorKind, initialCaptureState, lootLinesOf } from "../src/shared/captureTypes.js";

const MOCK_ENGINE = fileURLToPath(new URL("../tools/mock-engine.cjs", import.meta.url));

// --- scripted-fake harness ---------------------------------------------------

type TFakeChild = TEngineChild & {
  emitStdout: (text: string) => void;
  emitStderr: (text: string) => void;
  emitExit: (code: number | null) => void;
  emitError: (message: string) => void;
  kills: string[];
};

const createFakeChild = (): TFakeChild => {
  const listeners = { stdout: [] as ((c: string) => void)[], stderr: [] as ((c: string) => void)[] };
  let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
  let errorListener: ((err: Error) => void) | null = null;
  const kills: string[] = [];
  return {
    kills,
    pid: 4242,
    stdout: { on: (_ev, fn) => listeners.stdout.push(fn as (c: string) => void) },
    stderr: { on: (_ev, fn) => listeners.stderr.push(fn as (c: string) => void) },
    once: (_ev, fn) => {
      exitListener = fn;
    },
    on: (_ev, fn) => {
      errorListener = fn;
    },
    kill: (signal): boolean => {
      kills.push(signal ?? "SIGTERM");
      return true;
    },
    emitStdout: (text): void => {
      for (const fn of listeners.stdout) {
        fn(text);
      }
    },
    emitStderr: (text): void => {
      for (const fn of listeners.stderr) {
        fn(text);
      }
    },
    emitExit: (code): void => {
      exitListener?.(code, null);
    },
    emitError: (message): void => {
      errorListener?.(new Error(message));
    },
  };
};

type TFakeTimer = { fn: () => void; ms: number; cleared: boolean };

const createHarness = (opts: { spawnQueue?: TFakeChild[]; spawnThrows?: boolean } = {}) => {
  const events: TSessionEvent[] = [];
  const timers: TFakeTimer[] = [];
  const spawned: TFakeChild[] = [];
  let now = 100_000;

  const supervisor = createEngineSupervisor({
    spawn: () => {
      if (opts.spawnThrows === true) {
        throw new Error("spawn ENOENT");
      }
      const child = opts.spawnQueue?.shift() ?? createFakeChild();
      spawned.push(child);
      return child;
    },
    now: () => (now += 10),
    emit: (ev) => events.push(ev),
    setTimer: (fn, ms) => {
      const timer: TFakeTimer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as TFakeTimer).cleared = true;
    },
    resolveLogPath: (name) => `/engine/${name}`,
  });

  const exits = (): Extract<TSessionEvent, { type: "engine-exit" }>[] => {
    return events.filter((e): e is Extract<TSessionEvent, { type: "engine-exit" }> => e.type === "engine-exit");
  };
  return { supervisor, events, timers, spawned, exits, advanceTime: (ms: number) => (now += ms) };
};

afterEach(() => {
  // each test disposes its own supervisor; nothing global to clean
});

describe("engine supervisor — scripted runs", () => {
  it("clean stop: SIGINT, no restart, engine-exit says so", () => {
    const h = createHarness();
    h.supervisor.startSession();
    const child = h.spawned[0]!;
    child.emitStdout("ALBION DETECTED\n");

    h.supervisor.stopSession();
    expect(child.kills).toEqual(["SIGINT"]);
    child.emitExit(0);

    const exit = h.exits()[0]!;
    expect(exit.willRestart).toBe(false);
    expect(exit.fatal).toBeNull();
    // no restart timer left armed (the kill-escalation timer was cleared)
    expect(h.timers.filter((t) => !t.cleared)).toEqual([]);
    h.supervisor.dispose();
  });

  it("kill escalation: a lingering engine gets SIGKILL after the grace", () => {
    const h = createHarness();
    h.supervisor.startSession();
    const child = h.spawned[0]!;
    h.supervisor.stopSession();
    const grace = h.timers.find((t) => !t.cleared)!;
    grace.fn();
    expect(child.kills).toEqual(["SIGINT", "SIGKILL"]);
    h.supervisor.dispose();
  });

  it("a quick crash restarts with growing backoff", () => {
    const h = createHarness();
    h.supervisor.startSession();
    h.spawned[0]!.emitExit(1);

    let exit = h.exits()[0]!;
    expect(exit.willRestart).toBe(true);
    expect(exit.attempt).toBe(1);
    expect(exit.delayMs).toBe(defaultRestartDelayMs(1));

    const restart = h.timers.find((t) => !t.cleared)!;
    restart.fn();
    expect(h.spawned).toHaveLength(2);
    h.spawned[1]!.emitExit(1);

    exit = h.exits()[1]!;
    expect(exit.attempt).toBe(2);
    expect(exit.delayMs).toBe(defaultRestartDelayMs(2));
    expect(defaultRestartDelayMs(2)).toBeGreaterThan(defaultRestartDelayMs(1));
    h.supervisor.dispose();
  });

  it("a run that reached Capturing resets the backoff", () => {
    const h = createHarness();
    h.supervisor.startSession();
    h.spawned[0]!.emitExit(1); // attempt 1
    h.timers.find((t) => !t.cleared)!.fn();
    const second = h.spawned[1]!;
    second.emitStdout("ALBION DETECTED\n");
    second.emitExit(1);
    expect(h.exits()[1]!.attempt).toBe(1); // reset, not 2
    h.supervisor.dispose();
  });

  it("a classified permission failure is fatal: no restart, kind reported", () => {
    const h = createHarness();
    h.supervisor.startSession();
    const child = h.spawned[0]!;
    child.emitStderr("Error: /dev/bpf0: Permission denied\n");
    child.emitExit(1);

    const exit = h.exits()[0]!;
    expect(exit.fatal).toBe(EEngineErrorKind.Permission);
    expect(exit.willRestart).toBe(false);
    expect(exit.detail).toContain("Permission denied");
    expect(h.timers.filter((t) => !t.cleared)).toEqual([]);
    h.supervisor.dispose();
  });

  it("a spawn-level error settles the run exactly once", () => {
    const h = createHarness();
    h.supervisor.startSession();
    const child = h.spawned[0]!;
    child.emitError("spawn ENOENT");
    child.emitExit(null); // some platforms still emit exit after error
    expect(h.exits()).toHaveLength(1);
    expect(h.exits()[0]!.fatal).toBe(EEngineErrorKind.EngineMissing);
    h.supervisor.dispose();
  });

  it("spawn throwing synchronously reports EngineMissing", () => {
    const h = createHarness({ spawnThrows: true });
    h.supervisor.startSession();
    expect(h.exits()[0]!.fatal).toBe(EEngineErrorKind.EngineMissing);
    h.supervisor.dispose();
  });

  it("stop during the restart window cancels the relaunch", () => {
    const h = createHarness();
    h.supervisor.startSession();
    h.spawned[0]!.emitExit(1);
    const restart = h.timers.find((t) => !t.cleared)!;
    h.supervisor.stopSession();
    expect(restart.cleared).toBe(true);
    expect(h.events.at(-1)?.type).toBe("restart-cancelled");
    expect(h.supervisor.isActive()).toBe(false);
    h.supervisor.dispose();
  });

  it("log-file announcements arrive resolved to an absolute path", () => {
    const h = createHarness();
    h.supervisor.startSession();
    h.spawned[0]!.emitStdout("Logging to loot-events-1.txt\n");
    const lineEvents = h.events.filter((e) => e.type === "engine-line");
    const logEvent = lineEvents.find((e) => e.type === "engine-line" && e.event.kind === "log-file");
    expect(logEvent != null && logEvent.type === "engine-line" && logEvent.event.kind === "log-file").toBe(true);
    if (logEvent?.type === "engine-line" && logEvent.event.kind === "log-file") {
      expect(logEvent.event.file).toBe("/engine/loot-events-1.txt");
    }
    h.supervisor.dispose();
  });
});

// --- the real thing: supervisor + reducer over the mock engine ---------------

const waitFor = async (label: string, pred: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("engine supervisor — integration against the mock engine", () => {
  let cwd: string;
  let supervisor: TEngineSupervisor | null = null;

  afterEach(() => {
    supervisor?.dispose();
    supervisor = null;
    rmSync(cwd, { recursive: true, force: true });
  });

  const startReal = (args: string[], delayMs = 30): { state: () => ReturnType<typeof reduceCaptureSession> } => {
    cwd = mkdtempSync(join(tmpdir(), "gbc-supervisor-"));
    let state = initialCaptureState;
    supervisor = createEngineSupervisor({
      spawn: () => spawn(process.execPath, [MOCK_ENGINE, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }),
      now: Date.now,
      emit: (ev) => {
        state = reduceCaptureSession(state, ev);
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
      // Mirrors the main-process impl: the real engine announces an ABSOLUTE path.
      resolveLogPath: (name) => (isAbsolute(name) ? name : join(cwd, name)),
      restartDelayMs: () => delayMs,
      killGraceMs: 500,
    });
    supervisor.startSession();
    return { state: () => state };
  };

  it("happy path: waiting → capturing, heartbeat counts, clean SIGINT stop", async () => {
    const h = startReal(["--interval=40", "--detect-after=120"]);
    await waitFor("capturing with lines", () => {
      const s = h.state();
      return s.status === ECaptureStatus.Capturing && lootLinesOf(s) > 0 && s.character === "MockWarrior";
    });
    expect(h.state().logFile).toMatch(/loot-events-.*\.txt$/);

    supervisor!.stopSession();
    await waitFor("idle after stop", () => h.state().status === ECaptureStatus.Idle);
    // counts survive the stop
    expect(lootLinesOf(h.state())).toBeGreaterThan(0);
  });

  it("a crashing engine is relaunched and keeps counting", async () => {
    const h = startReal(["--interval=30", "--detect-after=40", "--crash-after=250"]);
    await waitFor("first capture", () => h.state().status === ECaptureStatus.Capturing);
    await waitFor("restart happened", () => h.state().restartAttempt >= 1);
    await waitFor("capturing again", () => h.state().status === ECaptureStatus.Capturing, 8000);
  });

  it("a permission failure lands in Error with the right kind and no relaunch", async () => {
    const h = startReal(["--fail=permission"]);
    await waitFor("error state", () => h.state().status === ECaptureStatus.Error);
    expect(h.state().errorKind).toBe(EEngineErrorKind.Permission);
    expect(h.state().errorDetail).toContain("Permission denied");
    // give a would-be restart a moment to prove it does not happen
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.state().status).toBe(ECaptureStatus.Error);
  });
});
