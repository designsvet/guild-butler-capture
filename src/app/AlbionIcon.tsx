import { mobInfo } from "../shared/session/names.js";
import { DATA_ICONS, Icon, INFO } from "./icons.js";

/** Exact assets from the owner's approved F1/F3 exports. No arbitrary image path or remote URL. */
export const ALBION_ICONS = {
  fame: "u-fame.png",
  respec: "u-respec.png",
  silver: "u-silver.png",
  might: "u-might.png",
  favor: "u-favor.png",
  loot: "u-bag.png",
  kills: "u-skull_gold.png",
  gathering: "i-T8_2H_TOOL_SICKLE.png",
  fishing: "i-T5_FISH_FRESHWATER_STEPPE_RARE.png",
} as const;
const MOB_PORTRAITS = new Set([
  "HERETICMAGE1",
  "KEEPERDRUID1",
  "KEEPEREARTHCHILD1",
  "MORGANACULTIST1",
  "MORGANASOLDIER1",
  "MORGANASOLDIERMINIBOSS1",
  "UNDEADARCHER1",
  "UNDEADMAGE1",
]);
const Sprite = ({ file, size }: { file: string; size: number }) => (
  <img
    className="lb-albion-icon"
    src={`./albion/${file}`}
    width={size}
    height={size}
    style={{ width: size, height: size }}
    alt=""
    aria-hidden="true"
  />
);
export const AlbionIcon = ({ metric, size = 24 }: { metric: string; size?: number }) => {
  const file = ALBION_ICONS[metric as keyof typeof ALBION_ICONS];
  return file != null ? (
    <Sprite file={file} size={size} />
  ) : (
    <Icon paths={DATA_ICONS[metric as keyof typeof DATA_ICONS] ?? INFO} size={size} />
  );
};
/** The supplied exports contain green, blue and purple chests only. Never substitute a different rarity. */
export const ChestIcon = ({ rarity, size = 24 }: { rarity: number | null; size?: number }) => {
  const file =
    rarity === 2 ? "u-chest_green.png" : rarity === 3 ? "u-chest_blue.png" : rarity === 4 ? "u-chest_purple.png" : null;
  return file != null ? <Sprite file={file} size={size} /> : <Icon paths={DATA_ICONS.chest} size={size} />;
};
export const MobIcon = ({ mob, size = 30 }: { mob: number; size?: number }) => {
  const avatar = mobInfo(mob)?.avatar;
  return avatar != null && MOB_PORTRAITS.has(avatar) ? (
    <Sprite file={`mob-${avatar}.png`} size={size} />
  ) : (
    <AlbionIcon metric="kills" size={size} />
  );
};
