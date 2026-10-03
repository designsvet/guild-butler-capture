import { useId, useState, type ReactNode } from "react";
import type { TLang } from "../shared/i18n.js";
import { LOCALE_OF, formatCount } from "../shared/plural.js";
import type { TSessionStrings } from "../shared/sessionStrings.js";
import { FIXED_SCALE, type TSession } from "../shared/session/model.js";
import { chestRarities } from "../shared/session/pve.js";
import { worldName } from "../shared/session/names.js";
import { CHEVRON, INFO, Icon } from "./icons.js";
import { hrefOf } from "./router.js";
import { AlbionIcon, ChestIcon } from "./AlbionIcon.js";

export const precise = (lang: TLang, raw: number): string =>
  new Intl.NumberFormat(LOCALE_OF[lang], { maximumFractionDigits: 4 }).format(raw / FIXED_SCALE);
export const compact = (lang: TLang, value: number): string =>
  new Intl.NumberFormat(LOCALE_OF[lang], { notation: "compact", maximumFractionDigits: 1 }).format(value);
export const percent = (lang: TLang, ratio: number): string =>
  new Intl.NumberFormat(LOCALE_OF[lang], { style: "percent", maximumFractionDigits: 0 }).format(ratio);
/** Session-average rate; a stopped session uses its closed duration and cannot keep falling. */
export const hourly = (raw: number, elapsed: number): number | undefined =>
  elapsed > 0 ? (raw / FIXED_SCALE) * (3_600_000 / elapsed) : undefined;
export const PveLink = ({ text }: { text: TSessionStrings }) => (
  <a className="lb-text-action lb-panel-link" href={hrefOf("pve")}>
    {text.openPve}
    <Icon paths={CHEVRON} size={13} />
  </a>
);
export const ContentMark = ({ content }: { content: string }) => (
  <span className="lb-content-mark" data-content={content} aria-hidden="true" />
);
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
  action,
  nativeIcon,
}: {
  title: string;
  icon?: readonly string[];
  children: ReactNode;
  subtitle?: string;
  action?: ReactNode;
  nativeIcon?: string;
}) => {
  const id = useId();
  const bodyId = useId();
  const [folded, setFolded] = useState(false);
  return (
    <section className="gb-card lb-card lb-data-card" aria-labelledby={id}>
      <div className="lb-card-head">
        <span className="lb-tile lb-tile--head" aria-hidden="true">
          {nativeIcon != null ? <AlbionIcon metric={nativeIcon} /> : <Icon paths={icon} size={13} />}
        </span>
        <h2 className="lb-card-title" id={id}>
          {title}
        </h2>
        {subtitle != null ? <span className="lb-data-sub">{subtitle}</span> : null}
        {action}
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
  rate,
  rateText,
}: {
  label: string;
  value: string;
  exact: string;
  metric: string;
  raw: number;
  detail?: string;
  rate?: number;
  rateText?: string;
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
        <AlbionIcon metric={metric} />
      </span>
      {label}
    </div>
    <div className="lb-stat-readout">
      <div className="lb-stat-value" title={exact}>
        {value}
      </div>
      {rate != null ? (
        <span className="lb-stat-rate" data-hourly={rate}>
          ({rateText})
        </span>
      ) : null}
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

/** Complete visit counts, independent of the bounded recent-chest list. */
export const ChestSummary = ({ session, text, lang }: { session: TSession; text: TSessionStrings; lang: TLang }) => (
  <ul className="lb-chest-summary">
    {chestRarities(session).map(({ rarity, count }) => (
      <li key={rarity ?? "unknown"} data-rarity={rarity ?? "unknown"} data-chest-count={count}>
        <ChestIcon rarity={rarity} />
        <b className="lb-number">{formatCount(lang, count)}</b>
        <span>{chestLabel(rarity, text)}</span>
      </li>
    ))}
  </ul>
);
