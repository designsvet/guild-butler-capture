/**
 * The engine supervisor — owns the child process and every decision about it:
 * spawn, watch, classify failures, restart with backoff, kill with escalation.
 * It reports what it did as TSessionEvents; `captureSession.ts` renders them.
 *
 * Everything external is injected (spawn, clock, timers), so the whole
 * lifecycle — including crash-restart and permission-failure paths — is
 * exercised in tests against the mock engine and against scripted fakes.
 *
 * "Survive the game restarting" costs nothing here: the engine keeps its
 * pcap device open across game restarts and re-detects by itself. What this
 * supervisor survives is the ENGINE dying — auto-relaunch with backoff,
 * unless the failure is one a relaunch can never fix (EPERM forever is not a
 * retry loop anyone needs to watch).
 */

import { EEngineErrorKind, isFatalErrorKind } from "../shared/captureTypes.js";
import { classifyFatalLine, createLineSplitter, parseEngineLine } from "./engineAdapter.js";
import type { TSessionEvent } from "./captureSession.js";

/** Structural subset of node's ChildProcess — what the supervisor actually touches. */
export type TEngineChild = {
  pid?: number | undefined;
  stdout: { on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown } | null;
  stderr: { on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown } | null;
  once: (event: "exit", listener: (code: number | null, signal: string | null) => void) => unknown;
  on: (event: "error", listener: (err: Error) => void) => unknown;
  kill: (signal?: "SIGINT" | "SIGKILL") => boolean;
};

export type TSupervisorDeps = {
  spawn: () => TEngineChild;
  now: () => number;
  emit: (ev: TSessionEvent) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Resolve a bare log-file name the engine printed to an absolute path. */
  resolveLogPath: (name: string) => string;
  /** Restart backoff; injected so tests run in milliseconds. */
  restartDelayMs?: (attempt: number) => number;
  /** SIGINT → this long → SIGKILL. */
  killGraceMs?: number;
};

/** 1s, 2s, 4s… capped at 30s. Attempt resets once a run proves healthy. */
export const defaultRestartDelayMs = (attempt: number): number => {
  return Math.min(30_000, 1000 * 2 ** Math.min(Math.max(attempt - 1, 0), 5));
};

/** A run that reached Capturing, or simply lived this long, resets the backoff. */
export const HEALTHY_RUN_MS = 60_000;

const DETAIL_RING_SIZE = 25;
const DEFAULT_KILL_GRACE_MS = 3000;

export type TEngineSupervisor = {
  startSession: () => void;
  stopSession: () => void;
  /** True while a child is alive or a relaunch is pending. */
  isActive: () => boolean;
  /** App-quit teardown: kill hard, emit nothing. */
  dispose: () => void;
};

