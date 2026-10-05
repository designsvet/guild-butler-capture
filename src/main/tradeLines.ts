/**
 * The trade journal's lines, as this app reads them before any of them leaves the machine (raid-bot
 * ADR 0168, Q69; the build plan's "trade-events file, contract v1").
 *
 * The engine (designsvet/ao-loot-logger#20, `src/trades/`) writes one JSON object per FINISHED
 * player-to-player trade into `trade-events-<stamp>.jsonl` beside the loot log. That file is the
 * member's own journal and holds more than the guild gets. What may go to the bot is decided here,
 * line by line, and only in the member's favour:
 *
 *  - **Only record v1, and only its keys** — top level and inside `self`, `partner` and every stack
 *    of `gave` / `got`. A key this list does not name (a crafter, an object id, durability, a field
 *    a later engine adds) withholds the whole line rather than being stripped from it: the app never
 *    re-serialises a line, so what is sent is the engine's text byte for byte, and what is not
 *    exactly v1 is not sent at all. A line that is not JSON, or is longer than a trade can be, the
 *    same. Each is counted (uploader.ts `withheld`) and named in the app log by its reason, never
 *    by its content.
 *  - **Checked on the text that is sent, not only on its parse.** A parse keeps the last copy of a
 *    repeated key, but the text — every copy in it — is what would leave. So the keys must stand in
 *    the engine's order, and the line must be exactly what `JSON.stringify` makes of its own parse,
 *    as the engine's every line is: a repeated key, padding or an escape the engine never writes
 *    withholds the line.
 *  - **Silver-only trades are not uploaded** (the ruling's default 1): a line whose `gave` and `got`
 *    are both empty moved silver and nothing else. The silver that comes back in an ITEM trade IS
 *    uploaded, as part of its line (owner, 2026-10-05: "yes upload the silver") — a sale of loot is
 *    what the check exists to catch.
 *  - **Names the game hides stay hidden** (default 3): the engine writes a hidden partner as
 *    `{name: null, guild: null, hidden: true}`. A line saying hidden with a name or guild in it is
 *    withheld — it would be the one place a masked name could leave.
 *
 * A withheld line keeps its index in the file (uploadPlan.ts `TStreamLine`), so every later line
 * keeps the index the bot's `(run, line)` key holds it by.
 *
 * Pure: no fs, no Electron. tradeUpload.ts puts it on the wire.
 */

import type { TStreamLine } from "./uploadPlan.js";

/** Why a trade line is not sent. The values are the app log's words and the uploader's counter keys. */
export enum ETradeWithheld {
  /** Nothing but silver moved (or nothing at all): the member's own business, never uploaded. */
  SilverOnly = "silver-only",
  /**
   * Not record v1 exactly — not JSON, a key off the allow-list, missing or out of order, a value of
   * the wrong kind, or text that is not what the engine writes (a repeated key, padding).
   */
  Refused = "refused",
}

/**
 * The longest trade line this app sends (UTF-16 units, as the bot counts). A trade's line grows
 * with its stacks — ~70 characters each, two windows of them — and the loot route's 2,000 is about
 * what two full windows reach, so the trade route has its own, well above anything a trade window
 * holds. A longer line is withheld whole: truncating JSON sends garbage, and the loot rule of
 * clamping exists only to keep an index that withholding keeps anyway. Cross-repo constant: the
 * bot's trade route (uploadClient.ts `uploadTradeBatch`) must take a line this long.
 */
export const MAX_TRADE_LINE_LENGTH = 8000;

/** Record v1's keys, in the order the engine writes them (src/trades/player-trades.js `buildRecord`). */
export const TRADE_RECORD_KEYS = [
  "v",
  "t",
  "at",
  "server",
  "zone",
  "tradeId",
  "initiator",
  "self",
  "partner",
  "revision",
  "acceptedRevision",
  "complete",
  "gave",
  "got",
  "silverGave",
  "silverGot",
] as const;
export const TRADE_SELF_KEYS = ["name", "guild", "alliance"] as const;
export const TRADE_PARTNER_KEYS = ["name", "guild", "hidden"] as const;
export const TRADE_STACK_KEYS = ["index", "item", "qty", "quality"] as const;

/** The `server` values every bot-bound line carries (festivities, energy): the engine's region token. */
const SERVERS: ReadonlySet<unknown> = new Set(["europe", "americas", "asia", null]);
const INITIATORS: ReadonlySet<unknown> = new Set(["self", "partner", null]);

type TRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is TRecord =>
  typeof value === "object" && value != null && !Array.isArray(value);

/**
 * Null when `value` is an object with exactly these keys in exactly this order (the contract's
 * "field order exact"), else what is wrong — the first unknown key, the first missing one, or the
 * order. Key NAMES only reach the log, never values.
 */
