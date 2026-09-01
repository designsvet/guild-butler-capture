import { describe, expect, it, vi } from "vitest";

import { parseEngineLine } from "../src/main/engineAdapter.js";
import { EUploadOutcome, sendEnergyLogPage, sendEnergyReading } from "../src/main/uploadClient.js";
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

describe("the adapter reads a log page", () => {
  const logLine = (rows: unknown[], over: Record<string, unknown> = {}): string =>
    `[energy-log] ${JSON.stringify({ server: "europe", code: 159, albionGuildId: "dnLn5L8lRuS8---yM3vKLQ", rows, ...over })}`;

  const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    playerName: "Generiess",
    type: 3,
    note: "",
    amountRaw: -100000,
    ticks: 639238458190780000,
    ...over,
  });

  it("divides the scale and floors the timestamp to the second", () => {
    const event = parseEngineLine(REAL.energyLog);

    expect(event).toMatchObject({
      kind: "energy-log",
      albionGuildId: "dnLn5L8lRuS8---yM3vKLQ",
    });
    const rows = (event as { rows: Array<{ playerName: string; type: number; amount: number; happenedAt: number }> })
      .rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ playerName: "Generiess", type: 3, amount: -10, happenedAt: 1788249019000 });
    expect(rows[1]!.amount).toBe(6);
    expect(rows[2]!.amount).toBe(99);
    // The wire said 07:50:19.078. The game's copyable log says 07:50:19, and the bot
    // de-duplicates on the timestamp — so an unfloored row would never match the same row
    // pasted by a human, and a guild running both paths would store everything twice.
    expect(new Date(rows[0]!.happenedAt).toISOString()).toBe("2026-09-01T07:50:19.000Z");
    expect(rows[0]!.happenedAt % 1000).toBe(0);
  });

  it("keeps an unfamiliar type — what a 2 or a 7 means is the bot's question", () => {
    const event = parseEngineLine(logLine([row({ type: 7 })]));
    expect((event as { rows: Array<{ type: number }> }).rows[0]!.type).toBe(7);
  });

  it("voids the whole page on one bad row rather than arriving short", () => {
    // The bot appends these to a de-duplicated mirror, so a page that quietly loses a row
    // leaves a hole nothing re-asks for: the rows around it are already held.
    for (const bad of [
      logLine([row(), row({ playerName: "" })]),
      logLine([row({ amountRaw: -100001 })]),
      logLine([row({ amountRaw: "-100000" })]),
      logLine([row({ type: 3.5 })]),
      logLine([row({ ticks: "nope" })]),
      logLine([]),
      "[energy-log] not json",
    ]) {
      expect(parseEngineLine(bad).kind).toBe("noise");
    }
  });

  it("still reads a page whose guild is unknown, and says so", () => {
    // Refusing here would put half the attribution rule in the client, where nobody audits it.
    const event = parseEngineLine(logLine([row()], { albionGuildId: null }));
    expect(event).toMatchObject({ kind: "energy-log", albionGuildId: null });
  });

  it("is not confused with a plain reading line", () => {
    expect(parseEngineLine(REAL.energy).kind).toBe("energy");
    expect(parseEngineLine(REAL.energyLog).kind).toBe("energy-log");
  });
});

describe("posting a log page", () => {
  const payload = {
    server: "europe",
    albionGuildId: "dnLn5L8lRuS8---yM3vKLQ",
    rows: [{ playerName: "Generiess", type: 3, amount: -10, happenedAt: 1788249019000 }],
  };

  const res = (status: number, body: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  });

  it("reports what the mirror took and what it already held", async () => {
    const fetchLike = vi.fn(async () => res(200, { stored: 3, known: 98, refused: 0 }));

    const result = await sendEnergyLogPage(fetchLike as never, "https://bot.example", "tok", payload);

    expect(result.outcome).toBe(EUploadOutcome.Accepted);
    expect(result.outcome === EUploadOutcome.Accepted && result.reply.accepted).toBe(3);
    expect(result.outcome === EUploadOutcome.Accepted && result.reply.duplicate).toBe(98);
    const [url] = fetchLike.mock.calls[0] as unknown as [string];
    expect(url).toContain("/control/capture/energy-log");
  });

  it("treats a refusal to accept balance rows as final, not as something to retry", async () => {
    const fetchLike = vi.fn(async () => res(403, {}));

    const result = await sendEnergyLogPage(fetchLike as never, "https://bot.example", "tok", payload);

    expect(result).toEqual({ outcome: EUploadOutcome.Rejected, detail: "forbidden" });
  });
});
