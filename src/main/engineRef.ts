/**
 * Which engine build wrote the lines this app uploads: the `X-Capture-Engine` header on both line
 * routes (uploadClient.ts `ENGINE_HEADER`; raid-bot ADR 0168, the plan's slice 1 step 5).
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
