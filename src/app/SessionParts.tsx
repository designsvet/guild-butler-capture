import { useId, useState, type ReactNode } from "react";
import type { TLang } from "../shared/i18n.js";
import { LOCALE_OF, formatCount } from "../shared/plural.js";
import type { TSessionStrings } from "../shared/sessionStrings.js";
import { FIXED_SCALE } from "../shared/session/model.js";
import { worldName } from "../shared/session/names.js";
import { CHEVRON, APPEARS, INFO, Icon } from "./icons.js";

export const precise = (lang: TLang, raw: number): string =>
  new Intl.NumberFormat(LOCALE_OF[lang], { maximumFractionDigits: 4 }).format(raw / FIXED_SCALE);
export const compact = (lang: TLang, value: number): string =>
  new Intl.NumberFormat(LOCALE_OF[lang], { notation: "compact", maximumFractionDigits: 1 }).format(value);
export const duration = (lang: TLang, ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return `${formatCount(lang, Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, "0")}`;
};
export const zoneLabel = (id: string | null, text: TSessionStrings): string => {
  const zone = worldName(id);
  return zone?.name ?? (zone != null ? text[zone.content] : text.unknownZone);
};
export const Panel = ({
  title,
  icon = INFO,
  children,
  subtitle,
}: {
  title: string;
  icon?: readonly string[];
  children: ReactNode;
  subtitle?: string;
}) => {
  const id = useId();
  const bodyId = useId();
  const [folded, setFolded] = useState(false);
  return (
    <section className="gb-card lb-card lb-data-card" aria-labelledby={id}>
      <div className="lb-card-head">
        <span className="lb-tile lb-tile--head" aria-hidden="true">
          <Icon paths={icon} size={13} />
        </span>
        <h2 className="lb-card-title" id={id}>
          {title}
        </h2>
        {subtitle != null ? <span className="lb-data-sub">{subtitle}</span> : null}
        <button
          type="button"
          className="lb-fold"
          aria-label={title}
          aria-expanded={!folded}
          aria-controls={bodyId}
          onClick={() => {
            setFolded(!folded);
          }}
        >
          <Icon paths={CHEVRON} size={14} />
        </button>
      </div>
      {!folded ? (
        <div className="lb-data-content" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
};
export const Stat = ({
  label,
  value,
  exact,
  metric,
  detail,
  raw,
}: {
  label: string;
  value: string;
  exact: string;
  metric: string;
  raw: number;
  detail?: string;
}) => (
  <section
    className="gb-card lb-stat"
    aria-label={`${label}: ${exact}`}
    data-session-metric={metric}
    data-exact={exact}
    data-raw={raw}
  >
    <div className="lb-eyebrow">
      <span className="lb-tile lb-tile--head">
        <Icon paths={APPEARS[0] ?? INFO} size={13} />
      </span>
      {label}
    </div>
    <div className="lb-stat-value" title={exact}>
      {value}
    </div>
    {detail != null ? <div className="lb-stat-detail">{detail}</div> : null}
  </section>
);
export const chestLabel = (rarity: number | null, text: TSessionStrings): string =>
  rarity === 1
    ? text.rarityCommon
    : rarity === 2
      ? text.rarityUncommon
      : rarity === 3
        ? text.rarityRare
        : rarity === 4
          ? text.rarityLegendary
          : text.unknownChest;
