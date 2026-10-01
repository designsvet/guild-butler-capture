import { describe, expect, it } from "vitest";

import {
  ECaptureAccess,
  ECaptureStatus,
  EEngineErrorKind,
  EUpdatePhase,
  HEALTHY_RUN_MS,
  initialCaptureState,
  initialUpdateStatus,
  type TCaptureState,
  type TSetupStatus,
  type TUpdateStatus,
} from "../src/shared/captureTypes.js";
import { HEALTHY_RUN_MS as SUPERVISOR_HEALTHY_RUN_MS } from "../src/main/engineSupervisor.js";
import { EHealthAction, EHealthLine, feedsLoot, lootBroken, NON_LOOT_HANDLERS } from "../src/shared/engineHealth.js";
import {
  bandNotice,
  captureBlock,
  decoderDialogEvent,
  EBlock,
  ENotice,
  LOGGER_STOPPING_FROM,
  loggerKeepsStopping,
  noticesNow,
} from "../src/shared/notices.js";

/**
 * Which notice the v5 shell's band shows, and when the broken decoder's dialog interrupts
 * (src/shared/notices.ts; raid-bot ADR 0159 amendment 2026-10-01, boards Fh4 option D and Fh5).
 */

const NOW = 1_800_000_000_000;
const ATTACH = { handler: "EvAttachItemContainer", failures: 5, calls: 5 };
const FESTIVITIES = { handler: "EvFestivitiesUpdate", failures: 5, calls: 5 };

const capture = (patch: Partial<TCaptureState>): TCaptureState => ({ ...initialCaptureState, ...patch });
const setupOf = (patch: Partial<TSetupStatus> = {}): TSetupStatus => ({
  platform: "darwin",
  engineEntry: "/engine/src/index.js",
  engineRoot: "/engine",
  engineSource: "bundled",
  access: ECaptureAccess.Ok,
  appVersion: "0.8.8",
  builtAt: null,
  ...patch,
});
const updateOf = (patch: Partial<TUpdateStatus> = {}): TUpdateStatus => ({ ...initialUpdateStatus, ...patch });

describe("which broken handlers make loot wrong", () => {
  it("the five that feed no loot line hold nothing; every other one does", () => {
    expect([...NON_LOOT_HANDLERS].sort()).toEqual([
      "EvFestivitiesUpdate",
      "EvGuildState",
      "OpGuildEnergyDrain",
      "OpGuildLogPage",
      "OpGuildLogRequest",
    ]);
    for (const handler of ["EvAttachItemContainer", "EvOtherGrabbedLoot", "EvInventoryPutItem", "EvNewCharacter", "EvCharacterStats", "OpJoin", "OpInventoryMoveItem"]) {
      expect(feedsLoot(handler)).toBe(true);
    }
  });

  it("a handler this app has never heard of counts as feeding loot — the safe mistake", () => {
    expect(feedsLoot("EvSomethingANewEngineAdds")).toBe(true);
  });

  it("is broken for loot when any broken handler feeds it, and not when none does", () => {
    expect(lootBroken(null)).toBe(false);
    expect(lootBroken([])).toBe(false);
    expect(lootBroken([FESTIVITIES])).toBe(false);
    expect(lootBroken([FESTIVITIES, ATTACH])).toBe(true);
  });
});

