/**
 * The engine adapter — the ONLY place that knows what ao-loot-logger prints.
 *
 * The app talks to the engine across a process boundary and reads its stdout/
 * stderr line by line; this module turns raw lines into typed events. That
 * boundary is deliberate: it is the GPL-3.0 licence seam (the engine stays its
 * own program), the crash-isolation seam (a decoder panic cannot take the app
 * down), and the ABI seam (the engine's native `cap` module never loads into
 * Electron's process).
 *
 * ✅ CONTRACT STATUS. Verified against a REAL recorded session on 2026-08-20
 * (tools/record-engine-output.mjs, engine banner "AO Loot Logger -
 * v0.0.0-development", macOS, Europe server, one loot pickup) — the recorded
 * lines live in test/fixtures/realEngineLines.ts and pin every pattern here:
 *   - "\tALBION DETECTED. Loot events should be logged."
 *   - "[status] character: Bors · lines written: 1" (every ~60s; before a zone
 *     change the character field is the PHRASE "not identified yet (change
 *     zone once)" — a phrase is never a name)
 *   - "Logs will be written to /…/loot-events-<timestamp>.txt" (ABSOLUTE path,
 *     spaces possible; the count in the heartbeat is data lines, header excluded)
 *   - recoverable "[warn]: error parsing photon packet …" + huge "[debug]"
 *     event dumps (EvNewLoot, EvNewCharacter, …) — all noise, never fatal
 * Still unrecorded: the exact "ALBION NOT DETECTED" line (the game was running)
 * — that pattern stays liberal. When the engine changes, re-record and extend
 * the fixtures rather than guessing. Everything unrecognised degrades to a
 * "noise" event — never a crash, never a wrong state.
 */

import { EEngineErrorKind } from "../shared/captureTypes.js";

/** One festivity as the bot's ingest wants it: epoch milliseconds, not .NET ticks. */
export type TFestivityEntry = {
  kind: number;
  category: string;
  uniqueName: string;
  startMs: number;
  endMs: number;
};

/**
 * One row of the guild's energy log, in this app's units: silver-style scaling divided out,
 * ticks turned into epoch milliseconds and FLOORED TO THE SECOND.
 *
 * The flooring is not tidiness. The game's own copyable log — the one an officer pastes into
 * Discord — is written to the second, and the bot de-duplicates its mirror on
 * (timestamp, player, kind, amount). Ticks carry sub-second precision, so an unfloored row
 * would never match the same row pasted by a human, and a guild running both paths would
 * store everything twice.
 *
 * `type` stays a number on purpose. This module's job is units; what a 2 or a 3 MEANS is the
 * bot's, where the rest of the log vocabulary already lives.
 */
export type TEnergyLogRow = {
  playerName: string;
  type: number;
  amount: number;
  happenedAt: number;
};

export type TEngineEvent =
  | { kind: "albion-detected" }
  | { kind: "albion-lost" }
  | { kind: "heartbeat"; character: string | null; linesWritten: number | null }
  /** One pickup, printed the moment it is written to the log. */
  | { kind: "loot" }
  | { kind: "character"; name: string }
  | { kind: "log-file"; file: string }
  | { kind: "festivities"; server: string | null; code: number | null; entries: TFestivityEntry[] }
  | {
      kind: "energy-log";
      server: string | null;
      albionGuildId: string | null;
      /** WHICH of the guild's logs this page is. The game serves several through one
       *  request in an identical shape, so the bot refuses a page that cannot name itself —
       *  dropping this field here means every page is refused, silently. */
      logType: number | null;
      rows: TEnergyLogRow[];
    }
  | {
      kind: "energy";
      server: string | null;
      guildName: string;
      allianceTag: string | null;
      albionGuildId: string | null;
      total: number;
      changed: boolean;
    }
  | { kind: "fatal"; errorKind: EEngineErrorKind; line: string }
  | { kind: "noise"; line: string };

