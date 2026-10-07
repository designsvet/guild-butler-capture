/**
 * Which engine build wrote the lines this app uploads: the `X-Capture-Engine` header on both line
 * routes (uploadClient.ts `ENGINE_HEADER`; raid-bot ADR 0168, the plan's slice 1 step 5) — and,
 * beside it, which loot rules that build follows (`X-Capture-Loot-Rules`, below).
 *
 * The release build takes the engine from designsvet/ao-loot-logger@protocol18's head with no pin
 * (.github/workflows/build.yml), so the app's own version does not say which engine it carries.
 * tools/prepare-engine-dist.mjs — the one step both platform jobs run over the engine checkout —
 * writes that checkout's commit into the bundled engine folder as `ENGINE_REF`, and this reads it
 * back: the engine is identified by the bytes that ship with it, not by a number kept beside them.
 *
 *  - the bundled engine with a readable stamp → its 40-hex commit
 *  - the bundled engine without one (a local `pnpm package:*` over an engine-dist that was not
 *    stamped) → `unknown`
 *  - any other engine — the dev layout's sibling checkout, a folder chosen in Advanced → `dev`:
 *    a working tree, whose commit would claim more than it knows
 *
 * The mock and replay engines send nothing at all (botFacing.ts).
 *
 * The sha names the engine COMMIT, not every byte that ships: before bundling, both platform jobs
 * apply this repo's `resources/engine-patches/` to the checkout (today the flush-on-SIGINT patch),
 * and the commit does not say so. The app's own version names that patch set — read the two
 * together. The release jobs assert the stamp landed inside the packaged app (build.yml).
 */

import type { TResolvedEngine } from "./engineLocator.js";

/** The stamp's file name inside the bundled engine folder (`<resources>/engine/ENGINE_REF`). */
export const ENGINE_REF_FILE = "ENGINE_REF";
export const DEV_ENGINE = "dev";
export const UNKNOWN_ENGINE = "unknown";

const SHA_RE = /^[0-9a-f]{40}$/;

/** The stamp's text → the commit, or null: exactly one full lowercase sha, whitespace aside. */
export const parseEngineRef = (text: string | null): string | null => {
  const value = (text ?? "").trim();
  return SHA_RE.test(value) ? value : null;
};

/**
 * The header's value for this engine. `readText` returns null for a file it cannot read; `join` is
 * node:path's, injected so the rule is tested without the disk.
 */
export const engineRefFor = (
  engine: Pick<TResolvedEngine, "source" | "root"> | null,
  readText: (path: string) => string | null,
  join: (...parts: string[]) => string,
): string => {
  if (engine?.source !== "bundled") {
    return DEV_ENGINE;
  }
  return parseEngineRef(readText(join(engine.root, ENGINE_REF_FILE))) ?? UNKNOWN_ENGINE;
};

/**
 * The engine's LOOT-RULES LEVEL: the `X-Capture-Loot-Rules` header on both line routes
 * (uploadClient.ts `LOOT_RULES_HEADER`; raid-bot ADR 0168 slice B).
 *
 * The engine keeps one integer in `src/loot-rules.js` (`LOOT_RULES`), bumped by every engine change
 * that alters WHICH pickups it writes — a loot-correctness fix — and by nothing else. Level 1 is the
 * first level whose pickups the bot's slice B may count against a trade: it vouches for the pickups
 * of protocol18 at 30124f1 (designsvet/ao-loot-logger#19, a stack split or a player trade near a
 * chest is not chest loot, and #21, an item keeps no chest from the last map). 30124f1 itself has no
 * `src/loot-rules.js`; the engine commit that adds it is the first to declare 1. The bot admits a run's pickups only at or above its
 * minimum level, so this replaces a list of engine commits the bot used to keep by hand: one number
 * the engine owns, compared rather than looked up.
 *
 * tools/prepare-engine-dist.mjs reads that file from the engine checkout and writes the integer into
 * the bundled engine folder as `ENGINE_LOOT_RULES`; this reads it back, as `ENGINE_REF` is:
 *
 *  - the bundled engine with a readable level → that integer
 *  - the bundled engine without one (an engine older than the level, or a local bundle of one) → null
 *  - any other engine (the dev layout's sibling checkout, a folder chosen in Advanced) → null: a
 *    working tree may hold a pickup change its level does not count yet — the reason it is `dev`
 *
 * Null sends no header, and the bot counts no pickup from a run without one: a level the app cannot
 * vouch for is never guessed, and never sent as 0.
 */
