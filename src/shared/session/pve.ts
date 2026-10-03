import { mobTotal, type TSession } from "./model.js";
import { worldName } from "./names.js";

export const hasPve = (session: TSession | null): boolean =>
  session != null && (mobTotal(session) > 0 || session.chestCount > 0);

/** Rarity totals use every visit, including unplaced events, rather than the latest 61 chests. */
export const chestRarities = (session: TSession): { rarity: number | null; count: number }[] => {
  const counts = new Map<number | null, number>([1, 2, 3, 4].map((rarity) => [rarity, 0]));
  for (const visit of session.visits) {
    for (const [key, count] of Object.entries(visit.rarities)) {
      const value = Number(key);
      const rarity = [1, 2, 3, 4].includes(value) ? value : null;
      counts.set(rarity, (counts.get(rarity) ?? 0) + count);
    }
  }
  return [...counts].sort(([a], [b]) => (a ?? 5) - (b ?? 5)).map(([rarity, count]) => ({ rarity, count }));
};

/** The counts come from the main snapshot, not the bounded activity feed. */
export const pveVisits = (session: TSession) =>
  session.visits
    .map((visit, index) => ({ ...visit, index, content: worldName(visit.zone)?.content ?? ("unknownSource" as const) }))
    .filter((visit) => visit.kills > 0 || visit.chests > 0);

export const pveMobs = (session: TSession, sort: "kills" | "recent") =>
  Object.entries(session.mobs)
    .map(([id, kills]) => ({ id: Number(id), kills, last: session.mobLast[id]! }))
    .sort(
      (a, b) => (sort === "kills" ? b.kills - a.kills : b.last.at - a.last.at) || b.last.at - a.last.at || a.id - b.id,
    );
