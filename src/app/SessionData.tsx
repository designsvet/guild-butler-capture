/** F1 assembled from one main-process snapshot. No local tally, inferred prices or inferred party. */
import { useState } from "react";
import type { TLang } from "../shared/i18n.js";
import { formatCount } from "../shared/plural.js";
import { sessionStrings, type TSessionStrings } from "../shared/sessionStrings.js";
import { FIXED_SCALE, mobTotal, ownLoot, quantityTotal, type TMetric, type TSession } from "../shared/session/model.js";
import { mobName, resourceName, worldName, type TContent } from "../shared/session/names.js";
import type { TSessionEvent } from "../shared/session/events.js";
import {
  Panel,
  Stat,
  precise,
  compact,
  duration,
  zoneLabel,
  chestLabel,
  hourly,
  percent,
  PveLink,
  ContentMark,
  ChestSummary,
} from "./SessionParts.js";
import { AlbionIcon, ChestIcon, MobIcon } from "./AlbionIcon.js";
import { formatClock } from "./format.js";
import { APPEARS, CHEVRON, DATA_ICONS, FOLDER, Icon, INFO, SESSION } from "./icons.js";

const itemLabel = (item: string | null, text: TSessionStrings, lang: TLang): string =>
  resourceName(item, lang) ?? (item == null ? text.unknownItem : item);
const ItemArt = ({ item }: { item: string }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className="lb-item-art lb-tile">
      {!failed && /^[A-Z0-9_]+(?:@[0-4])?$/.test(item) ? (
        <img
          src={`albion-art://item/${item}`}
          alt=""
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        <Icon paths={APPEARS[1] ?? INFO} size={18} />
      )}
    </span>
  );
};
const Sources = ({
  session,
  metric,
  text,
  lang,
}: {
  session: TSession;
  metric: "fame" | "silver";
  text: TSessionStrings;
  lang: TLang;
}) => {
  const sources = new Map<TContent | "unknownSource", number>();
  if (session.unlocated[metric] !== 0) {
    sources.set("unknownSource", session.unlocated[metric]);
  }
  for (const zone of Object.values(session.zones)) {
    if (zone[metric] !== 0) {
      const kind = worldName(zone.id)?.content ?? "unknownSource";
      sources.set(kind, (sources.get(kind) ?? 0) + zone[metric]);
    }
  }
  const total = session.totals[metric];
  return (
    <Panel title={metric === "fame" ? text.fameSources : text.silverSources} nativeIcon={metric}>
      <ul className="lb-source-list">
        {[...sources]
          .sort((a, b) => b[1] - a[1])
          .map(([source, amount], rank) => (
            <li key={source} data-source-amount={amount} data-source-total={total}>
              <div className="lb-source-line">
                <span>
                  <ContentMark content={source} />
                  {text[source]}
                </span>
                <span className="lb-source-amount lb-number" title={precise(lang, amount)}>
                  {compact(lang, amount / FIXED_SCALE)}
                  <small>({percent(lang, total == null || total <= 0 ? 0 : amount / total)})</small>
                </span>
              </div>
              <div className="lb-source-track" aria-hidden="true">
                <span
                  ref={(el) => {
                    if (el != null) {
                      el.style.width = `${total == null || total <= 0 ? 0 : Math.min(100, (amount / total) * 100)}%`;
                      el.style.opacity = String(Math.max(0.4, 1 - rank * 0.16));
                    }
                  }}
                />
              </div>
            </li>
          ))}
      </ul>
      {total != null ? (
        <div className="lb-total">
          <span>{text[metric]}</span>
          <span className="lb-number" title={precise(lang, total)}>
            {compact(lang, total / FIXED_SCALE)}
          </span>
        </div>
      ) : null}
    </Panel>
  );
};
const feedText = (event: TSessionEvent, lang: TLang, text: TSessionStrings): string | null => {
  switch (event.t) {
    case "zone": {
      return text.feedZone(zoneLabel(event.zone, text));
    }
    case "fame": {
      return text.fame;
    }
    case "silver": {
      return text.silver;
    }
    case "kill": {
      return text.feedKill(mobName(event.mob, lang) ?? `${text.unknownMob} (${event.mob})`);
    }
    case "harvest": {
      return text.feedHarvest(itemLabel(event.item, text, lang), event.std + event.bonus + event.premium);
    }
    case "journal": {
      return text.feedJournal(itemLabel(event.item, text, lang), event.qty);
    }
    case "fish": {
      return event.outcome === "escaped"
        ? text.feedEscape()
        : (event.catch ?? []).map((item) => text.feedFish(itemLabel(item.item, text, lang), item.qty)).join(" · ");
    }
    case "chest": {
      return text.feedChest(chestLabel(event.rarity, text));
    }
    case "loot": {
      return text.feedLoot(event.looter, event.name, event.qty);
    }
    // These remain in the model; their totals already have tiles. The feed keeps the completed things.
    default: {
      return null;
    }
  }
};
const feedIcon = (event: TSessionEvent): readonly string[] => {
  switch (event.t) {
    case "kill":
      return DATA_ICONS.kills;
    case "chest":
      return DATA_ICONS.chest;
    case "fame":
      return DATA_ICONS.fame;
    case "silver":
      return DATA_ICONS.silver;
    case "harvest":
      return DATA_ICONS.gathering;
    case "fish":
      return DATA_ICONS.fishing;
    case "journal":
      return DATA_ICONS.journal;
    case "loot":
      return DATA_ICONS.loot;
    default:
      return DATA_ICONS.place;
  }
};
const feedItem = (event: TSessionEvent): string | null =>
  event.t === "loot" || event.t === "harvest" || event.t === "journal"
    ? event.item
    : event.t === "fish"
      ? (event.catch?.[0]?.item ?? null)
      : null;

