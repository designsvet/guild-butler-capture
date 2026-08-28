import { describe, expect, it, vi } from "vitest";

import { parseEngineLine } from "../src/main/engineAdapter.js";
import { EUploadOutcome, sendFestivities } from "../src/main/uploadClient.js";
import { buildFestivitiesLine } from "../tools/mock-engine.cjs";
import { REAL } from "./fixtures/realEngineLines.js";

/**
 * The daily bonus rotation as it crosses this app (raid-bot ADR 0100): the engine prints it,
 * the adapter reads it, the upload client posts it beside the loot batches.
 *
 * Both fixtures are recordings, never hand-written strings: `REAL.festivities` is the first real
 * payload off live traffic (Europe, 2026-08-28, event code 518) and the mock engine's line is
 * what `pnpm dev:mock` actually prints. A test that invents its own input pins nothing.
 */

const NET_EPOCH_TICKS = 621_355_968_000_000_000;
const NOW = 1_800_000_000_000;
const ticks = (ms: number): number => NET_EPOCH_TICKS + ms * 10_000;

const line = (entries: unknown[], over: Record<string, unknown> = {}): string =>
  `[festivities] ${JSON.stringify({ server: "europe", code: 518, entries, ...over })}`;

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 2,
  category: "GENERAL",
  uniqueName: "COMMON_DAGGER",
  startTicks: ticks(NOW),
  endTicks: ticks(NOW + 86_400_000),
  ...over,
});

describe("parsing the engine's festivities line", () => {
  it("parses the REAL recorded line (Europe, 2026-08-28, code 518)", () => {
    const event = parseEngineLine(REAL.festivities);
    expect(event.kind).toBe("festivities");
    if (event.kind === "festivities") {
      expect(event.code).toBe(518);
      expect(event.server).toBe("europe");
      expect(event.entries.map((e) => e.uniqueName)).toEqual(["DRAGON_LEAD_UP_PHASE_1", "MISTS", "COMMON_BOW"]);
      // The seasonal row's category really is empty on the wire — nothing here may reject it.
      expect(event.entries[0]?.category).toBe("");
      expect(new Date(event.entries[1]!.endMs).toISOString()).toBe("2026-08-30T10:00:00.000Z");
    }
  });

  it("reads the mock engine's own line", () => {
    const event = parseEngineLine(buildFestivitiesLine(NOW));
    expect(event.kind).toBe("festivities");
    if (event.kind === "festivities") {
      expect(event.server).toBe("europe");
      expect(event.entries.map((e) => e.uniqueName)).toEqual(["DRAGON_LEAD_UP_PHASE_1", "MISTS", "COMMON_BOW"]);
    }
  });

  it("converts .NET ticks to epoch milliseconds", () => {
    const event = parseEngineLine(line([entry()]));
    expect(event.kind === "festivities" && event.entries[0]?.startMs).toBe(NOW);
    expect(event.kind === "festivities" && event.entries[0]?.endMs).toBe(NOW + 86_400_000);
  });

  it("keeps the server as null when the engine has not detected one yet", () => {
    const event = parseEngineLine(line([entry()], { server: null }));
    expect(event.kind === "festivities" && event.server).toBeNull();
  });

  it("degrades a malformed row to noise rather than sending half a rotation", () => {
    // The payload REPLACES a server's whole rotation on the bot side, so a partial read would
    // publish a rotation missing whatever failed to parse — with a countdown on it.
    expect(parseEngineLine(line([entry(), entry({ endTicks: "soon" })])).kind).toBe("noise");
    expect(parseEngineLine(line([])).kind).toBe("noise");
    expect(parseEngineLine("[festivities] not json at all").kind).toBe("noise");
  });

  it("never mistakes an ordinary debug dump for a rotation", () => {
    expect(parseEngineLine("[debug]: EvNewLoot { festivities: 1 }").kind).toBe("noise");
  });
});

describe("sending a rotation", () => {
  const reply = (body: unknown, status = 200) =>
    ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) }) as never;

  const payload = {
    server: "europe",
    capturedAt: NOW,
    eventCode: 518,
    entries: [{ kind: 2, category: "GENERAL", uniqueName: "COMMON_BOW", startMs: NOW, endMs: NOW + 1 }],
  };

  it("posts to the festivities route with the device token", async () => {
    const fetchLike = vi.fn().mockResolvedValue(reply({ server: "europe", stored: 3, superseded: false }));
    const result = await sendFestivities(fetchLike, "", "tok", payload);
    expect(result.outcome).toBe(EUploadOutcome.Accepted);
    const [url, init] = fetchLike.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://app.guild-butler.com/control/capture/festivities");
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("reads a superseded snapshot as a duplicate, not a failure", () => {
    // Two members logging in seconds apart is the normal case, and the loser has nothing to fix.
    return sendFestivities(
      vi.fn().mockResolvedValue(reply({ stored: 0, superseded: true })) as never,
      "",
      "tok",
      payload,
    ).then((result) => {
      expect(result.outcome).toBe(EUploadOutcome.Accepted);
      expect(result.outcome === EUploadOutcome.Accepted && result.reply.duplicate).toBe(1);
    });
  });

  it("maps a bot that predates the feature to NotDeployed, so it heals on its own", async () => {
    const result = await sendFestivities(vi.fn().mockResolvedValue(reply({}, 404)) as never, "", "tok", payload);
    expect(result.outcome).toBe(EUploadOutcome.NotDeployed);
  });

  it("maps a dead token and a dead network to their own outcomes", async () => {
    const unauthorized = await sendFestivities(vi.fn().mockResolvedValue(reply({}, 401)) as never, "", "t", payload);
    expect(unauthorized.outcome).toBe(EUploadOutcome.Unauthorized);

    const dead = await sendFestivities(vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never, "", "t", payload);
    expect(dead.outcome).toBe(EUploadOutcome.Unreachable);
  });
});
