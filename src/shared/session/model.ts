import type { TLootEvent, TSessionEvent } from "./events.js";

export const FIXED_SCALE = 10_000;
export const FEED_LIMIT = 61;
export type TMetric =
  "fame" | "respec" | "respecPaid" | "silver" | "silverGross" | "silverTax" | "might" | "favor" | "faction";
export type TTotals = Record<TMetric, number | null>;
export type TZoneStats = {
  id: string;
  visits: number;
  ms: number;
  fame: number;
  silver: number;
  kills: number;
  chests: number;
};
export type TItemQuantity = { item: string | null; index: number | null; qty: number };
export type TLooter = {
  name: string;
  pickups: number;
  qty: number;
  items: Record<string, { item: string; name: string; qty: number }>;
};
export type TAudit = {
  total: number | null;
  gain: number;
  spans: number;
  mismatches: number;
  character: string | null;
};
export type TSession = {
  v: 1;
  id: string;
  startedAt: number;
  endedAt: number | null;
  lastAt: number;
  character: string | null;
  /** Carried state at a manual boundary; summaries can be rebuilt from this context and their raw ranges. */
  context: { character: string | null; zone: string | null; audits: Record<string, TAudit> };
  totals: TTotals;
  unlocated: { fame: number; silver: number };
  events: number;
  activityLines: number;
  lootLines: number;
  zones: Record<string, TZoneStats>;
  currentZone: string | null;
  zoneSince: number | null;
  mobs: Record<string, number>;
  harvests: Record<string, TItemQuantity>;
  catches: Record<string, TItemQuantity>;
  fishing: { landed: number; escaped: number };
  chests: { at: number; zone: string | null; name: string | null; rarity: number | null }[];
  chestCount: number;
  looters: Record<string, TLooter>;
  feed: TSessionEvent[];
  recentLoot: TLootEvent[];
  audits: Record<string, TAudit>;
  /** Unknown IDs/refused lines stay visible; the raw files remain the truth. */
  refused: number;
  files: { path: string; originByte: number; fromByte: number; toByte: number; fromLine: number; toLine: number }[];
};

export const newSession = (id: string, at: number, character: string | null = null): TSession => ({
  v: 1,
  id,
  startedAt: at,
  endedAt: null,
  lastAt: at,
  character,
  context: { character, zone: null, audits: {} },
  totals: {
    fame: null,
    respec: null,
    respecPaid: null,
    silver: null,
    silverGross: null,
    silverTax: null,
    might: null,
    favor: null,
    faction: null,
  },
  unlocated: { fame: 0, silver: 0 },
  events: 0,
  activityLines: 0,
  lootLines: 0,
  zones: {},
  currentZone: null,
  zoneSince: null,
  mobs: {},
  harvests: {},
  catches: {},
  fishing: { landed: 0, escaped: 0 },
  chests: [],
  chestCount: 0,
  looters: {},
  feed: [],
  recentLoot: [],
  audits: {},
  refused: 0,
  files: [],
});
const emptyZone = (id: string): TZoneStats => ({ id, visits: 0, ms: 0, fame: 0, silver: 0, kills: 0, chests: 0 });
export const restartSession = (previous: TSession, id: string, at: number): TSession => {
  const audits = Object.fromEntries(
    Object.entries(previous.audits).map(([stream, audit]) => [stream, { ...audit, spans: 0, mismatches: 0 }]),
  );
  const zone = previous.currentZone;
  return {
    ...newSession(id, at, previous.character),
    context: { character: previous.character, zone, audits },
    audits,
    currentZone: zone,
    zoneSince: zone == null ? null : at,
    zones: zone == null ? {} : { [zone]: { ...emptyZone(zone), visits: 1 } },
  };
};
const sumItem = (items: Record<string, TItemQuantity>, item: TItemQuantity): Record<string, TItemQuantity> => {
  const key = item.item ?? `index:${item.index}`;
  return {
    ...items,
    [key]: { ...item, qty: ((Object.hasOwn(items, key) ? items[key]?.qty : undefined) ?? 0) + item.qty },
  };
};

