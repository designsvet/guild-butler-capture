#!/usr/bin/env node
/**
 * Assemble a bundle-ready copy of the engine for packaged builds.
 *
 *   node tools/prepare-engine-dist.mjs <engine-root> [out-dir]
 *
 * Copies exactly what the engine needs at runtime — package.json, src/ and
 * node_modules/ (which must already hold `cap` built for THIS app's Electron
 * ABI: run tools/engine-rebuild.mjs first) — into out-dir (default:
 * ./engine-dist). electron-builder then ships that folder as
 * resources/engine, where the app's locator finds it as the "bundled" source.
 * Everything else in the engine repo (assets/, build/, docs) is packaging or
 * tooling, verified unused at runtime — see ADR 0096's Windows-slice addendum.
 *
 * It also stamps the engine's commit into out-dir as `ENGINE_REF` (one 40-hex
 * sha and a newline). The release build checks the engine out at a branch head
 * with no pin, so the app's version says nothing about which engine it carries;
 * the app reads this file back and sends it with every upload as
 * `X-Capture-Engine` (src/main/engineRef.ts, raid-bot ADR 0168). Read here
 * because both platform jobs run this step over the checkout — one stamp, and
 * each job asserts it reached the packed app. In CI an engine with no readable
 * commit fails the build; a local run over a folder that is not a git checkout
 * warns and ships no stamp (the app then says `unknown`). The commit is HEAD's:
 * the jobs apply resources/engine-patches/ before this step, and the stamp does
 * not say so — the app's version names that patch set.
 *
 * Beside it, the engine's LOOT-RULES LEVEL as `ENGINE_LOOT_RULES` (the integer
 * and a newline): `LOOT_RULES` from the engine's own `src/loot-rules.js`, an
 * integer the engine bumps with every change to WHICH pickups it writes. The app
 * sends it as `X-Capture-Loot-Rules` (src/main/engineRef.ts), and raid-bot ADR
 * 0168's slice B counts a run's pickups against a trade only at or above its
 * minimum level. An engine with no `src/loot-rules.js` predates the level: no
 * file, and the app sends no header, which the bot reads as "counts nothing" —
 * the truth about such an engine. A file that is there but does not yield a
 * non-negative integer is an engine bug: it fails the build in CI and warns
 * locally, as a missing commit does. The release jobs assert the level reached
 * the packed app (build.yml), so a release is never cut over an engine without one.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const engineRoot = process.argv[2] != null ? resolve(process.argv[2]) : null;
if (engineRoot == null || !existsSync(join(engineRoot, "src", "index.js"))) {
  console.error("usage: node tools/prepare-engine-dist.mjs <engine-root> [out-dir]");
  console.error("engine-root must contain src/index.js");
  process.exit(2);
}
if (!existsSync(join(engineRoot, "node_modules", "cap"))) {
  console.error(`No node_modules/cap under ${engineRoot} — install the engine's deps first`);
  console.error("(npm ci --omit=dev in the engine, then tools/engine-rebuild.mjs for the Electron ABI).");
  process.exit(2);
}

const outDir = resolve(process.argv[3] ?? "engine-dist");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const part of ["package.json", "src", "node_modules"]) {
  cpSync(join(engineRoot, part), join(outDir, part), { recursive: true });
}

// Only the engine folder's OWN checkout (`.git` is a folder, or a file in a worktree): asked from a
// plain folder inside some other repository, git would answer with that repository's commit.
let sha = "";
if (existsSync(join(engineRoot, ".git"))) {
  try {
    sha = execFileSync("git", ["-C", engineRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // no git on this machine — decided below
  }
}
if (/^[0-9a-f]{40}$/.test(sha)) {
  writeFileSync(join(outDir, "ENGINE_REF"), `${sha}\n`, "utf8");
  console.log(`engine commit ${sha} → ENGINE_REF`);
} else if (process.env.GITHUB_ACTIONS === "true") {
  console.error(`No engine commit under ${engineRoot}: a release must say which engine it carries (ENGINE_REF).`);
  process.exit(2);
} else {
  console.warn(`No engine commit under ${engineRoot} — no ENGINE_REF; the app will send X-Capture-Engine: unknown.`);
}

// The level is the engine's own: required from its checkout (after the patches, as the commit is
// read), never parsed out of the text and never defaulted.
const lootRulesSource = join(engineRoot, "src", "loot-rules.js");
if (existsSync(lootRulesSource)) {
  let level;
  let why = "";
  try {
    level = createRequire(import.meta.url)(lootRulesSource).LOOT_RULES;
  } catch (err) {
    why = ` (${err instanceof Error ? err.message : String(err)})`;
  }
  if (Number.isSafeInteger(level) && level >= 0) {
    writeFileSync(join(outDir, "ENGINE_LOOT_RULES"), `${level}\n`, "utf8");
    console.log(`engine loot rules ${level} → ENGINE_LOOT_RULES`);
  } else {
    const message =
      `${lootRulesSource} does not export LOOT_RULES as a non-negative integer${why} — no ENGINE_LOOT_RULES; ` +
      "the app would send no X-Capture-Loot-Rules and the bot would count none of its pickups.";
    if (process.env.GITHUB_ACTIONS === "true") {
      console.error(message);
      process.exit(2);
    }
    console.warn(message);
  }
} else {
  console.warn(
    `No src/loot-rules.js under ${engineRoot} — an engine older than the loot-rules level: no ENGINE_LOOT_RULES, ` +
      "no X-Capture-Loot-Rules header, and the bot counts none of its pickups against a trade.",
  );
}

console.log(`engine-dist → ${outDir}`);
