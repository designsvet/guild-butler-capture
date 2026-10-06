/** Engine v1 JSONL and capture CSV contracts. Fixed-point fields stay integers until display. */
type TBase = { v: 1; at: number; char: string | null; zone: string | null };
export type TActivityEvent = TBase &
  (
    | { t: "zone"; items: "live" | "none"; fame_total?: number }
    | { t: "fame"; gain: number; total?: number; premium: boolean }
    | { t: "silver"; yield: number; cluster_tax: number; guild_tax: number; alliance_tax: number; premium: boolean }
    | { t: "respec"; gained: number; paid: number }
    | {
        t: "might";
        might: number;
        might_bonus: number;
        might_premium: number;
        favor: number;
        favor_bonus: number;
        favor_premium: number;
      }
    | { t: "faction"; city: number; gained: number; total?: number }
    | { t: "kill"; mob: number; hp: number | null }
    | { t: "harvest"; item: string | null; index: number; std: number; bonus: number; premium: number }
    | { t: "fish"; outcome: "landed" | "escaped"; catch?: { item: string | null; index: number; qty: number }[] }
    | { t: "chest"; name: string | null; rarity: number | null }
  );
export type TLootEvent = {
  t: "loot";
  at: number;
  looter: string;
  item: string;
  name: string;
  qty: number;
  from: string;
  server: string;
};
export type TSessionEvent = TActivityEvent | TLootEvent;

const object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const unsigned = (value: unknown): value is number => integer(value) && value >= 0;
const nullableText = (value: unknown): boolean => value === null || typeof value === "string";
const numbers = (row: Record<string, unknown>, keys: string[], signed = false): boolean =>
  keys.every((key) => (signed ? integer(row[key]) : unsigned(row[key])));

/** Invalid/future-version lines are refused, never partially tallied as zero. The caller logs the refusal. */
export const parseActivityLine = (line: string): TActivityEvent | null => {
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (!object(row) || row.v !== 1 || !unsigned(row.at) || !nullableText(row.char) || !nullableText(row.zone)) {
    return null;
  }
  let valid = false;
  switch (row.t) {
    case "zone": {
      valid =
        typeof row.zone === "string" &&
        (row.items === "live" || row.items === "none") &&
        (row.fame_total === undefined || unsigned(row.fame_total));
      break;
    }
    case "fame": {
      valid =
        unsigned(row.gain) && typeof row.premium === "boolean" && (row.total === undefined || unsigned(row.total));
      break;
    }
    case "silver": {
      valid = numbers(row, ["yield", "cluster_tax", "guild_tax", "alliance_tax"]) && typeof row.premium === "boolean";
      break;
    }
    case "respec": {
      valid = numbers(row, ["gained", "paid"], true);
      break;
    }
    case "might": {
      valid = numbers(row, ["might", "might_bonus", "might_premium", "favor", "favor_bonus", "favor_premium"], true);
      break;
    }
    case "faction": {
      valid = numbers(row, ["city", "gained"], true) && (row.total === undefined || unsigned(row.total));
      break;
    }
    case "kill": {
      valid = unsigned(row.mob) && (row.hp === null || unsigned(row.hp));
      break;
    }
    case "harvest": {
      valid = nullableText(row.item) && numbers(row, ["index", "std", "bonus", "premium"]);
      break;
    }
    case "fish": {
      valid =
        (row.outcome === "escaped" &&
          (row.catch === undefined || (Array.isArray(row.catch) && row.catch.length === 0))) ||
        (row.outcome === "landed" &&
          Array.isArray(row.catch) &&
          row.catch.every(
            (item: unknown) => object(item) && nullableText(item.item) && unsigned(item.index) && unsigned(item.qty),
          ));
      break;
    }
    case "chest": {
      valid = nullableText(row.name) && (row.rarity === null || unsigned(row.rarity));
      break;
    }
  }
  return valid ? (row as TActivityEvent) : null;
};

export const parseLootLine = (line: string): TLootEvent | null => {
  const parts = line.trim().split(";");
  if (parts.length !== 11) {
    return null;
  }
  const [stamp, , , looter, item, name, quantity, , , from, server] = parts;
  const at = Date.parse(stamp ?? "");
  const qty = Number(quantity);
  if (!Number.isFinite(at) || !looter || !item || !name || !unsigned(qty) || qty === 0) {
    return null;
  }
  return { t: "loot", at, looter, item, name, qty, from: from ?? "", server: server ?? "" };
};

export const isSessionFile = (name: string): boolean => /^(activity-events-.+\.jsonl|loot-events-.+\.txt)$/i.test(name);
export const isLootHeader = (line: string): boolean => line.toLowerCase().startsWith("timestamp_utc;");