/** The reducer never deduplicates payloads: two identical fame gains can both be real. Tail offsets own once-only delivery. */
export const reduceSession = (state: TSession, ev: TSessionEvent, stream = "activity"): TSession => {
  if (state.endedAt != null) {
    return state;
  }
  const next: TSession = {
    ...state,
    lastAt: Math.max(state.lastAt, ev.at),
    events: state.events + 1,
    feed: [...state.feed, ev].slice(-FEED_LIMIT),
  };
  if (ev.t === "loot") {
    const previous = (Object.hasOwn(state.looters, ev.looter) ? state.looters[ev.looter] : undefined) ?? {
      name: ev.looter,
      pickups: 0,
      qty: 0,
      items: {},
    };
    const item = Object.hasOwn(previous.items, ev.item) ? previous.items[ev.item] : undefined;
    next.looters = {
      ...state.looters,
      [ev.looter]: {
        ...previous,
        pickups: previous.pickups + 1,
        qty: previous.qty + ev.qty,
        items: { ...previous.items, [ev.item]: { item: ev.item, name: ev.name, qty: (item?.qty ?? 0) + ev.qty } },
      },
    };
    next.lootLines += 1;
    next.recentLoot = [...state.recentLoot, ev].slice(-6);
    return next;
  }
  next.activityLines += 1;
  next.character = ev.char ?? state.character;
  const add = (key: TMetric, amount: number): void => {
    next.totals = { ...next.totals, [key]: (next.totals[key] ?? 0) + amount };
  };
  const zone =
    ev.zone != null
      ? { ...((Object.hasOwn(state.zones, ev.zone) ? state.zones[ev.zone] : undefined) ?? emptyZone(ev.zone)) }
      : null;
  switch (ev.t) {
    case "zone": {
      // A recovered older stream must not move the live location or start its clock in the past.
      if (ev.zone !== state.currentZone && (state.zoneSince == null || ev.at >= state.zoneSince)) {
        if (state.currentZone != null && state.zoneSince != null) {
          const previous =
            (Object.hasOwn(state.zones, state.currentZone) ? state.zones[state.currentZone] : undefined) ??
            emptyZone(state.currentZone);
          next.zones = {
            ...next.zones,
            [previous.id]: { ...previous, ms: previous.ms + Math.max(0, ev.at - state.zoneSince) },
          };
        }
        if (zone != null) {
          zone.visits += 1;
        }
        next.currentZone = ev.zone;
        next.zoneSince = ev.at;
      }
      const previous = Object.hasOwn(state.audits, stream) ? state.audits[stream] : undefined;
      // Each file is an engine run: joins in different files do not bracket a continuously observed span.
      const sameCharacter = previous != null && previous.character === ev.char;
      const checked = sameCharacter && previous.total != null && ev.fame_total != null;
      next.audits = {
        ...state.audits,
        [stream]: {
          total: ev.fame_total ?? null,
          gain: 0,
          character: ev.char,
          spans: (previous?.spans ?? 0) + (checked ? 1 : 0),
          mismatches:
            (previous?.mismatches ?? 0) + (checked && ev.fame_total! - previous.total! !== previous.gain ? 1 : 0),
        },
      };
      break;
    }
    case "fame": {
      add("fame", ev.gain);
      if (zone != null) {
        zone.fame += ev.gain;
      } else {
        next.unlocated = { ...state.unlocated, fame: state.unlocated.fame + ev.gain };
      }
      const audit = Object.hasOwn(state.audits, stream) ? state.audits[stream] : undefined;
      if (audit != null) {
        next.audits = { ...state.audits, [stream]: { ...audit, gain: audit.gain + ev.gain } };
      }
      break;
    }
    case "silver": {
      const tax = ev.cluster_tax + ev.guild_tax + ev.alliance_tax;
      const net = Math.max(0, ev.yield - tax);
      add("silverGross", ev.yield);
      add("silverTax", tax);
      add("silver", net);
      if (zone != null) {
        zone.silver += net;
      } else {
        next.unlocated = { ...state.unlocated, silver: state.unlocated.silver + net };
      }
      break;
    }
    case "respec": {
      add("respec", ev.gained);
      add("respecPaid", ev.paid);
      break;
    }
    case "might": {
      add("might", ev.might + ev.might_bonus + ev.might_premium);
      add("favor", ev.favor + ev.favor_bonus + ev.favor_premium);
      break;
    }
    case "faction": {
      // The same gain can occur in a might line's favor field: these are separate currencies.
      add("faction", ev.gained);
      break;
    }
    case "kill": {
      const key = String(ev.mob);
      next.mobs = { ...state.mobs, [key]: (state.mobs[key] ?? 0) + 1 };
      if (zone != null) {
        zone.kills += 1;
      }
      break;
    }
    case "harvest": {
      next.harvests = sumItem(state.harvests, { item: ev.item, index: ev.index, qty: ev.std + ev.bonus + ev.premium });
      break;
    }
    case "fish": {
      next.fishing = { ...state.fishing, [ev.outcome]: state.fishing[ev.outcome] + 1 };
      for (const item of ev.catch ?? []) {
        next.catches = sumItem(next.catches, { item: item.item, index: item.index, qty: item.qty });
      }
      break;
    }
    case "chest": {
      next.chestCount += 1;
      next.chests = [...state.chests, { at: ev.at, zone: ev.zone, name: ev.name, rarity: ev.rarity }].slice(-61);
      if (zone != null) {
        zone.chests += 1;
      }
      break;
    }
  }
  if (zone != null) {
    next.zones = { ...next.zones, [zone.id]: zone };
  }
  return next;
};

export const closeSession = (state: TSession, at: number): TSession => {
  if (state.endedAt != null) {
    return state;
  }
  const end = Math.max(state.lastAt, at);
  const zone = state.currentZone != null ? state.zones[state.currentZone] : null;
  return {
    ...state,
    endedAt: end,
    lastAt: end,
    zones:
      zone != null && state.zoneSince != null
        ? { ...state.zones, [zone.id]: { ...zone, ms: zone.ms + Math.max(0, end - state.zoneSince) } }
        : state.zones,
    zoneSince: null,
  };
};

export const quantityTotal = (items: Record<string, TItemQuantity>): number =>
  Object.values(items).reduce((sum, item) => sum + item.qty, 0);
export const mobTotal = (state: TSession): number => Object.values(state.mobs).reduce((sum, n) => sum + n, 0);
export const ownLoot = (state: TSession): TLooter | null =>
  state.character == null || !Object.hasOwn(state.looters, state.character)
    ? null
    : (state.looters[state.character] ?? null);
