import { mobTotal, type TSession } from "./model.js";
import { worldName } from "./names.js";

export const hasPve = (session: TSession | null): boolean =>
  session != null && (mobTotal(session) > 0 || session.chestCount > 0);

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