export const createEngineSupervisor = (deps: TSupervisorDeps): TEngineSupervisor => {
  const delayFn = deps.restartDelayMs ?? defaultRestartDelayMs;
  const killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  let child: TEngineChild | null = null;
  let restartTimer: unknown = null;
  let killTimer: unknown = null;
  let stopRequested = false;
  let disposed = false;
  let attempt = 0;
  let runStartedAt = 0;
  let sawCapturing = false;
  let lastFatal: EEngineErrorKind | null = null;
  let detailRing: string[] = [];

  const pushDetail = (line: string): void => {
    if (line.trim().length === 0) {
      return;
    }
    detailRing.push(line);
    if (detailRing.length > DETAIL_RING_SIZE) {
      detailRing.shift();
    }
  };

  const handleLine = (raw: string): void => {
    pushDetail(raw);
    const event = parseEngineLine(raw);
    if (event.kind === "fatal") {
      lastFatal = event.errorKind;
    }
    if (event.kind === "albion-detected") {
      sawCapturing = true;
    }
    const resolved = event.kind === "log-file" ? { ...event, file: deps.resolveLogPath(event.file) } : event;
    deps.emit({ type: "engine-line", at: deps.now(), event: resolved });
  };

  const handleExit = (code: number | null): void => {
    if (killTimer != null) {
      deps.clearTimer(killTimer);
      killTimer = null;
    }
    child = null;
    if (disposed) {
      return;
    }

    const runMs = deps.now() - runStartedAt;
    const healthy = sawCapturing || runMs >= HEALTHY_RUN_MS;
    const fatal = stopRequested ? null : isFatalErrorKind(lastFatal) ? lastFatal : null;
    // A run that ended for no classified reason: healthy runs restart from a
    // clean slate, quick deaths back off harder each time.
    attempt = healthy ? 1 : attempt + 1;
    const willRestart = !stopRequested && fatal == null;
    const delayMs = willRestart ? delayFn(attempt) : 0;
    const detail =
      detailRing.length > 0 ? detailRing.join("\n") : code != null ? `engine exited with code ${code}` : null;

    deps.emit({ type: "engine-exit", at: deps.now(), fatal, detail, willRestart, delayMs, attempt });

    if (willRestart) {
      restartTimer = deps.setTimer(() => {
        restartTimer = null;
        spawnRun();
      }, delayMs);
    } else {
      stopRequested = false;
    }
  };

  const spawnRun = (): void => {
    lastFatal = null;
    sawCapturing = false;
    detailRing = [];
    runStartedAt = deps.now();

    let spawned: TEngineChild;
    try {
      spawned = deps.spawn();
    } catch (err) {
      lastFatal = EEngineErrorKind.EngineMissing;
      pushDetail(String(err));
      deps.emit({ type: "engine-spawned", at: deps.now() });
      handleExit(null);
      return;
    }
    child = spawned;
    deps.emit({ type: "engine-spawned", at: deps.now() });

    const stdout = createLineSplitter(handleLine);
    const stderr = createLineSplitter(handleLine);
    spawned.stdout?.on("data", (chunk) => stdout.push(chunk.toString()));
    spawned.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
    // One verdict per run: an ENOENT "error" may or may not be followed by an
    // "exit", and handling both would schedule two restarts.
    let settled = false;
    const settleRun = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      stdout.flush();
      stderr.flush();
      handleExit(code);
    };
    spawned.on("error", (err) => {
      const kind = classifyFatalLine(err.message) ?? EEngineErrorKind.EngineMissing;
      lastFatal = isFatalErrorKind(lastFatal) ? lastFatal : kind;
      pushDetail(err.message);
      settleRun(null);
    });
    spawned.once("exit", (code) => {
      settleRun(code);
    });
  };

  return {
    startSession: (): void => {
      if (disposed || child != null || restartTimer != null) {
        return;
      }
      stopRequested = false;
      attempt = 0;
      deps.emit({ type: "user-start", at: deps.now() });
      spawnRun();
    },

    stopSession: (): void => {
      if (disposed) {
        return;
      }
      if (restartTimer != null) {
        deps.clearTimer(restartTimer);
        restartTimer = null;
        stopRequested = false;
        deps.emit({ type: "user-stop", at: deps.now() });
        deps.emit({ type: "restart-cancelled", at: deps.now() });
        return;
      }
      if (child == null) {
        return;
      }
      stopRequested = true;
      deps.emit({ type: "user-stop", at: deps.now() });
      // SIGINT first so the engine can flush its file; the hammer only if
      // it lingers. On Windows SIGINT degrades to a plain kill, which is fine.
      const target = child;
      target.kill("SIGINT");
      killTimer = deps.setTimer(() => {
        killTimer = null;
        if (child === target) {
          target.kill("SIGKILL");
        }
      }, killGraceMs);
    },

    isActive: (): boolean => {
      return child != null || restartTimer != null;
    },

    dispose: (): void => {
      disposed = true;
      if (restartTimer != null) {
        deps.clearTimer(restartTimer);
        restartTimer = null;
      }
      if (killTimer != null) {
        deps.clearTimer(killTimer);
        killTimer = null;
      }
      child?.kill("SIGKILL");
      child = null;
    },
  };
};
