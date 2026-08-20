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
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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

console.log(`engine-dist → ${outDir}`);
