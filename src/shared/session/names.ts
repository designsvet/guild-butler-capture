import type { TLang } from "../i18n.js";
import { WORLD, MOBS, RESOURCE_NAMES } from "./nameTables.js";
export type TContent =
  | "openWorld"
  | "dungeon"
  | "soloDungeon"
  | "groupDungeon"
  | "roads"
  | "ancientLands"
  | "mists"
  | "hideout"
  | "island"
  | "city"
  | "other";
export type TWorldName = { name: string | null; tier: number | null; colour: string | null; content: TContent };
export type TMobName = {
  unique: string;
  names: Partial<Record<TLang, string>>;
  tier: number | null;
  faction: string | null;
};
export const worldName = (id: string | null): TWorldName | null => {
  if (id == null) {
    return null;
  }
  if (Object.hasOwn(WORLD, id)) {
    return WORLD[id]!;
  }
  // UUIDs name an instance, never its title or dungeon size. Keep those unknown.
  const kind = /^@([A-Z_]+)@/.exec(id)?.[1];
  const content: TContent | null =
    kind === "ISLAND"
      ? "island"
      : kind === "HIDEOUT"
        ? "hideout"
        : kind === "RANDOMDUNGEON"
          ? "dungeon"
          : kind === "MIST" || kind === "MISTS"
            ? "mists"
            : kind === "DRAGON_AREA"
              ? "ancientLands"
              : null;
  return content == null ? null : { name: null, tier: null, colour: null, content };
};
export const mobName = (index: number, lang: TLang): string | null => {
  const mob = MOBS[String(index)];
  return mob?.names[lang] ?? mob?.names.en ?? null;
};
export const mobInfo = (index: number): TMobName | null => MOBS[String(index)] ?? null;

export const resourceName = (id: string | null, lang: TLang): string | null => {
  if (id == null) {
    return null;
  }
  const names = RESOURCE_NAMES[id.split("@")[0] ?? id];
  return names?.[lang] ?? names?.en ?? null;
};
