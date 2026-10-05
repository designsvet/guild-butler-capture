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
import { parseEngineLine } from "../src/main/engineAdapter.js";
import { reduceCaptureSession } from "../src/main/captureSession.js";
import { createUploader, EUploaderState } from "../src/main/uploader.js";
import type { THeldRange } from "../src/main/uploadPlan.js";
import {
  EHealthAction,
  EHealthLine,
  feedsLoot,
  lootBroken,
  NON_LOOT_HANDLERS,
  TRADE_HANDLERS,
} from "../src/shared/engineHealth.js";
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
  captureDir: "/data/captures",
  access: ECaptureAccess.Ok,
  appVersion: "0.8.8",
  builtAt: null,
  ...patch,
});
const updateOf = (patch: Partial<TUpdateStatus> = {}): TUpdateStatus => ({ ...initialUpdateStatus, ...patch });

describe("which broken handlers make loot wrong", () => {
  it("the eleven that feed no loot line hold nothing; every other one does", () => {
    // The five of the rotation and the guild's energy, and the six player-trade handlers below.
    expect([...NON_LOOT_HANDLERS].sort()).toEqual([
      "EvFestivitiesUpdate",
      "EvGuildState",
      "EvInvitationPlayerTrade",
      "EvPlayerTradeCancel",
      "EvPlayerTradeFinished",
      "EvPlayerTradeUpdate",
      "OpGuildEnergyDrain",
      "OpGuildLogPage",
      "OpGuildLogRequest",
      "OpInviteToPlayerTrade",
      "OpPlayerTradeAcceptTrade",
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

describe("the trade handlers feed no loot (designsvet/ao-loot-logger#20, raid-bot ADR 0168)", () => {
  /**
   * PRINTED BY THE ENGINE'S OWN MODULE — `require('./src/storage/parse-health').statusLine()` on
   * designsvet/ao-loot-logger feat/player-trades 9ae23c0, 2026-10-05 — after six trade updates that
   * all threw, then five container attaches beside them. Not typed by hand.
   */
  const TRADE_ONLY = "[health] parse broken: EvPlayerTradeUpdate 6/6 (last 10 min)";
  const TRADE_AND_ATTACH = "[health] parse broken: EvAttachItemContainer 5/5, EvPlayerTradeUpdate 6/6 (last 10 min)";

  /**
   * The handler names as the engine's six trade handlers declare them (`const name = …` in
   * src/data-handler/{event,request,response}-data at 9ae23c0). Written out again on purpose: two
   * programs, no shared build — if the engine renames one, this is what should fail.
   */
  const ENGINE_TRADE_HANDLERS = [
    "EvInvitationPlayerTrade",
    "EvPlayerTradeCancel",
    "EvPlayerTradeFinished",
    "EvPlayerTradeUpdate",
    "OpInviteToPlayerTrade",
    "OpPlayerTradeAcceptTrade",
  ];

  /** The session after the engine printed `raw` — main's sticky broken list. */
  const line = (state: TCaptureState, raw: string): TCaptureState =>
    reduceCaptureSession(state, { type: "engine-line", at: 1, event: parseEngineLine(raw) });

  it("lists all six as feeding no loot", () => {
    expect([...TRADE_HANDLERS].sort()).toEqual(ENGINE_TRADE_HANDLERS);
    for (const handler of ENGINE_TRADE_HANDLERS) {
      expect(feedsLoot(handler), handler).toBe(false);
      expect(NON_LOOT_HANDLERS.has(handler), handler).toBe(true);
    }
  });

  it("matches whole names: a trade-like handler it has never heard of still feeds loot", () => {
    expect(feedsLoot("EvPlayerTradeSomethingNew")).toBe(true);
    expect(feedsLoot("EvAttachItemContainer")).toBe(true);
  });

  /** One pass of an uploader with main's hold rule (`lootBroken` over the session's list): what reached the bot. */
  const sentWith = async (raw: string): Promise<{ sent: string[]; state: EUploaderState; holds: THeldRange[] }> => {
    const session = line(initialCaptureState, raw);
    const sent: string[] = [];
    const holds: THeldRange[] = [];
    const up = createUploader({
      fetchLike: async (_url, init) => {
        const body = JSON.parse(init.body) as { from: number; lines: string[] };
        sent.push(...body.lines);
        const reply = { accepted: body.lines.length, duplicate: 0, rejected: 0, nextFrom: body.from + body.lines.length };
        return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
      },
      base: "https://bot",
      token: () => "tok",
      enabled: () => true,
      currentFile: () => "/captures/loot-events-2026-10-05-17-43-51.txt",
      readFile: async () => "a\nb\n",
      newRunId: () => "run-1",
      now: () => 1_000,
      log: () => undefined,
      held: () => lootBroken(session.engineBroken),
      holds: {
        list: () => holds,
        add: (range) => {
          holds.push(range);
          return true;
        },
      },
    });
    await up.tick();
    return { sent, state: up.status().state, holds };
  };

  it("a break in the trade decoder alone does not hold the loot upload, or put the card up", async () => {
    expect(parseEngineLine(TRADE_ONLY)).toEqual({
      kind: "engine-health",
      broken: [{ handler: "EvPlayerTradeUpdate", failures: 6, calls: 6 }],
    });
    expect(lootBroken(line(initialCaptureState, TRADE_ONLY).engineBroken)).toBe(false);
    expect(await sentWith(TRADE_ONLY)).toEqual({ sent: ["a", "b"], state: EUploaderState.UpToDate, holds: [] });
    // lootBroken is also what puts the "loot is logged wrong" notice up: a trade-only break does not.
    const session = line(capture({ status: ECaptureStatus.Capturing }), TRADE_ONLY);
    const input = { capture: session, setup: setupOf(), update: updateOf(), now: NOW };
    expect(noticesNow(input).map((n) => n.kind)).not.toContain(ENotice.Decoder);
    expect(decoderDialogEvent(session, updateOf())).toBeNull();
  });

  it("a loot handler broken beside it still holds everything, and says so", async () => {
    expect(lootBroken(line(initialCaptureState, TRADE_AND_ATTACH).engineBroken)).toBe(true);
    const session = line(capture({ status: ECaptureStatus.Capturing }), TRADE_AND_ATTACH);
    expect(decoderDialogEvent(session, updateOf())).toBe("broken");
    const { sent, state, holds } = await sentWith(TRADE_AND_ATTACH);
    expect(sent).toEqual([]);
    expect(state).toBe(EUploaderState.Held);
    expect(holds).toEqual([expect.objectContaining({ file: "/captures/loot-events-2026-10-05-17-43-51.txt", from: 0 })]);
  });
});
