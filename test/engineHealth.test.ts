import { describe, expect, it, vi } from "vitest";

import { parseEngineLine } from "../src/main/engineAdapter.js";
import { reduceCaptureSession } from "../src/main/captureSession.js";
import { EUploadOutcome, sendEngineHealth } from "../src/main/uploadClient.js";
import {
  ECaptureStatus,
  EUpdatePhase,
  initialCaptureState,
  initialUpdateStatus,
  type TCaptureState,
} from "../src/shared/captureTypes.js";
import { EHealthAction, EHealthLine, healthCard, mergeBroken, newlyBroken } from "../src/shared/engineHealth.js";
import { REAL } from "./fixtures/realEngineLines.js";

/**
 * "A game update broke loot logging" (raid-bot ADR 0092 amendment; owner's pick C, 2026-09-29).
 * The engine's [health] verdict → the sticky session state → the card's next step → the bot.
 */

const ATTACH = { handler: "EvAttachItemContainer", failures: 5, calls: 5 };
const JOIN = { handler: "OpJoin", failures: 5, calls: 6 };

describe("reading the engine's [health] line", () => {
  it("reads the recorded ok line as a verdict with nothing broken", () => {
    expect(parseEngineLine(REAL.healthOk)).toEqual({ kind: "engine-health", broken: [] });
  });

  it("reads the recorded broken lines, handler by handler", () => {
    expect(parseEngineLine(REAL.healthBroken)).toEqual({ kind: "engine-health", broken: [ATTACH] });
    expect(parseEngineLine(REAL.healthBrokenTwo)).toEqual({ kind: "engine-health", broken: [ATTACH, JOIN] });
  });

  it("strips colour first, like every other engine line", () => {
    expect(parseEngineLine(`\u001b[32m${REAL.healthBroken}\u001b[0m`).kind).toBe("engine-health");
  });

  it.each([
    ["an entry that is not a handler", "[health] parse broken: something 5/5 (last 10 min)"],
    ["more failures than calls", "[health] parse broken: EvAttachItemContainer 6/5 (last 10 min)"],
    ["zero failures", "[health] parse broken: EvAttachItemContainer 0/5 (last 10 min)"],
    ["a broken line with no entries", "[health] parse broken: (last 10 min)"],
  ])("refuses %s — noise, never an invented or empty verdict", (_label, line) => {
    expect(parseEngineLine(line).kind).toBe("noise");
  });

  it("does not read the heartbeat as a verdict, or the verdict as a heartbeat", () => {
    expect(parseEngineLine(REAL.heartbeatNamed).kind).toBe("heartbeat");
    expect(parseEngineLine(REAL.healthOk).kind).toBe("engine-health");
  });
});

const line = (state: TCaptureState, raw: string): TCaptureState =>
  reduceCaptureSession(state, { type: "engine-line", at: 1, event: parseEngineLine(raw) });

describe("the session's broken list", () => {
  it("starts unknown, not fine — an older engine never reports", () => {
    expect(initialCaptureState.engineBroken).toBeNull();
    expect(line(initialCaptureState, REAL.healthOk).engineBroken).toEqual([]);
  });

  it("is sticky: the engine's ten-minute verdict clearing does not clear the card", () => {
    const broken = line(initialCaptureState, REAL.healthBroken);
    expect(broken.engineBroken).toEqual([ATTACH]);
    expect(line(broken, REAL.healthOk).engineBroken).toEqual([ATTACH]);
  });

  it("grows by union and takes the newest counts", () => {
    const one = line(initialCaptureState, REAL.healthBroken);
    const two = line(one, REAL.healthBrokenTwo);
    expect(two.engineBroken).toEqual([ATTACH, JOIN]);
  });

  it("survives Stop and Start — the build is the same until the app updates", () => {
    const broken = line(initialCaptureState, REAL.healthBroken);
    const restarted = reduceCaptureSession(broken, { type: "user-start", at: 2 });
    expect(restarted.engineBroken).toEqual([ATTACH]);
  });

  it("tells the bot only about handlers that are new this session", () => {
    expect(newlyBroken(null, [ATTACH])).toEqual([ATTACH]);
    expect(newlyBroken([ATTACH], [ATTACH])).toEqual([]);
    expect(newlyBroken([ATTACH], mergeBroken([ATTACH], [JOIN]))).toEqual([JOIN]);
    expect(newlyBroken([ATTACH], null)).toEqual([]);
  });
});

describe("the card's next step", () => {
  const phase = (p: EUpdatePhase) => ({ ...initialUpdateStatus, phase: p });

  it("with the fix downloaded, stops a running capture first — main refuses to cut one", () => {
    expect(healthCard(phase(EUpdatePhase.Ready), ECaptureStatus.Capturing)).toEqual({
      line: EHealthLine.Ready,
      action: EHealthAction.StopAndUpdate,
    });
    expect(healthCard(phase(EUpdatePhase.Ready), ECaptureStatus.Waiting).action).toBe(EHealthAction.StopAndUpdate);
    expect(healthCard(phase(EUpdatePhase.Ready), ECaptureStatus.Idle).action).toBe(EHealthAction.RestartToUpdate);
  });

  it("offers nothing to press while the fix is on its way", () => {
    expect(healthCard(phase(EUpdatePhase.Downloading), ECaptureStatus.Capturing).action).toBe(EHealthAction.None);
    expect(healthCard(phase(EUpdatePhase.Checking), ECaptureStatus.Capturing).action).toBe(EHealthAction.None);
  });

  it("says the fix is not out yet when the updater knows of nothing newer", () => {
    expect(healthCard(phase(EUpdatePhase.UpToDate), ECaptureStatus.Capturing)).toEqual({
      line: EHealthLine.NotOutYet,
      action: EHealthAction.CheckForFix,
    });
    expect(healthCard(phase(EUpdatePhase.Error), ECaptureStatus.Idle).line).toBe(EHealthLine.CheckFailed);
  });

  it("sends a member whose app cannot update itself (macOS) to the download page", () => {
    expect(healthCard(phase(EUpdatePhase.Off), ECaptureStatus.Capturing)).toEqual({
      line: EHealthLine.Manual,
      action: EHealthAction.GetUpdate,
    });
  });
});

describe("reporting to the bot", () => {
  const reply = (body: unknown, status = 200) =>
    ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) }) as never;
  const payload = { appVersion: "0.8.7", broken: [ATTACH] };

  it("posts the new handlers to the engine-health route with the device token", async () => {
    const fetchLike = vi.fn().mockResolvedValue(reply({ received: 1 }));
    const result = await sendEngineHealth(fetchLike, "", "tok", payload);
    expect(result.outcome).toBe(EUploadOutcome.Accepted);
    const [url, init] = fetchLike.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://app.guild-butler.com/control/capture/engine-health");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it("maps a bot that predates the route to NotDeployed, and a dead network to Unreachable", async () => {
    expect((await sendEngineHealth(vi.fn().mockResolvedValue(reply({}, 404)) as never, "", "t", payload)).outcome).toBe(
      EUploadOutcome.NotDeployed,
    );
    expect(
      (await sendEngineHealth(vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never, "", "t", payload)).outcome,
    ).toBe(EUploadOutcome.Unreachable);
  });
});