export const ENGINE_LOOT_RULES_FILE = "ENGINE_LOOT_RULES";

/** The canonical decimal of a non-negative integer: no sign, no leading zero, no fraction. */
const LEVEL_RE = /^(0|[1-9][0-9]*)$/;

/** The level file's text → the integer, or null: one non-negative decimal integer, whitespace aside. */
export const parseLootRules = (text: string | null): number | null => {
  const value = (text ?? "").trim();
  if (!LEVEL_RE.test(value)) {
    return null;
  }
  const level = Number(value);
  return Number.isSafeInteger(level) ? level : null;
};

/** The header's value for this engine, or null for no header. Injected I/O as `engineRefFor`'s. */
export const engineLootRulesFor = (
  engine: Pick<TResolvedEngine, "source" | "root"> | null,
  readText: (path: string) => string | null,
  join: (...parts: string[]) => string,
): number | null => {
  if (engine?.source !== "bundled") {
    return null;
  }
  return parseLootRules(readText(join(engine.root, ENGINE_LOOT_RULES_FILE)));
};

/**
 * What the engine says about itself, on every batch of lines it wrote (uploadClient.ts
 * `engineHeaders`): which build it is, and which loot rules that build follows.
 */
export type TEngineStamp = {
  /** `X-Capture-Engine`: the bundled commit, `dev` or `unknown` — always sent. */
  ref: string;
  /** `X-Capture-Loot-Rules`: the level, or null — then the header is left out. */
  lootRules: number | null;
};

/** Before Start has resolved an engine: a `dev` engine, which vouches for no loot rules. */
export const DEV_STAMP: TEngineStamp = { ref: DEV_ENGINE, lootRules: null };

/** A loot log this app run never saw an engine name: nobody vouches for its loot rules. */
export const UNVOUCHED_STAMP: TEngineStamp = { ref: UNKNOWN_ENGINE, lootRules: null };

/**
 * The stamp for a batch of the loot log `file`: the engine that WROTE it, not the one running now.
 *
 * At Start main keeps the last session's log as `state.logFile` (captureSession.ts `user-start`) and
 * the loot uploader's cursor is reset, so until this session's engine names its own log — after its
 * item table and version check, which can outlast the first pass ten seconds in — the uploader sends
 * an earlier session's log again, from line 0, under a new run. Stamped with the engine running now,
 * a log written by a dev or Advanced-folder engine (no level) would reach the bot as level 1 once the
 * bundled engine starts, and the bot would count its pickups: its "every batch of a run agrees" rule
 * cannot see it, because the re-sent run is consistently mis-stamped.
 *
 * So main records, the moment a log is first named, the stamp of the session whose engine named it
 * (`written`), and a batch carries that. A log this app run never saw named (none should reach here)
 * carries `UNVOUCHED_STAMP`: no level is ever guessed. Keyed by the file rather than by "the last
 * session": a session whose engine failed before naming a log would otherwise hand its own stamp to
 * the log before it.
 */
export const stampForLootLog = (
  file: string | null,
  written: ReadonlyMap<string, TEngineStamp>,
  session: TEngineStamp,
): TEngineStamp => (file == null ? session : (written.get(file) ?? UNVOUCHED_STAMP));

export const engineStampFor = (
  engine: Pick<TResolvedEngine, "source" | "root"> | null,
  readText: (path: string) => string | null,
  join: (...parts: string[]) => string,
): TEngineStamp => ({
  ref: engineRefFor(engine, readText, join),
  lootRules: engineLootRulesFor(engine, readText, join),
});
