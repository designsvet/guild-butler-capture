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

export type TEngineEvent =
  | { kind: "albion-detected" }
  | { kind: "albion-lost" }
  | { kind: "heartbeat"; character: string | null; linesWritten: number | null }
  | { kind: "character"; name: string }
  | { kind: "log-file"; file: string }
  | { kind: "festivities"; server: string | null; code: number | null; entries: TFestivityEntry[] }
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

// The output file. REAL SHAPE, recorded: a startup announcement carrying the
// ABSOLUTE path, which may contain spaces — so the announcement line is
// matched first and the bare loot-events-<timestamp>.txt name (which the
// engine drops into its repo root) stays as the liberal fallback.
const LOG_ANNOUNCE_RE = /logs?\s+will\s+be\s+written\s+to\s+(.+?\.txt)\s*$/i;
const LOG_FILE_RE = /(loot-events-[\w.:-]+\.txt)/i;

/**
 * The daily bonus rotation (raid-bot ADR 0100), printed by the engine's FestivitiesUpdate
 * handler as `[festivities] {json}`. RECORDED: Europe, 2026-08-28, Photon event code 518
 * (test/fixtures/realEngineLines.ts).
 *
 * The engine prints .NET ticks verbatim — it reports what the wire said and interprets nothing —
 * so the unit change happens HERE, in the module whose job is knowing what the engine prints.
 * The engine already read the Photon int64 into a JS number, which is lossy above 2^53; at tick
 * magnitudes that is tens of microseconds, invisible in a countdown measured in days.
 */
const FESTIVITIES_MARK_RE = /\[festivities\]/i;

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
 * Failure classification, most-specific first. Order matters twice:
 * - ABI before Npcap: a native-module load failure on Windows says "The
 *   specified module could not be found", which mentions no driver — but
 *   NODE_MODULE_VERSION / ERR_DLOPEN lines are unambiguous and must win.
 * - Npcap before permission: Npcap's own errors sometimes contain "access".
 */
const FATAL_RULES: ReadonlyArray<{ kind: EEngineErrorKind; re: RegExp }> = [
  {
    kind: EEngineErrorKind.AbiMismatch,
    re: /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|was compiled against a different Node\.js version/i,
  },
  { kind: EEngineErrorKind.NpcapMissing, re: /wpcap\.dll|npcap|winpcap/i },
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
  if (DEBUG_TAG_RE.test(line)) {
    return { kind: "noise", line };
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
