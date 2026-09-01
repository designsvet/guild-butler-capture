import { describe, expect, it, vi } from "vitest";

import { parseEngineLine } from "../src/main/engineAdapter.js";
import { EUploadOutcome, sendEnergyReading } from "../src/main/uploadClient.js";
import { REAL } from "./fixtures/realEngineLines.js";

/**
 * A guild's siphoned-energy total as it crosses this app (raid-bot ADR 0022): the engine
 * prints it, the adapter divides the wire's x10000 scale, the upload client posts it beside
 * the loot batches.
 *
 * The fixtures are the engine's real output over a payload recorded verbatim from the live
 * client, so 1,291 in the assertions below is a number that was on a screenshot.
 */

const line = (over: Record<string, unknown> = {}): string =>
  `[energy] ${JSON.stringify({
    server: "europe",
    code: 103,
    guildName: "VITRYLA",
    allianceTag: "UA",
    albionGuildId: "dnLn5L8lRuS8---yM3vKLQ",
    currencies: { 0: 12910000 },
    totalRaw: 12910000,
    changed: true,
    ...over,
  })}`;

describe("the adapter reads an energy line", () => {
  it("divides the wire scale — 12910000 is 1,291 energy", () => {
    const event = parseEngineLine(REAL.energy);

    expect(event).toEqual({
      kind: "energy",
      server: null,
      guildName: "VITRYLA",
      allianceTag: "UA",
      albionGuildId: "dnLn5L8lRuS8---yM3vKLQ",
      total: 1291,
      changed: true,
    });
  });

  it("keeps a missing guild id honestly null", () => {
    const event = parseEngineLine(REAL.energyUnidentified);

    expect(event).toMatchObject({
      kind: "energy",
      albionGuildId: null,
      server: "europe",
      changed: false,
    });
  });

  it("refuses a raw value that is not a whole number of energy units", () => {
    // A fraction means the scale is not what this build believes it is — a game patch, or
    // something other than energy in slot 0. A reading quietly 10000x wrong would be written
    // into a guild's history as fact and differenced for weeks, so it is refused, not rounded.
    expect(parseEngineLine(line({ totalRaw: 12910001 })).kind).toBe("noise");
    expect(parseEngineLine(line({ totalRaw: 1291 })).kind).toBe("noise");
  });

  it("refuses a line missing the parts that make it a reading", () => {
    for (const bad of [
      line({ guildName: "" }),
      line({ guildName: 42 }),
      line({ totalRaw: "12910000" }),
      line({ totalRaw: -10000 }),
      line({ totalRaw: undefined }),
      "[energy] not json at all",
      "[energy]",
    ]) {
      expect(parseEngineLine(bad).kind).toBe("noise");
    }
  });

  it("accepts a zero total — a guild really can be empty", () => {
    expect(parseEngineLine(line({ totalRaw: 0 }))).toMatchObject({
      kind: "energy",
      total: 0,
    });
  });

  it("leaves the drain line as noise, since nothing consumes it yet", () => {
    // Deliberate: the engine emits it so `albionGuildId` can be stamped on energy lines, and
    // wiring a parser nobody reads is how a slice ships a layer with the final wire missing.
    expect(parseEngineLine(REAL.energyDrain).kind).toBe("noise");
  });
});

describe("posting a reading", () => {
  const payload = {
    server: "europe",
    guildName: "VITRYLA",
    albionGuildId: "dnLn5L8lRuS8---yM3vKLQ",
    total: 1291,
    readAt: 1_800_000_000_000,
  };

  const res = (status: number, body: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  });

  it("sends the reading to the energy endpoint with the pairing token", async () => {
    const fetchLike = vi.fn(async () => res(200, { stored: true }));

    const result = await sendEnergyReading(
      fetchLike as never,
      "https://bot.example",
      "tok",
      payload,
    );

    expect(result.outcome).toBe(EUploadOutcome.Accepted);
    expect(result.outcome === EUploadOutcome.Accepted && result.reply.accepted).toBe(1);
    const [url, init] = fetchLike.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toContain("/control/capture/energy");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it("counts a reading the bot declined to store as a duplicate, not a failure", async () => {
    const fetchLike = vi.fn(async () =>
      res(200, { stored: false, reason: "rate" }),
    );

    const result = await sendEnergyReading(
      fetchLike as never,
      "https://bot.example",
      "tok",
      payload,
    );

    expect(result.outcome).toBe(EUploadOutcome.Accepted);
    expect(result.outcome === EUploadOutcome.Accepted && result.reply.accepted).toBe(0);
    expect(result.outcome === EUploadOutcome.Accepted && result.reply.duplicate).toBe(1);
  });

  it("maps the failures the way every other upload does", async () => {
    const cases: Array<[number, unknown, EUploadOutcome]> = [
      [401, {}, EUploadOutcome.Unauthorized],
      [429, {}, EUploadOutcome.RateLimited],
      [404, {}, EUploadOutcome.NotDeployed],
      [500, {}, EUploadOutcome.ServerError],
      [400, { error: "guild mismatch" }, EUploadOutcome.Rejected],
    ];
    for (const [status, body, outcome] of cases) {
      const fetchLike = vi.fn(async () => res(status, body));
      expect(
        (
          await sendEnergyReading(
            fetchLike as never,
            "https://bot.example",
            "tok",
            payload,
          )
        ).outcome,
      ).toBe(outcome);
    }
  });

  it("survives an unreachable bot", async () => {
    const fetchLike = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await sendEnergyReading(
      fetchLike as never,
      "https://bot.example",
      "tok",
      payload,
    );

    expect(result).toEqual({ outcome: EUploadOutcome.Unreachable, detail: "offline" });
  });
});