describe("captureBlock: what stands between the member and a capture", () => {
  it("reads the error state's kind, the macOS permission on Windows being Npcap's admin-only install", () => {
    const err = (errorKind: EEngineErrorKind | null) => capture({ status: ECaptureStatus.Error, errorKind });
    expect(captureBlock(err(EEngineErrorKind.Permission), setupOf())).toBe(EBlock.MacPermission);
    expect(captureBlock(err(EEngineErrorKind.Permission), setupOf({ platform: "win32" }))).toBe(EBlock.NpcapAdminOnly);
    expect(captureBlock(err(EEngineErrorKind.NpcapMissing), setupOf({ platform: "win32" }))).toBe(EBlock.NpcapMissing);
    expect(captureBlock(err(EEngineErrorKind.AbiMismatch), setupOf())).toBe(EBlock.AbiMismatch);
    expect(captureBlock(err(EEngineErrorKind.EngineMissing), setupOf())).toBe(EBlock.EngineMissing);
    expect(captureBlock(err(null), setupOf())).toBe(EBlock.Unknown);
  });

  it("while idle, the setup probe already knows — the missing engine first", () => {
    const idle = capture({});
    expect(captureBlock(idle, setupOf())).toBeNull();
    expect(captureBlock(idle, setupOf({ access: ECaptureAccess.Unknown }))).toBeNull();
    expect(captureBlock(idle, setupOf({ access: ECaptureAccess.NoPermission }))).toBe(EBlock.MacPermission);
    expect(captureBlock(idle, setupOf({ platform: "win32", access: ECaptureAccess.NpcapMissing }))).toBe(EBlock.NpcapMissing);
    expect(captureBlock(idle, setupOf({ platform: "win32", access: ECaptureAccess.NpcapAdminOnly }))).toBe(EBlock.NpcapAdminOnly);
    expect(captureBlock(idle, setupOf({ engineEntry: null, access: ECaptureAccess.NoPermission }))).toBe(EBlock.EngineMissing);
  });

  it("a running capture is not blocked, whatever an old probe says; nothing before the first snapshot", () => {
    const running = capture({ status: ECaptureStatus.Capturing });
    expect(captureBlock(running, setupOf({ access: ECaptureAccess.NoPermission }))).toBeNull();
    expect(captureBlock(null, setupOf({ access: ECaptureAccess.NoPermission }))).toBeNull();
    expect(captureBlock(capture({}), null)).toBeNull();
  });
});

describe("the logger keeps stopping: from the third restart in a row", () => {
  const restarting = (restartAttempt: number) =>
    capture({ status: ECaptureStatus.Restarting, restartAttempt, restartDelayMs: 4_000 });

  it("not for the first two restarts; from the third, while the next one waits", () => {
    expect(LOGGER_STOPPING_FROM).toBe(3);
    expect(loggerKeepsStopping(restarting(1), NOW)).toBe(false);
    expect(loggerKeepsStopping(restarting(2), NOW)).toBe(false);
    expect(loggerKeepsStopping(restarting(3), NOW)).toBe(true);
    expect(loggerKeepsStopping(restarting(6), NOW)).toBe(true);
  });

  it("stays through the relaunched run until it proves healthy — by the supervisor's own test", () => {
    expect(HEALTHY_RUN_MS).toBe(SUPERVISOR_HEALTHY_RUN_MS);
    const relaunched = (status: ECaptureStatus, age: number) =>
      capture({ status, restartAttempt: 3, runStartedAt: NOW - age, albionSeen: status === ECaptureStatus.Capturing });
    expect(loggerKeepsStopping(relaunched(ECaptureStatus.Starting, 2_000), NOW)).toBe(true);
    expect(loggerKeepsStopping(relaunched(ECaptureStatus.Waiting, HEALTHY_RUN_MS - 1), NOW)).toBe(true);
    // lived a healthy run's length, or saw Albion: it is up
    expect(loggerKeepsStopping(relaunched(ECaptureStatus.Waiting, HEALTHY_RUN_MS), NOW)).toBe(false);
    expect(loggerKeepsStopping(relaunched(ECaptureStatus.Capturing, 2_000), NOW)).toBe(false);
  });

  it("a Stop ends it, and so does a failure no restart can fix", () => {
    expect(loggerKeepsStopping(capture({ status: ECaptureStatus.Idle, restartAttempt: 5 }), NOW)).toBe(false);
    expect(loggerKeepsStopping(capture({ status: ECaptureStatus.Stopping, restartAttempt: 5 }), NOW)).toBe(false);
    expect(loggerKeepsStopping(capture({ status: ECaptureStatus.Error, restartAttempt: 5 }), NOW)).toBe(false);
    expect(loggerKeepsStopping(null, NOW)).toBe(false);
  });
});