/** Winston consoles colour their output; strip ANSI escapes before matching anything. */
const ANSI_RE = /\u001b\[[0-9;]*m/g;

export const stripAnsi = (line: string): string => {
  return line.replace(ANSI_RE, "");
};

/**
 * Albion character names are single tokens (letters/digits, no spaces), which
 * is what lets the liberal extraction below be safe: a multi-word field value
 * ("not identified yet (change zone once)") is a placeholder phrase, never a
 * name.
 */
const NAME = "[A-Za-z0-9_-]{2,32}";
const NAME_ONLY_RE = new RegExp(`^${NAME}$`);

/** Heartbeat placeholders that mean "not known yet", not a character called "unknown". */
const NAME_PLACEHOLDERS = new Set(["-", "?", "unknown", "none", "null", "n/a"]);

const cleanName = (raw: string | undefined): string | null => {
  const name = (raw ?? "").trim().replace(/^"|"$/g, "");
  if (!NAME_ONLY_RE.test(name) || NAME_PLACEHOLDERS.has(name.toLowerCase())) {
    return null;
  }
  return name;
};

// Detection events. NOT-detected is tested first: the two share the word
// DETECTED and a liberal pattern must never read a loss as a hit.
const NOT_DETECTED_RE = /albion(?:\s+online)?\s+not\s+detected/i;
const DETECTED_RE = /albion(?:\s+online)?\s+detected/i;

// The [status] heartbeat (a local patch of the fork). REAL SHAPE, recorded:
//   [status] character: Bors · lines written: 1
//   [status] character: not identified yet (change zone once) · lines written: 0
// The character value is captured up to the next field separator (·, |, or end
// of line) and then validated as a single name token, so the placeholder
// PHRASE above parses as "unknown" instead of as a character called "not".
// Keyword-based extraction keeps `character=X lines=42` style drift parsing.
const HEARTBEAT_MARK_RE = /\[status\]/i;
const HEARTBEAT_CHARACTER_RE = /char(?:acter)?\s*[:=]\s*"?([^·|]+?)"?\s*(?:[·|]|$)/i;
/** A value that runs into the next keyword-style field, e.g. "Borys lines=42". */
const CHARACTER_TRAILING_FIELD_RE = /^(\S+)\s+(?:lines?|rows?|events?)\b/i;
const HEARTBEAT_LINES_RE = /(?:lines?|rows?|events?)(?:\s+written)?\D{0,8}?(\d+)/i;

// Character announcements outside the heartbeat (join/login messages). The
// recorded engine names the character only via the heartbeat; kept for drift.
const CHARACTER_RE = new RegExp(`(?:logged in as|playing as|character(?: detected)?)\\s*[:=]?\\s*"?(${NAME})"?`, "i");

// Winston [debug]-family lines are raw event dumps (EvNewLoot, EvNewCharacter,
// UNPROCESSED_EVENT…) whose payloads contain arbitrary item and player strings.
// They must never be read as signals — EvNewCharacter is one "characterName:"
// away from a bogus character event — so the tag short-circuits to noise.
// Verified against the recording: no signal line carries one of these tags.
const DEBUG_TAG_RE = /\[(?:debug|verbose|silly)\]/i;

// One pickup, echoed to stdout as it is written. REAL SHAPE, recorded:
//   05:42:00 UTC: {UA} [VITRYLA] Bors looted 1x Expert's Rune from @MOB_MORGANA…
// The locale tag and the guild bracket are optional (a player with no guild
// prints neither), everything else is required.
//
// This one is deliberately STRICT where the others are liberal, and the reason
// is the direction of the failure: a missed loot line costs a second of
// counter lag until the next heartbeat, while a false one invents loot that
// never happened. So the shape is pinned end to end and the player token is
// then VALIDATED as a name — the heartbeat that parsed a character called
// "not" is the standing reminder that a liberal pattern fails by MATCHING.
const LOOT_RE = new RegExp(
  "^\\d{2}:\\d{2}:\\d{2}\\s+[A-Z]{2,5}:\\s+" + // 05:42:00 UTC:
    "(?:\\{[A-Za-z-]{2,8}\\}\\s*)?" + // {UA}
    "(?:\\[[^\\]]{0,32}\\]\\s*)?" + // [VITRYLA]
    `(${NAME})\\s+looted\\s+` + // Bors looted
    "(\\d{1,7})x\\s+" + // 1x
    "(.+?)\\s+from\\s+@?\\S", // Expert's Rune from @MOB_…
);

/** The recorded line, or null when anything about it fails to validate. */
const parseLoot = (line: string): TEngineEvent | null => {
  const m = LOOT_RE.exec(line);
  if (m == null) {
    return null;
  }
  const quantity = Number(m[2]);
  if (cleanName(m[1]) == null || !Number.isFinite(quantity) || quantity <= 0 || (m[3] ?? "").trim().length === 0) {
    return null;
  }
  return { kind: "loot" };
};

// The output file. REAL SHAPE, recorded: a startup announcement carrying the
// ABSOLUTE path, which may contain spaces — so the announcement line is
// matched first and the bare loot-events-<timestamp>.txt name (which the
// engine drops into its repo root) stays as the liberal fallback.
const LOG_ANNOUNCE_RE = /logs?\s+will\s+be\s+written\s+to\s+(.+?\.txt)\s*$/i;
const LOG_FILE_RE = /(loot-events-[\w.:-]+\.txt)/i;

/**
 * The daily bonus rotation (raid-bot ADR 0102), printed by the engine's FestivitiesUpdate
 * handler as `[festivities] {json}`. RECORDED: Europe, 2026-08-28, Photon event code 518
 * (test/fixtures/realEngineLines.ts).
 *
 * The engine prints .NET ticks verbatim — it reports what the wire said and interprets nothing —
 * so the unit change happens HERE, in the module whose job is knowing what the engine prints.
 * The engine already read the Photon int64 into a JS number, which is lossy above 2^53; at tick
 * magnitudes that is tens of microseconds, invisible in a countdown measured in days.
 */
const FESTIVITIES_MARK_RE = /\[festivities\]/i;
const ENERGY_MARK_RE = /\[energy\]/i;

/**
 * The wire scales a guild's siphoned energy by 10000, and the engine passes that through
 * unconverted for the same reason it passes ticks through: the wire's own encoding is the
 * reader's to interpret, and a scale applied in two places will one day disagree with itself.
 * So the division happens HERE, once, in the module whose job is knowing what the engine
 * prints. 1,291 energy arrives as 12910000.
 */
const ENERGY_SCALE = 10_000;
const ENERGY_LOG_MARK_RE = /\[energy-log\]/i;
const MAX_LOG_ROWS = 5_000;

/** Epoch ms for a .NET tick, floored to the second — see TEnergyLogRow for why. */
const ticksToSecondMs = (ticks: number): number => Math.floor((ticks - NET_EPOCH_TICKS) / 10_000_000) * 1000;

/** .NET ticks (100ns since 0001-01-01) at the Unix epoch. */
const NET_EPOCH_TICKS = 621_355_968_000_000_000;

const ticksToMs = (ticks: number): number => Math.round((ticks - NET_EPOCH_TICKS) / 10_000);

const parseFestivities = (line: string): TEngineEvent => {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) {
    return { kind: "noise", line };
  }
  try {
    const obj = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
    const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
    const entries: TFestivityEntry[] = [];
    for (const raw of rawEntries) {
      const row = raw as Record<string, unknown>;
      const start = row.startTicks;
      const end = row.endTicks;
      if (
        typeof row.kind !== "number" ||
        typeof row.category !== "string" ||
        typeof row.uniqueName !== "string" ||
        typeof start !== "number" ||
        typeof end !== "number"
      ) {
        // One malformed row voids the snapshot: it REPLACES the server's whole rotation on the
        // bot side, so a partial read would publish a rotation missing whatever failed to parse.
        // Note `category` is legitimately EMPTY on seasonal rows — that is recorded, not a fault.
        return { kind: "noise", line };
      }
      entries.push({
        kind: row.kind,
        category: row.category,
        uniqueName: row.uniqueName,
        startMs: ticksToMs(start),
        endMs: ticksToMs(end),
      });
    }
    if (entries.length === 0) {
      return { kind: "noise", line };
    }
    return {
      kind: "festivities",
      server: typeof obj.server === "string" ? obj.server : null,
      code: typeof obj.code === "number" ? obj.code : null,
      entries,
    };
  } catch {
    return { kind: "noise", line };
  }
};

