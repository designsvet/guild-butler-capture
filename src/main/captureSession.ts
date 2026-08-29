/**
 * The capture session state machine — pure, no Electron, no timers, no fs.
 *
 * Main owns one TCaptureState and folds TSessionEvents into it; every fold is
 * pushed whole to the renderer. The engine supervisor DECIDES process-level
 * outcomes (restart or not, delay, fatal kind) and reports them inside the
 * `engine-exit` event, so this reducer renders decisions, never makes them —
 * one brain per concern, and both are unit-testable without a process.
 */

import type { TEngineEvent } from "./engineAdapter.js";
import { ECaptureStatus, EEngineErrorKind, initialCaptureState, type TCaptureState } from "../shared/captureTypes.js";

export type TSessionEvent =
  | { type: "user-start"; at: number }
  | { type: "user-stop"; at: number }
  | { type: "engine-spawned"; at: number }
  | { type: "engine-line"; at: number; event: TEngineEvent }
  /** File-poll fallback for engines whose heartbeat we failed to parse. */
  | { type: "file-lines"; at: number; file: string; lines: number }
  | {
      type: "engine-exit";
      at: number;
      /** Non-null = unrecoverable, the supervisor will not relaunch. */
      fatal: EEngineErrorKind | null;
      /** Last raw engine lines, for the "technical details" view. */
      detail: string | null;
      willRestart: boolean;
      delayMs: number;
      /** The supervisor's consecutive-unexpected-exit counter (it owns resets). */
      attempt: number;
    }
  /** User stopped while a relaunch was pending — no process existed to exit. */
  | { type: "restart-cancelled"; at: number };

const RUNNING_STATUSES: ReadonlySet<ECaptureStatus> = new Set([
  ECaptureStatus.Starting,
  ECaptureStatus.Waiting,
  ECaptureStatus.Capturing,
]);

export const reduceCaptureSession = (state: TCaptureState, ev: TSessionEvent): TCaptureState => {
  switch (ev.type) {
    case "user-start": {
      // A fresh session: counters reset, but the character and the last log
      // file survive — same player, and Reveal should still find yesterday's
      // file until a new one exists.
      return {
        ...initialCaptureState,
        status: ECaptureStatus.Starting,
        startedAt: ev.at,
        character: state.character,
        logFile: state.logFile,
      };
    }

    case "user-stop": {
      return {
        ...state,
        stopRequested: true,
        status: RUNNING_STATUSES.has(state.status) ? ECaptureStatus.Stopping : state.status,
      };
    }

    case "engine-spawned": {
      return {
        ...state,
        status: state.stopRequested ? state.status : ECaptureStatus.Starting,
        runStartedAt: ev.at,
        albionSeen: false,
        heartbeatSeen: false,
        restartDelayMs: null,
      };
    }

    case "engine-line": {
      const next: TCaptureState = { ...state, lastOutputAt: ev.at };
      const line = ev.event;
      switch (line.kind) {
        case "albion-detected": {
          next.albionSeen = true;
          next.lastDetectedAt = ev.at;
          if (next.status === ECaptureStatus.Starting || next.status === ECaptureStatus.Waiting) {
            next.status = ECaptureStatus.Capturing;
          }
          return next;
        }
        case "albion-lost": {
          next.albionSeen = false;
          if (next.status === ECaptureStatus.Capturing || next.status === ECaptureStatus.Starting) {
            next.status = ECaptureStatus.Waiting;
          }
          return next;
        }
        case "loot": {
          // A pickup is the strongest possible proof of traffic — stronger
          // than the detection line, because loot is the thing we are here
          // for. It counts immediately; the next heartbeat reconciles.
          next.albionSeen = true;
          next.lastDetectedAt = ev.at;
          next.lastLootAt = ev.at;
          next.linesSinceHeartbeat = next.linesSinceHeartbeat + 1;
          if (next.status === ECaptureStatus.Starting || next.status === ECaptureStatus.Waiting) {
            next.status = ECaptureStatus.Capturing;
          }
          return next;
        }
        case "heartbeat": {
          if (line.character != null) {
            next.character = line.character;
          }
          if (line.linesWritten != null) {
            next.heartbeatSeen = true;
            // Monotonic guard: a heartbeat can never take lines away.
            next.linesThisRun = Math.max(next.linesThisRun, line.linesWritten);
            // …and it is the reconciling truth for what we counted live, so
            // the optimistic delta starts again from here. An over- or
            // under-count is bounded by one heartbeat and never accumulates.
            next.linesSinceHeartbeat = 0;
          }
          // A heartbeat proves the engine is alive and past its startup.
          if (next.status === ECaptureStatus.Starting) {
            next.status = ECaptureStatus.Waiting;
          }
          return next;
        }
        case "character": {
          next.character = line.name;
          return next;
        }
        case "log-file": {
          next.logFile = line.file;
          return next;
        }
        case "fatal":
        case "noise": {
          // Fatal lines change nothing here — the supervisor collects them and
          // the exit event carries the verdict. A scary line from an engine
          // that keeps running must not flip the UI into an error state.
          return next;
        }
      }
      return next;
    }

    case "file-lines": {
      const next: TCaptureState = { ...state };
      if (next.logFile == null || next.logFile !== ev.file) {
        next.logFile = ev.file;
      }
      if (!next.heartbeatSeen) {
        next.linesThisRun = Math.max(next.linesThisRun, ev.lines);
        // The poll counted the file itself; same reconciliation as a heartbeat.
        next.linesSinceHeartbeat = 0;
      }
      return next;
    }

    case "engine-exit": {
      // Roll the finished run's count into the session total first — whatever
      // happens next, lines already written stay counted.
      const rolled: TCaptureState = {
        ...state,
        linesPrevRuns: state.linesPrevRuns + state.linesThisRun + state.linesSinceHeartbeat,
        linesThisRun: 0,
        linesSinceHeartbeat: 0,
        heartbeatSeen: false,
        albionSeen: false,
        runStartedAt: null,
      };
      if (state.stopRequested) {
        return {
          ...rolled,
          status: ECaptureStatus.Idle,
          stopRequested: false,
          restartAttempt: 0,
          restartDelayMs: null,
          errorKind: null,
          errorDetail: null,
        };
      }
      if (ev.fatal != null) {
        return {
          ...rolled,
          status: ECaptureStatus.Error,
          errorKind: ev.fatal,
          errorDetail: ev.detail,
          restartDelayMs: null,
        };
      }
      if (ev.willRestart) {
        return {
          ...rolled,
          status: ECaptureStatus.Restarting,
          restartAttempt: ev.attempt,
          restartDelayMs: ev.delayMs,
          errorKind: null,
          errorDetail: ev.detail,
        };
      }
      return { ...rolled, status: ECaptureStatus.Idle, restartDelayMs: null };
    }

    case "restart-cancelled": {
      return {
        ...state,
        status: ECaptureStatus.Idle,
        stopRequested: false,
        restartAttempt: 0,
        restartDelayMs: null,
      };
    }
  }
};
