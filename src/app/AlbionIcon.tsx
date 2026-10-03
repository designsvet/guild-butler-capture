import { useState } from "react";
import { mobInfo } from "../shared/session/names.js";
import { DATA_ICONS, Icon, INFO } from "./icons.js";
import { FULL_FRAME_MOB_AVATARS, MOB_PORTRAIT_AVATARS } from "./mobPortraits.js";

/** Packaged native assets with exact static mappings. No arbitrary image path or remote URL. */
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
const MOB_PORTRAITS: ReadonlySet<string> = new Set(MOB_PORTRAIT_AVATARS);
const FULL_FRAME_PORTRAITS: ReadonlySet<string> = new Set(FULL_FRAME_MOB_AVATARS);
const Sprite = ({
  file,
  size,
  onError,
  medallion = false,
}: {
  file: string;
  size: number;
  onError?: () => void;
  medallion?: boolean;
}) => (
  <img
    className="lb-albion-icon"
    src={`./albion/${file}`}
    width={size * (medallion ? 2 : 1)}
    height={size * (medallion ? 2 : 1)}
    style={{
      width: size * (medallion ? 2 : 1),
      height: size * (medallion ? 2 : 1),
      transform: medallion ? "translate(-25%, -25%)" : undefined,
    }}
    alt=""
    aria-hidden="true"
    onError={onError}
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
const MobPortrait = ({ avatar, size }: { avatar: string; size: number }) => {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <AlbionIcon metric="kills" size={size} />
  ) : (
    <span className="lb-mob-portrait" style={{ width: size, height: size }} aria-hidden="true">
      <Sprite
        file={`mob-${avatar}.png`}
        size={size}
        medallion={!FULL_FRAME_PORTRAITS.has(avatar)}
        onError={() => setFailed(true)}
      />
    </span>
  );
};
export const MobIcon = ({ mob, size = 30 }: { mob: number; size?: number }) => {
  const avatar = mobInfo(mob)?.avatar;
  return avatar != null && MOB_PORTRAITS.has(avatar) ? (
    <MobPortrait key={avatar} avatar={avatar} size={size} />
  ) : (
    <AlbionIcon metric="kills" size={size} />
  );
};