/**
 * One guild-energy reading (raid-bot ADR 0022).
 *
 * Refused rather than rounded when the raw value is not a whole number of energy units. A
 * fraction means the scale is not what this build believes it is — a game patch, a different
 * currency in slot 0 — and a reading that is quietly 10000x wrong would be written into a
 * guild's history as fact and differenced from for weeks.
 */
const parseEnergy = (line: string): TEngineEvent => {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) {
    return { kind: "noise", line };
  }
  try {
    const obj = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
    const raw = obj.totalRaw;
    if (typeof obj.guildName !== "string" || obj.guildName.length === 0) {
      return { kind: "noise", line };
    }
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw % ENERGY_SCALE !== 0) {
      return { kind: "noise", line };
    }
    return {
      kind: "energy",
      server: typeof obj.server === "string" ? obj.server : null,
      guildName: obj.guildName,
      allianceTag: typeof obj.allianceTag === "string" ? obj.allianceTag : null,
      // Null until someone opens the guild screen in this session — the engine cannot get the
      // guild's own id from the state event, which carries the ALLIANCE id. The bot checks the
      // name against its binding when the id is absent, so this must stay honestly null rather
      // than fall back to something that merely looks like an id.
      albionGuildId: typeof obj.albionGuildId === "string" && obj.albionGuildId.length > 0 ? obj.albionGuildId : null,
      total: raw / ENERGY_SCALE,
      changed: obj.changed === true,
    };
  } catch {
    return { kind: "noise", line };
  }
};

