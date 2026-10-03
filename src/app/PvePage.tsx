import { useState } from "react";
import type { TLang } from "../shared/i18n.js";
import { formatCount, LOCALE_OF } from "../shared/plural.js";
import { pveStrings } from "../shared/pveStrings.js";
import { sessionStrings } from "../shared/sessionStrings.js";
import { FIXED_SCALE, mobTotal, type TSession } from "../shared/session/model.js";
import { mobInfo, mobName } from "../shared/session/names.js";
import { pveMobs, pveVisits } from "../shared/session/pve.js";
import { ChestIcon, MobIcon } from "./AlbionIcon.js";
import { DATA_ICONS, Icon, INFO } from "./icons.js";
import {
  chestLabel,
  ChestSummary,
  compact,
  ContentMark,
  duration,
  hourly,
  Panel,
  precise,
  Stat,
  zoneLabel,
} from "./SessionParts.js";

export const PvePage = ({ session, lang, now }: { session: TSession; lang: TLang; now: number }) => {
  const text = sessionStrings(lang);
  const words = pveStrings(lang);
  const clock = (at: number) =>
    new Intl.DateTimeFormat(LOCALE_OF[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<"kills" | "recent">("kills");
  const visits = pveVisits(session);
  const contents = [...new Set(visits.map((visit) => visit.content))];
  const shown = visits.filter((visit) => filter === "all" || visit.content === filter);
  const mobs = pveMobs(session, sort);
  const most = pveMobs(session, "kills")[0];
  const last = pveMobs(session, "recent")[0];
  const sum = (key: "kills" | "chests") => shown.reduce((total, visit) => total + visit[key], 0);
  const currency = (raw: number | null) => (raw == null ? "—" : compact(lang, raw / FIXED_SCALE));
  const elapsed = (visit: (typeof visits)[number]) =>
    visit.startedAt == null ? null : Math.max(0, (visit.endedAt ?? session.endedAt ?? now) - visit.startedAt);
  const name = (id: number) => mobName(id, lang) ?? `${text.unknownMob} (${id})`;
  const broken = session.refused > 0 || Object.values(session.audits).some((audit) => audit.mismatches > 0);
  const sessionElapsed = Math.max(0, (session.endedAt ?? now) - session.startedAt);
  return (
    <div className="lb-pve" data-pve-data="" data-session-id={session.id}>
      {broken ? (
        <p role="status" className="lb-data-warning">
          <Icon paths={INFO} />
          {text.auditWarning}
        </p>
      ) : null}
      <div className="lb-pve-stats lb-stats">
        {(["fame", "respec", "silver", "kills", "might", "favor"] as const).flatMap((metric) => {
          const raw = metric === "kills" ? mobTotal(session) : session.totals[metric];
          if (raw == null || (metric !== "kills" && raw === 0)) {
            return [];
          }
          return [
            <Stat
              key={metric}
              metric={metric}
              label={metric === "kills" ? words.mobsKilled : text[metric]}
              raw={raw}
              value={metric === "kills" ? formatCount(lang, raw) : currency(raw)}
              exact={metric === "kills" ? formatCount(lang, raw) : precise(lang, raw)}
              rate={metric === "kills" ? undefined : hourly(raw, sessionElapsed)}
              rateText={text.perHour(compact(lang, hourly(raw, sessionElapsed) ?? 0))}
            />,
          ];
        })}
      </div>
      <p className="lb-pve-note">{words.sessionCurrencies}</p>
      <Panel
        title={words.whereHappened}
        subtitle={visits.every((visit) => visit.startedAt != null) ? words.visits(visits.length) : undefined}
        icon={DATA_ICONS.place}
      >
        <div className="lb-pve-toolbar">
          <span>{words.byContent}</span>
          <div className="lb-pve-filters" role="group" aria-label={words.content}>
            {["all", ...contents].map((content) => (
              <button
                type="button"
                key={content}
                aria-pressed={filter === content}
                data-pve-filter={content}
                onClick={() => setFilter(content)}
              >
                {content !== "all" ? <ContentMark content={content} /> : null}
                {content === "all" ? words.all : text[content as (typeof contents)[number]]}
              </button>
            ))}
          </div>
        </div>
        <table className="lb-pve-visits" aria-label={words.whereHappened}>
          <thead>
            <tr>
              <th className="lb-pve-when">{words.when}</th>
              <th className="lb-pve-content">{words.content}</th>
              <th>{text.where}</th>
              <th className="lb-pve-time">{words.time}</th>
              <th>{text.mobs}</th>
              <th className="lb-pve-currency">{text.fame}</th>
              <th className="lb-pve-currency">{text.silver}</th>
              <th>{text.chests}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((visit) => {
              const ms = elapsed(visit);
              const timing = ms == null ? "—" : duration(lang, ms);
              return (
                <tr
                  key={visit.index}
                  data-pve-visit=""
                  data-kills={visit.kills}
                  data-chests={visit.chests}
                  data-content={visit.content}
                >
                  <td className="lb-pve-when">
                    <span className="lb-number">{visit.startedAt == null ? "—" : clock(visit.startedAt)}</span>
                    <span
                      className="lb-pve-inline-time lb-pve-secondary"
                      title={ms == null ? words.unplaced : words.time}
                    >
                      {timing}
                    </span>
                  </td>
                  <td className="lb-pve-content">
                    <ContentMark content={visit.content} />
                    {text[visit.content]}
                  </td>
                  <td className="lb-pve-place">
                    <span>{zoneLabel(visit.zone, text)}</span>
                    <span className="lb-pve-inline-content lb-pve-secondary">
                      <ContentMark content={visit.content} />
                      {text[visit.content]}
                    </span>
                    <span className="lb-pve-inline-currency lb-pve-secondary">
                      {text.fame} {currency(visit.fame)} · {text.silver} {currency(visit.silver)}
                    </span>
                    {visit.startedAt == null ? <span className="lb-pve-secondary">{words.unplaced}</span> : null}
                  </td>
                  <td className="lb-pve-time lb-number">{timing}</td>
                  <td className="lb-number">{formatCount(lang, visit.kills)}</td>
                  <td
                    className="lb-pve-currency lb-number"
                    title={visit.fame == null ? undefined : precise(lang, visit.fame)}
                  >
                    {currency(visit.fame)}
                  </td>
                  <td
                    className="lb-pve-currency lb-number"
                    title={visit.silver == null ? undefined : precise(lang, visit.silver)}
                  >
                    {currency(visit.silver)}
                  </td>
                  <td
                    className="lb-number"
                    title={Object.entries(visit.rarities)
                      .map(([rarity, n]) => `${chestLabel(Number(rarity), text)} ×${formatCount(lang, n)}`)
                      .join(" · ")}
                  >
                    {formatCount(lang, visit.chests)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="lb-pve-total">
          <span>
            {words.totals}
            {shown.every((visit) => visit.startedAt != null) ? ` · ${words.visits(shown.length)}` : ""}
          </span>
          <span className="lb-number" data-pve-visit-kills="">
            {text.killCount(sum("kills"))} · {text.chestCount(sum("chests"))}
          </span>
        </div>
        <p className="lb-pve-caption">{words.visitCurrencies}</p>
      </Panel>
      <div className={mobs.length > 0 ? "lb-pve-columns" : "lb-pve-columns lb-pve-columns--single"}>
        {mobs.length > 0 ? (
          <Panel
            title={words.mobsKilled}
            subtitle={`${text.killCount(mobTotal(session))} · ${words.kinds(mobs.length)}`}
            nativeIcon="kills"
          >
            <div className="lb-pve-toolbar">
              <span>{words.sort}</span>
              <div className="lb-pve-filters" role="group" aria-label={words.sort}>
                {(["kills", "recent"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    data-pve-sort={value}
                    aria-pressed={sort === value}
                    onClick={() => setSort(value)}
                  >
                    {words[value]}
                  </button>
                ))}
              </div>
            </div>
            <ul className="lb-pve-mobs">
              {mobs.map((mob) => {
                const info = mobInfo(mob.id);
                return (
                  <li key={mob.id} data-pve-mob={mob.id} data-kills={mob.kills} data-last={mob.last.at}>
                    <span className="lb-tile lb-pve-mob-well">
                      <MobIcon mob={mob.id} />
                    </span>
                    <span className="lb-pve-mob-name">
                      <b>{name(mob.id)}</b>
                      {info?.tier != null ? <span className="lb-pve-secondary">T{info.tier}</span> : null}
                      <span className="lb-pve-inline-location lb-pve-secondary">{zoneLabel(mob.last.zone, text)}</span>
                    </span>
                    <span className="lb-number">{formatCount(lang, mob.kills)}</span>
                    <span className="lb-pve-mob-location lb-pve-secondary">{zoneLabel(mob.last.zone, text)}</span>
                    <time className="lb-number" dateTime={new Date(mob.last.at).toISOString()} title={words.last}>
                      {clock(mob.last.at)}
                    </time>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}
        <div className="lb-pve-aside">
          {most != null && last != null ? (
            <Panel title={words.standingOut} nativeIcon="kills">
              <ul className="lb-pve-standouts">
                {[
                  { label: words.mostKilled, mob: most },
                  { label: words.lastKill, mob: last },
                ].map(({ label, mob }) => (
                  <li key={label}>
                    <span className="lb-tile">
                      <MobIcon mob={mob.id} />
                    </span>
                    <span>
                      <span className="lb-pve-secondary">{label}</span>
                      <b>{name(mob.id)}</b>
                      <span className="lb-pve-secondary">{zoneLabel(mob.last.zone, text)}</span>
                    </span>
                    <span className="lb-number">
                      {label === words.mostKilled ? `×${formatCount(lang, mob.kills)}` : clock(mob.last.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {session.chestCount > 0 ? (
            <Panel title={text.chestsOpened} subtitle={text.chestCount(session.chestCount)} icon={DATA_ICONS.chest}>
              <ChestSummary session={session} text={text} lang={lang} />
              {session.chestCount > session.chests.length ? (
                <p className="lb-pve-caption">{words.recentChests}</p>
              ) : null}
              <ul className="lb-pve-chests">
                {[...session.chests]
                  .sort((a, b) => b.at - a.at)
                  .map((chest, index) => (
                    <li key={index}>
                      <span className="lb-tile" data-rarity={chest.rarity ?? "unknown"}>
                        <ChestIcon rarity={chest.rarity} />
                      </span>
                      <span>
                        <b>{chestLabel(chest.rarity, text)}</b>
                        <span className="lb-pve-secondary">{zoneLabel(chest.zone, text)}</span>
                      </span>
                      <time className="lb-number" dateTime={new Date(chest.at).toISOString()}>
                        {clock(chest.at)}
                      </time>
                    </li>
                  ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
};
