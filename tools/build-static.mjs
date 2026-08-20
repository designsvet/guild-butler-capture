#!/usr/bin/env node
/**
 * Copy the renderer's static files (html/css) beside the tsc output. Part of
 * `pnpm build`; deliberately a 10-line script instead of a bundler — the app
 * has no dependency graph a bundler would earn its keep on.
 */

import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, "dist", "web", "renderer");
mkdirSync(dest, { recursive: true });
for (const name of ["index.html", "styles.css"]) {
  cpSync(join(root, "src", "renderer", name), join(dest, name));
}

// Stamp the build so the window and the app log can say WHICH build is
// running — package.json's version is static across dev builds, and the first
// hardware pass spent a round-trip on a stale instance nobody could identify.
writeFileSync(join(root, "dist", "buildstamp.json"), JSON.stringify({ builtAt: new Date().toISOString() }));
console.log(`static → ${dest}`);