/**
 * One page of the guild's energy log (raid-bot ADR 0022).
 *
 * A malformed ROW voids the page rather than being skipped. The bot appends these to a mirror
 * it de-duplicates by content, so a page that quietly arrives short leaves a hole no later
 * fetch will notice — the rows around it are already held, and nothing re-asks for the gap.
 */
const parseEnergyLog = (line: string): TEngineEvent => {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) {
    return { kind: "noise", line };
  }
  try {
    const obj = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
    const rawRows = Array.isArray(obj.rows) ? obj.rows : [];
    if (rawRows.length === 0 || rawRows.length > MAX_LOG_ROWS) {
      return { kind: "noise", line };
    }
    const rows: TEnergyLogRow[] = [];
    for (const raw of rawRows) {
      const row = raw as Record<string, unknown>;
      const amountRaw = row.amountRaw;
      const ticks = row.ticks;
      if (
        typeof row.playerName !== "string" ||
        row.playerName.length === 0 ||
        typeof row.type !== "number" ||
        !Number.isInteger(row.type) ||
        typeof amountRaw !== "number" ||
        !Number.isInteger(amountRaw) ||
        amountRaw % ENERGY_SCALE !== 0 ||
        typeof ticks !== "number" ||
        !Number.isFinite(ticks)
      ) {
        return { kind: "noise", line };
      }
      rows.push({
        playerName: row.playerName,
        type: row.type,
        amount: amountRaw / ENERGY_SCALE,
        happenedAt: ticksToSecondMs(ticks),
      });
    }
    return {
      kind: "energy-log",
      server: typeof obj.server === "string" ? obj.server : null,
      albionGuildId: typeof obj.albionGuildId === "string" && obj.albionGuildId.length > 0 ? obj.albionGuildId : null,
      logType: typeof obj.logType === "number" && Number.isInteger(obj.logType) ? obj.logType : null,
      rows,
    };
  } catch {
    return { kind: "noise", line };
  }
};

/**
 * Failure classification, most-specific first. Order matters twice:
 * - ABI before Npcap: a native-module load failure on Windows says "The
 *   specified module could not be found", which mentions no driver — but
 *   NODE_MODULE_VERSION / ERR_DLOPEN lines are unambiguous and must win.
 * - Npcap before permission: Npcap's own errors sometimes contain "access".
 */
//
// ORDER IS THE RULE HERE, and getting it wrong reached a real member: a bare
// `ERR_DLOPEN_FAILED` used to be listed as evidence of an ABI mismatch, and it
// is not evidence of anything. A .node fails to load both when it was built
// for another ABI *and* when a library it links against is missing — and on
// Windows the second is far more common, because `cap.node` links wpcap.dll
// and Npcap is a separate install we are not allowed to bundle.
//
// Windows words that as "The specified module could not be found", naming the
// addon it DID find rather than the dependency it did not, so nothing in the
// text says "npcap" at all. The member was shown "built for a different
// runtime — run pnpm engine:rebuild from the README": wrong, and impossible
// for someone who has never seen the repo. The specific pattern therefore
// comes FIRST, and the ABI rule keeps only markers that genuinely mean ABI.
const FATAL_RULES: ReadonlyArray<{ kind: EEngineErrorKind; re: RegExp }> = [
  // EXPLICIT ABI evidence still outranks everything: a line carrying
  // NODE_MODULE_VERSION is an ABI mismatch even when the path beside it says
  // npcap. What was removed from this rule is the bare ERR_DLOPEN_FAILED.
  {
    kind: EEngineErrorKind.AbiMismatch,
    re: /NODE_MODULE_VERSION|was compiled against a different Node\.js version/i,
  },
  {
    kind: EEngineErrorKind.NpcapMissing,
    re: /wpcap\.dll|npcap|winpcap|specified module could not be found|specified procedure could not be found/i,
  },
  {
    kind: EEngineErrorKind.Permission,
    re: /operation not permitted|permission denied|EPERM|EACCES|\/dev\/bpf|BIOC[A-Z]+|must be run as root|(?:need|requires?|try)\s+(?:running\s+(?:as|with)\s+)?(?:root|sudo)/i,
  },
  { kind: EEngineErrorKind.EngineMissing, re: /cannot find module/i },
];

