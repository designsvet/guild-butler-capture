import { describe, expect, it } from "vitest";

import { buildLootLine, HEADER } from "../tools/mock-engine.cjs";

/**
 * The mock engine's CSV must stay ingestible by the Discord bot. This regex is
 * a verbatim copy of AO_LOOT_RE from the bot's `src/domain/lootLog.ts`
 * (ADR 0092) — the 10-field ao-loot-logger v2 line with tolerated trailing
 * columns (the madvac fork appends `server__region` as an 11th). If the bot's
 * parser changes shape, update BOTH sides deliberately.
 */
const BOT_AO_LOOT_RE =
  /^(?<lootedAt>[^;]+);(?<looterAlliance>[^;]*);(?<looterGuild>[^;]*);(?<looterName>[\w]+);(?<itemId>[\w@]+);(?<itemName>[^;]*);(?<quantity>\d+);(?<victimAlliance>[^;]*);(?<victimGuild>[^;]*);(?<victimName>[^;]+)(?:;.*)?$/;

describe("mock engine CSV contract", () => {
  it("every generated row parses with the bot's own line regex", () => {
    for (let i = 0; i < 10; i += 1) {
      const line = buildLootLine(1_755_600_000_000 + i * 1000, i);
      const match = BOT_AO_LOOT_RE.exec(line);
      expect(match?.groups, line).toBeTruthy();
      expect(Number.isNaN(Date.parse(match!.groups!.lootedAt!)), `timestamp: ${line}`).toBe(false);
      expect(Number(match!.groups!.quantity)).toBeGreaterThan(0);
    }
  });

  it("the header line is the one the bot's parser skips", () => {
    expect(HEADER.toLowerCase().startsWith("timestamp_utc;")).toBe(true);
  });
});
