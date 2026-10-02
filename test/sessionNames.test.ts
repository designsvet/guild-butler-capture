import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBS, WORLD } from "../src/shared/session/nameTables.js";
import { mobName, resourceName, worldName } from "../src/shared/session/names.js";
const manifest = JSON.parse(readFileSync(new URL("../docs/session-names.json", import.meta.url), "utf8"));
describe("generated world and mob names", () => {
  it("pins the committed bytes to the reviewed dump revision", () => {
    const source = readFileSync(new URL("../src/shared/session/nameTables.ts", import.meta.url));
    expect(createHash("sha256").update(source).digest("hex")).toBe(manifest.tableSha256);
    expect(Object.keys(WORLD)).toHaveLength(manifest.worldCount);
    expect(Object.keys(MOBS)).toHaveLength(manifest.mobCount);
    expect(source.toString()).toContain(manifest.revision);
    expect(manifest.inputSha256).toHaveProperty("mobs");
  });
  it("preserves the protocol's 16-entry offset and file order", () => {
    expect(Object.keys(MOBS).map(Number)).toEqual(Array.from({ length: manifest.mobCount }, (_, index) => index + 16));
    expect(MOBS[16]?.unique).toBe("T5_MOB_ROAMING_KEEPER_FANATIC_SPEAR_CHAMPION");
    expect(MOBS[2732]?.unique).toBe("MOB_CASTLE_ELITE_GUARD_KNIGHT");
    expect(mobName(2732, "en")).toBeTruthy();
  });
  it("resolves recorded zones and leaves instance names and dungeon size unknown", () => {
    expect(worldName("1354")).toEqual({ name: "Timberslope Bridge", tier: 8, colour: "black", content: "openWorld" });
    expect(worldName("2000")?.content).toBe("city");
    expect(worldName("@RANDOMDUNGEON@a-uuid")).toEqual({ name: null, tier: null, colour: null, content: "dungeon" });
    expect(worldName("new-patch-zone")).toBeNull();
    expect(mobName(999999, "en")).toBeNull();
    expect(resourceName("T6_HIDE", "en")).toBe("Robust Hide");
    expect(resourceName("T3_FISH_FRESHWATER_STEPPE_RARE", "en")).toBe("Lowriver Crab");
    expect(resourceName("T8_JOURNAL_WARRIOR_FULL", "en")).toBe("Elder Blacksmith's Journal (Full)");
    expect(resourceName("T8_JOURNAL_WARRIOR_FULL", "de")).toBe("Journal des Schmiedeältesten (voll)");
    expect(resourceName("T8_JOURNAL_WARRIOR_FULL_DESC", "en")).toBeNull();
  });
});