export const classifyFatalLine = (line: string): EEngineErrorKind | null => {
  for (const rule of FATAL_RULES) {
    if (rule.re.test(line)) {
      return rule.kind;
    }
  }
  return null;
};

const parseHeartbeat = (line: string): TEngineEvent => {
  // A heartbeat may be JSON after the marker (the cheapest future-proofing the
  // engine side could adopt); try that before the keyword patterns.
  const jsonStart = line.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const obj = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
      const character = cleanName(typeof obj.character === "string" ? obj.character : undefined);
      const linesRaw = obj.lines ?? obj.linesWritten ?? obj.written;
      const linesWritten = typeof linesRaw === "number" && Number.isFinite(linesRaw) ? Math.floor(linesRaw) : null;
      return { kind: "heartbeat", character, linesWritten };
    } catch {
      // fall through to keyword extraction
    }
  }
  const field = HEARTBEAT_CHARACTER_RE.exec(line)?.[1]?.trim();
  const trailing = field != null ? CHARACTER_TRAILING_FIELD_RE.exec(field) : null;
  const character = cleanName(trailing != null ? trailing[1] : field);
  const linesMatch = HEARTBEAT_LINES_RE.exec(line)?.[1];
  const linesWritten = linesMatch != null ? Number(linesMatch) : null;
  return { kind: "heartbeat", character, linesWritten };
};

/** One raw engine line (either stream) → one typed event. Total: never throws. */
export const parseEngineLine = (raw: string): TEngineEvent => {
  const line = stripAnsi(raw).trim();
  if (line.length === 0) {
    return { kind: "noise", line: "" };
  }
  if (NOT_DETECTED_RE.test(line)) {
    return { kind: "albion-lost" };
  }
  if (DETECTED_RE.test(line)) {
    return { kind: "albion-detected" };
  }
  if (HEARTBEAT_MARK_RE.test(line)) {
    return parseHeartbeat(line);
  }
  if (FESTIVITIES_MARK_RE.test(line)) {
    return parseFestivities(line);
  }
  // The two patterns are disjoint — /\[energy\]/ needs the closing bracket, so it does not
  // match "[energy-log]" — but the more specific one is tested first anyway, so that stays
  // true if either pattern is ever loosened.
  if (ENERGY_LOG_MARK_RE.test(line)) {
    return parseEnergyLog(line);
  }
  if (ENERGY_MARK_RE.test(line)) {
    return parseEnergy(line);
  }
  if (DEBUG_TAG_RE.test(line)) {
    return { kind: "noise", line };
  }
  // Before the fatal scan: in a live session this is the most frequent line
  // there is, and its shape cannot collide with an error.
  const loot = parseLoot(line);
  if (loot != null) {
    return loot;
  }
  const fatal = classifyFatalLine(line);
  if (fatal != null) {
    return { kind: "fatal", errorKind: fatal, line };
  }
  const announced = LOG_ANNOUNCE_RE.exec(line)?.[1];
  if (announced != null) {
    return { kind: "log-file", file: announced.trim() };
  }
  const logFile = LOG_FILE_RE.exec(line)?.[1];
  if (logFile != null) {
    return { kind: "log-file", file: logFile };
  }
  const character = CHARACTER_RE.exec(line)?.[1];
  if (character != null && cleanName(character) != null) {
    return { kind: "character", name: character };
  }
  return { kind: "noise", line };
};

/**
 * Feed stream chunks in, get whole lines out. Keeps the partial tail across
 * chunks; flush() drains whatever is left when the stream ends.
 */
export const createLineSplitter = (
  onLine: (line: string) => void,
): { push: (chunk: string) => void; flush: () => void } => {
  let tail = "";
  return {
    push: (chunk: string): void => {
      tail += chunk;
      let idx = tail.indexOf("\n");
      while (idx >= 0) {
        onLine(tail.slice(0, idx).replace(/\r$/, ""));
        tail = tail.slice(idx + 1);
        idx = tail.indexOf("\n");
      }
    },
    flush: (): void => {
      if (tail.length > 0) {
        onLine(tail.replace(/\r$/, ""));
        tail = "";
      }
    },
  };
};