export const SessionData = ({
  session,
  lang,
  now,
  onReveal,
}: {
  session: TSession;
  lang: TLang;
  now: number;
  onReveal: () => void;
}) => {
  const text = sessionStrings(lang);
  const elapsed = Math.max(0, (session.endedAt ?? now) - session.startedAt);
  const you = ownLoot(session);
  const nearby = Object.values(session.looters).reduce((sum, looter) => sum + looter.qty, 0);
  const kills = mobTotal(session);
  const harvest = quantityTotal(session.harvests);
  const fish = Object.values(session.catches)
    .filter((item) => /(?:^|_)FISH(?:_|$)/.test(item.item ?? ""))
    .reduce((sum, item) => sum + item.qty, 0);
  const instances = Object.values(session.zones).filter((zone) =>
    ["dungeon", "soloDungeon", "groupDungeon"].includes(worldName(zone.id)?.content ?? ""),
  ).length;
  const unknown =
    Object.keys(session.mobs).some((index) => mobName(Number(index), lang) == null) ||
    Object.keys(session.zones).some((id) => worldName(id) == null) ||
    [...Object.values(session.harvests), ...Object.values(session.catches), ...Object.values(session.journals)].some(
      (item) => item.item == null || item.item.startsWith("UNKNOWN_"),
    ) ||
    Object.values(session.looters).some((looter) =>
      Object.keys(looter.items).some((item) => item.startsWith("UNKNOWN_")),
    );
  const broken = session.refused > 0 || Object.values(session.audits).some((audit) => audit.mismatches > 0);
  const metrics: TMetric[] = ["fame", "respec", "silver", "might", "favor", "faction"];
  const feed = session.feed
    .flatMap((event, index) => {
      const words = feedText(event, lang, text);
      return words == null || words === "" ? [] : [{ event, words, index }];
    })
    .reverse()
    .slice(0, 12);
  return (
    <div className="lb-session-data" data-session-data="" data-session-id={session.id}>
      {broken || unknown ? (
        <div className="lb-data-warning" role="status">
          <Icon paths={INFO} />
          <span>{broken ? text.auditWarning : text.tableWarning}</span>
        </div>
      ) : null}
      <div className="lb-stats">
        {metrics.flatMap((metric) => {
          const raw = session.totals[metric];
          if (raw == null || raw === 0) {
            return [];
          }
          return [
            <Stat
              key={metric}
              label={text[metric as "fame"]}
              metric={metric}
              raw={raw}
              value={compact(lang, raw / FIXED_SCALE)}
              exact={precise(lang, raw)}
              rate={hourly(raw, elapsed)}
              rateText={text.perHour(compact(lang, hourly(raw, elapsed) ?? 0))}
              detail={
                metric === "silver" && session.totals.silverTax != null && session.totals.silverTax > 0
                  ? `${text.silverTax} · ${compact(lang, session.totals.silverTax / FIXED_SCALE)}`
                  : undefined
              }
            />,
          ];
        })}
        {you != null && you.qty > 0 ? (
          <Stat
            label={text.ownLoot}
            metric="loot"
            raw={you.qty}
            value={formatCount(lang, you.qty)}
            exact={formatCount(lang, you.qty)}
            detail={text.itemCount(you.qty)}
          />
        ) : null}
      </div>
      <div className="lb-activity-cards">
        {kills > 0 || session.chestCount > 0 ? (
          <Panel title={text.pve} nativeIcon="kills" action={<PveLink text={text} />}>
            <div className="lb-mini-stats">
              {kills > 0 ? (
                <span>
                  <b className="lb-number" data-session-count="kills">
                    {formatCount(lang, kills)}
                  </b>
                  {text.mobs}
                </span>
              ) : null}
              {session.chestCount > 0 ? (
                <span>
                  <b className="lb-number" data-session-count="chests">
                    {formatCount(lang, session.chestCount)}
                  </b>
                  {text.chests}
                </span>
              ) : null}
              {instances > 0 ? (
                <span>
                  <b className="lb-number">{formatCount(lang, instances)}</b>
                  {text.instances}
                </span>
              ) : null}
            </div>
          </Panel>
        ) : null}
        {harvest > 0 ? (
          <Panel title={text.gathering} nativeIcon="gathering">
            <div className="lb-mini-stats">
              <span>
                <b className="lb-number" data-session-count="resources">
                  {formatCount(lang, harvest)}
                </b>
                {text.resources}
              </span>
            </div>
          </Panel>
        ) : null}
        {session.fishing.landed > 0 || session.fishing.escaped > 0 ? (
          <Panel title={text.fishing} nativeIcon="fishing">
            <div className="lb-mini-stats">
              {fish > 0 ? (
                <span>
                  <b className="lb-number" data-session-count="fish">
                    {formatCount(lang, fish)}
                  </b>
                  {text.fish}
                </span>
              ) : null}
              <span>{text.catchCount(session.fishing.landed)}</span>
            </div>
          </Panel>
        ) : null}
      </div>
      <div className="lb-session">
        <div className="lb-col">
          <div className="lb-sources">
            {session.totals.fame != null && session.totals.fame > 0 ? (
              <Sources session={session} metric="fame" text={text} lang={lang} />
            ) : null}
            {session.totals.silver != null && session.totals.silver > 0 ? (
              <Sources session={session} metric="silver" text={text} lang={lang} />
            ) : null}
          </div>
          {session.lootLines > 0 ? (
            <Panel title={text.recentLoot} nativeIcon="loot" subtitle={text.notPriced}>
              <div className="lb-loot-meta">
                <span>{text.nearbyLoot}</span>
                <span className="lb-number" data-session-count="nearbyLoot">
                  {text.itemCount(nearby)}
                </span>
              </div>
              <ul className="lb-data-list">
                {session.recentLoot
                  .slice()
                  .reverse()
                  .map((event, index) =>
                    event.t === "loot" ? (
                      <li key={index}>
                        <ItemArt key={event.item} item={event.item} />
                        <div className="lb-data-copy lb-loot-copy">
                          <strong>{event.name}</strong>
                          <small>
                            {event.looter} · {formatClock(event.at)}
                          </small>
                        </div>
                        <span className="lb-number">×{formatCount(lang, event.qty)}</span>
                      </li>
                    ) : null,
                  )}
              </ul>
            </Panel>
          ) : null}
          {feed.length > 0 ? (
            <Panel title={text.feed} icon={DATA_ICONS.feed} subtitle={text.eventCount(session.events)}>
              <ol className="lb-feed">
                {feed.map(({ event, words, index }) => {
                  const item = feedItem(event);
                  const gain =
                    event.t === "fame"
                      ? event.gain
                      : event.t === "silver"
                        ? Math.max(0, event.yield - event.cluster_tax - event.guild_tax - event.alliance_tax)
                        : null;
                  return (
                    <li
                      key={index}
                      data-session-event={event.t}
                      data-session-quantity={event.t === "journal" ? event.qty : undefined}
                    >
                      {item != null ? (
                        <ItemArt key={item} item={item} />
                      ) : (
                        <span
                          className="lb-tile lb-feed-icon"
                          data-rarity={event.t === "chest" ? (event.rarity ?? "unknown") : undefined}
                        >
                          {event.t === "kill" ? (
                            <MobIcon mob={event.mob} />
                          ) : event.t === "chest" ? (
                            <ChestIcon rarity={event.rarity} />
                          ) : ["fame", "silver"].includes(event.t) ? (
                            <AlbionIcon metric={event.t} />
                          ) : (
                            <Icon paths={feedIcon(event)} size={18} />
                          )}
                        </span>
                      )}
                      <span className="lb-data-copy">
                        <strong>{words}</strong>
                        <small>
                          {event.t === "loot"
                            ? event.looter
                            : event.t !== "zone"
                              ? zoneLabel(event.zone, text)
                              : text.where}
                        </small>
                      </span>
                      <span className="lb-feed-tail">
                        {gain != null ? (
                          <b className="lb-number" title={precise(lang, gain)}>
                            +{compact(lang, gain / FIXED_SCALE)}
                          </b>
                        ) : null}
                        <time dateTime={new Date(event.at).toISOString()}>{formatClock(event.at)}</time>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          ) : null}
        </div>
        <div className="lb-col">
          {Object.keys(session.zones).length > 0 ? (
            <Panel title={text.where} icon={DATA_ICONS.place}>
              <ul className="lb-data-list lb-places">
                {Object.values(session.zones)
                  .sort((a, b) => b.ms - a.ms)
                  .map((zone) => {
                    const current = session.endedAt == null && zone.id === session.currentZone;
                    const ms =
                      zone.ms + (current && session.zoneSince != null ? Math.max(0, now - session.zoneSince) : 0);
                    const info = worldName(zone.id);
                    return (
                      <li key={zone.id}>
                        <ContentMark content={info?.content ?? "unknownSource"} />
                        <div className="lb-data-copy">
                          <strong>
                            {zoneLabel(zone.id, text)}
                            {current ? ` · ${text.now}` : ""}
                          </strong>
                          <small>
                            {info != null ? text[info.content] : text.unknownZone}
                            {info?.tier != null ? ` · T${info.tier}` : ""}
                          </small>
                        </div>
                        <span className="lb-place-time lb-number">
                          {duration(lang, ms)}
                          {elapsed > 0 ? <small>({percent(lang, ms / elapsed)})</small> : null}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </Panel>
          ) : null}
          {session.chestCount > 0 ? (
            <Panel title={text.chestsOpened} icon={DATA_ICONS.chest} subtitle={text.chestCount(session.chestCount)}>
              <ChestSummary session={session} text={text} lang={lang} />
              <ul className="lb-data-list">
                {session.chests
                  .slice(-5)
                  .reverse()
                  .map((chest, index) => (
                    <li key={index}>
                      <span className="lb-tile" data-rarity={chest.rarity ?? "unknown"}>
                        <ChestIcon rarity={chest.rarity} size={24} />
                      </span>
                      <div className="lb-data-copy">
                        <strong>{chestLabel(chest.rarity, text)}</strong>
                        <small>{zoneLabel(chest.zone, text)}</small>
                      </div>
                      <time dateTime={new Date(chest.at).toISOString()}>{formatClock(chest.at)}</time>
                    </li>
                  ))}
              </ul>
              <PveLink text={text} />
            </Panel>
          ) : null}
          <Panel title={text.session} icon={SESSION}>
            <dl className="lb-session-info">
              <div>
                <dt>{text.started}</dt>
                <dd>{formatClock(session.startedAt)}</dd>
              </div>
              <div>
                <dt>{text.length}</dt>
                <dd>{duration(lang, elapsed)}</dd>
              </div>
              <div>
                <dt>{text.zones}</dt>
                <dd>{formatCount(lang, Object.keys(session.zones).length)}</dd>
              </div>
            </dl>
            {session.files.length > 0 ? (
              <button type="button" className="lb-text-action" onClick={onReveal}>
                <Icon paths={FOLDER} />
                {text.files}
                <Icon paths={CHEVRON} />
              </button>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
};