const keyProblem = (value: unknown, keys: readonly string[], where: string): string | null => {
  if (!isRecord(value)) {
    return `${where} is not an object`;
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      // The key's own text, capped: an engine-written name, but a log line is no place for 2 KB.
      return `unknown key ${where === "line" ? "" : `${where}.`}${key.slice(0, 40)}`;
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return `missing key ${where === "line" ? "" : `${where}.`}${key}`;
    }
  }
  if (Object.keys(value).join(",") !== keys.join(",")) {
    return where === "line" ? "keys out of order" : `${where} keys out of order`;
  }
  return null;
};

const isText = (value: unknown): boolean => typeof value === "string" || value === null;
const isCount = (value: unknown): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isRevision = (value: unknown): boolean => value === null || isCount(value);

/** What is wrong with one stack of `gave` / `got`, or null. */
const stackProblem = (stack: unknown, where: string): string | null => {
  const keys = keyProblem(stack, TRADE_STACK_KEYS, where);
  if (keys != null) {
    return keys;
  }
  const { index, item, qty, quality } = stack as TRecord;
  if (!isCount(index) || typeof item !== "string" || !isCount(qty) || !isCount(quality)) {
    return `${where} has a value of the wrong kind`;
  }
  return null;
};

export type TTradeVerdict =
  | { ok: true }
  | { ok: false; reason: ETradeWithheld; why: string | null };

/**
 * May this line of the trade journal go to the bot? `ok` means: send the line's text as it is.
 *
 * Shape before content, all of it before the silver-only rule — a line that is not v1 is counted
 * as refused whatever it moved, so the refused counter is the one that says the engine and this
 * app disagree.
 */
export const tradeLineVerdict = (raw: string): TTradeVerdict => {
  const refuse = (why: string): TTradeVerdict => ({ ok: false, reason: ETradeWithheld.Refused, why });
  if (raw.length > MAX_TRADE_LINE_LENGTH) {
    return refuse(`longer than ${MAX_TRADE_LINE_LENGTH} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse("not JSON");
  }
  const top = keyProblem(parsed, TRADE_RECORD_KEYS, "line");
  if (top != null) {
    return refuse(top);
  }
  const line = parsed as TRecord;
  if (line.v !== 1 || line.t !== "trade") {
    return refuse("not a v1 trade record");
  }
  const self = keyProblem(line.self, TRADE_SELF_KEYS, "self");
  if (self != null) {
    return refuse(self);
  }
  const partner = keyProblem(line.partner, TRADE_PARTNER_KEYS, "partner");
  if (partner != null) {
    return refuse(partner);
  }
  if (!Array.isArray(line.gave) || !Array.isArray(line.got)) {
    return refuse("gave or got is not a list");
  }
  for (const [side, stacks] of [
    ["gave", line.gave],
    ["got", line.got],
  ] as const) {
    for (const stack of stacks as unknown[]) {
      const problem = stackProblem(stack, side);
      if (problem != null) {
        return refuse(problem);
      }
    }
  }
  const me = line.self as TRecord;
  const them = line.partner as TRecord;
  if (
    typeof line.at !== "string" ||
    !SERVERS.has(line.server) ||
    !isText(line.zone) ||
    !isCount(line.tradeId) ||
    !INITIATORS.has(line.initiator) ||
    !isText(me.name) ||
    !isText(me.guild) ||
    !isText(me.alliance) ||
    !isText(them.name) ||
    !isText(them.guild) ||
    typeof them.hidden !== "boolean" ||
    !isRevision(line.revision) ||
    !isRevision(line.acceptedRevision) ||
    typeof line.complete !== "boolean" ||
    !isCount(line.silverGave) ||
    !isCount(line.silverGot)
  ) {
    return refuse("a value of the wrong kind");
  }
  if (them.hidden === true && (them.name !== null || them.guild !== null)) {
    return refuse("a hidden partner with a name or guild");
  }
  // Last of the shape, the text itself: every check above read the parse, but the text is what is
  // sent. `{"name":"Leaked",…,"name":null,"guild":null,"hidden":true}` parses as a hidden partner
  // with the name still in its bytes; the engine writes each line with JSON.stringify, so its line
  // is exactly what JSON.stringify makes of the parse — and a line that is not is not the engine's.
  if (JSON.stringify(parsed) !== raw) {
    return refuse("not the engine's own text");
  }
  if ((line.gave as unknown[]).length === 0 && (line.got as unknown[]).length === 0) {
    return { ok: false, reason: ETradeWithheld.SilverOnly, why: null };
  }
  return { ok: true };
};

/** One line → what the uploader sends: the text itself, or withheld (with a reason the log may name). */
export const tradeStreamLine = (raw: string): TStreamLine => {
  const verdict = tradeLineVerdict(raw);
  if (verdict.ok) {
    return raw;
  }
  return verdict.why == null ? { withheld: verdict.reason } : { withheld: verdict.reason, why: verdict.why };
};
