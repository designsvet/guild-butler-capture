import { describe, expect, it } from "vitest";

import { reduceCaptureSession, type TSessionEvent } from "../src/main/captureSession.js";
import {
  ECaptureStatus,
  EEngineErrorKind,
  initialCaptureState,
  lootLinesOf,
  type TCaptureState,
} from "../src/shared/captureTypes.js";

const run = (events: TSessionEvent[], from: TCaptureState = initialCaptureState): TCaptureState => {
  return events.reduce(reduceCaptureSession, from);
};

let t = 1_000_000;
const at = (): number => {
  t += 1000;
  return t;
};

const exitEvent = (over: Partial<Extract<TSessionEvent, { type: "engine-exit" }>> = {}): TSessionEvent => {
  return {
    type: "engine-exit",
    at: at(),
    fatal: null,
    detail: null,
    willRestart: false,
    delayMs: 0,
    attempt: 0,
    ...over,
  };
};

describe("capture session — the happy path", () => {
  it("start → spawn → heartbeat → detected lands in Capturing with the character", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: null, linesWritten: 0 } },
      { type: "engine-line", at: at(), event: { kind: "albion-detected" } },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: "Borys", linesWritten: 5 } },
    ]);
    expect(s.status).toBe(ECaptureStatus.Capturing);
    expect(s.albionSeen).toBe(true);
    expect(s.character).toBe("Borys");
    expect(lootLinesOf(s)).toBe(5);
  });

  it("a game restart is Waiting, then Capturing again — counts survive", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "albion-detected" } },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: "Borys", linesWritten: 9 } },
      { type: "engine-line", at: at(), event: { kind: "albion-lost" } },
      { type: "engine-line", at: at(), event: { kind: "albion-detected" } },
    ]);
    expect(s.status).toBe(ECaptureStatus.Capturing);
    expect(lootLinesOf(s)).toBe(9);
    expect(s.character).toBe("Borys");
  });

  it("heartbeat counts are monotonic within a run — a lower count never rolls back", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: null, linesWritten: 12 } },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: null, linesWritten: 4 } },
    ]);
    expect(lootLinesOf(s)).toBe(12);
  });

  it("user stop rolls the run's lines up and lands Idle with counters intact", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: "Borys", linesWritten: 42 } },
      { type: "user-stop", at: at() },
      exitEvent(),
    ]);
    expect(s.status).toBe(ECaptureStatus.Idle);
    expect(lootLinesOf(s)).toBe(42);
    expect(s.stopRequested).toBe(false);
  });
});

describe("capture session — engine restarts", () => {
  it("lines accumulate across an unexpected engine restart", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: "Borys", linesWritten: 42 } },
      exitEvent({ willRestart: true, delayMs: 1000, attempt: 1 }),
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "heartbeat", character: null, linesWritten: 7 } },
    ]);
    expect(s.status).toBe(ECaptureStatus.Waiting);
    expect(lootLinesOf(s)).toBe(49);
    // the character survives the restart even though the new run has not named one yet
    expect(s.character).toBe("Borys");
  });

  it("an unexpected exit shows Restarting with the supervisor's delay and attempt", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      exitEvent({ willRestart: true, delayMs: 4000, attempt: 3, detail: "boom" }),
    ]);
    expect(s.status).toBe(ECaptureStatus.Restarting);
    expect(s.restartDelayMs).toBe(4000);
    expect(s.restartAttempt).toBe(3);
    expect(s.errorKind).toBeNull();
  });

  it("stopping during the restart window cancels straight to Idle", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      exitEvent({ willRestart: true, delayMs: 4000, attempt: 1 }),
      { type: "user-stop", at: at() },
      { type: "restart-cancelled", at: at() },
    ]);
    expect(s.status).toBe(ECaptureStatus.Idle);
    expect(s.stopRequested).toBe(false);
  });
});

describe("capture session — fatal errors", () => {
  it("a fatal exit lands in Error with the kind and detail, and Start clears it", () => {
    const failed = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      exitEvent({ fatal: EEngineErrorKind.Permission, detail: "Permission denied" }),
    ]);
    expect(failed.status).toBe(ECaptureStatus.Error);
    expect(failed.errorKind).toBe(EEngineErrorKind.Permission);
    expect(failed.errorDetail).toBe("Permission denied");

    const retried = run([{ type: "user-start", at: at() }], failed);
    expect(retried.status).toBe(ECaptureStatus.Starting);
    expect(retried.errorKind).toBeNull();
  });

  it("a scary line from an engine that keeps running does NOT flip the UI", () => {
    const s = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "engine-line", at: at(), event: { kind: "albion-detected" } },
      {
        type: "engine-line",
        at: at(),
        event: { kind: "fatal", errorKind: EEngineErrorKind.Permission, line: "EPERM somewhere" },
      },
    ]);
    expect(s.status).toBe(ECaptureStatus.Capturing);
    expect(s.errorKind).toBeNull();
  });
});

describe("capture session — file-poll fallback", () => {
  it("file lines count only while no heartbeat has been parsed this run", () => {
    const noHeartbeat = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "file-lines", at: at(), file: "/tmp/loot-events-x.txt", lines: 6 },
    ]);
    expect(lootLinesOf(noHeartbeat)).toBe(6);
    expect(noHeartbeat.logFile).toBe("/tmp/loot-events-x.txt");

    const withHeartbeat = run(
      [
        { type: "engine-line", at: at(), event: { kind: "heartbeat", character: null, linesWritten: 10 } },
        { type: "file-lines", at: at(), file: "/tmp/loot-events-x.txt", lines: 3 },
      ],
      noHeartbeat,
    );
    // the engine's own count wins; the poller can no longer move the number
    expect(lootLinesOf(withHeartbeat)).toBe(10);
  });

  it("a new session resets the counters but keeps the last file for Reveal", () => {
    const before = run([
      { type: "user-start", at: at() },
      { type: "engine-spawned", at: at() },
      { type: "file-lines", at: at(), file: "/tmp/loot-events-old.txt", lines: 99 },
      { type: "user-stop", at: at() },
      exitEvent(),
    ]);
    const fresh = run([{ type: "user-start", at: at() }], before);
    expect(lootLinesOf(fresh)).toBe(0);
    expect(fresh.logFile).toBe("/tmp/loot-events-old.txt");
  });
});