describe("the band: one notice at a time, the most blocking first", () => {
  const everything = {
    capture: capture({ status: ECaptureStatus.Error, errorKind: EEngineErrorKind.Permission, engineBroken: [ATTACH], restartAttempt: 4 }),
    setup: setupOf(),
    update: updateOf({ phase: EUpdatePhase.Ready, version: "0.9.1" }),
    now: NOW,
  };

  it("capture blocked › decoder broken › the logger keeps stopping › an update is ready", () => {
    expect(noticesNow(everything).map((n) => n.kind)).toEqual([ENotice.Blocked, ENotice.Decoder, ENotice.UpdateReady]);
    expect(bandNotice(everything)).toEqual({ kind: ENotice.Blocked, block: EBlock.MacPermission });

    const restartingBroken = {
      ...everything,
      capture: capture({ status: ECaptureStatus.Restarting, engineBroken: [ATTACH], restartAttempt: 4, restartDelayMs: 8_000 }),
    };
    expect(noticesNow(restartingBroken).map((n) => n.kind)).toEqual([ENotice.Decoder, ENotice.LoggerStopping, ENotice.UpdateReady]);
    const restartingOnly = { ...restartingBroken, capture: { ...restartingBroken.capture, engineBroken: [] } };
    expect(bandNotice(restartingOnly)?.kind).toBe(ENotice.LoggerStopping);
    const updateOnly = { ...restartingOnly, capture: capture({ status: ECaptureStatus.Capturing }) };
    expect(bandNotice(updateOnly)).toEqual({ kind: ENotice.UpdateReady, running: true });
    expect(bandNotice({ ...updateOnly, capture: capture({}) })).toEqual({ kind: ENotice.UpdateReady, running: false });
  });

  it("nothing when nothing is wrong, and nothing before the first snapshot", () => {
    expect(bandNotice({ capture: capture({ status: ECaptureStatus.Capturing }), setup: setupOf(), update: updateOf(), now: NOW })).toBeNull();
    expect(bandNotice({ capture: null, setup: null, update: null, now: NOW })).toBeNull();
  });

  it("the decoder's step is healthCard's: stop and update while the logger runs, check while the fix is not out", () => {
    const broken = (status: ECaptureStatus, update: Partial<TUpdateStatus>) =>
      bandNotice({ capture: capture({ status, engineBroken: [ATTACH] }), setup: setupOf(), update: updateOf(update), now: NOW });
    expect(broken(ECaptureStatus.Capturing, { phase: EUpdatePhase.Ready, version: "0.9.1" })).toEqual({
      kind: ENotice.Decoder,
      line: EHealthLine.Ready,
      action: EHealthAction.StopAndUpdate,
    });
    expect(broken(ECaptureStatus.Idle, { phase: EUpdatePhase.Ready })).toMatchObject({ action: EHealthAction.RestartToUpdate });
    expect(broken(ECaptureStatus.Capturing, { phase: EUpdatePhase.UpToDate })).toMatchObject({
      line: EHealthLine.NotOutYet,
      action: EHealthAction.CheckForFix,
    });
    expect(broken(ECaptureStatus.Capturing, { phase: EUpdatePhase.Downloading, percent: 40 })).toMatchObject({
      line: EHealthLine.Downloading,
      action: EHealthAction.None,
    });
    expect(broken(ECaptureStatus.Capturing, { phase: EUpdatePhase.Off })).toMatchObject({
      line: EHealthLine.Manual,
      action: EHealthAction.GetUpdate,
    });
  });

  it("a broken handler that feeds no loot puts nothing up: the loudest notice must not cry wolf", () => {
    const festivities = { capture: capture({ status: ECaptureStatus.Capturing, engineBroken: [FESTIVITIES] }), setup: setupOf(), update: updateOf(), now: NOW };
    expect(bandNotice(festivities)).toBeNull();
    expect(decoderDialogEvent(festivities.capture, festivities.update)).toBeNull();
  });
});

describe("the broken decoder's dialog: once when found, again when the fix has downloaded", () => {
  const broken = capture({ status: ECaptureStatus.Capturing, engineBroken: [ATTACH] });

  it("interrupts for the break, and for each fix that downloads — each its own event", () => {
    expect(decoderDialogEvent(broken, updateOf({ phase: EUpdatePhase.UpToDate }))).toBe("broken");
    expect(decoderDialogEvent(broken, updateOf({ phase: EUpdatePhase.Downloading, version: "0.9.1" }))).toBe("broken");
    expect(decoderDialogEvent(broken, updateOf({ phase: EUpdatePhase.Ready, version: "0.9.1" }))).toBe("fix-ready:0.9.1");
    expect(decoderDialogEvent(broken, updateOf({ phase: EUpdatePhase.Ready, version: "0.9.2" }))).toBe("fix-ready:0.9.2");
  });

  it("never while the decoder is fine", () => {
    expect(decoderDialogEvent(capture({}), updateOf({ phase: EUpdatePhase.Ready, version: "0.9.1" }))).toBeNull();
    expect(decoderDialogEvent(null, null)).toBeNull();
  });
});
