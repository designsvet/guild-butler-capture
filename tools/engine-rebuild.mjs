#!/usr/bin/env node
/**
 * Rebuild the engine's native modules (the `cap` libpcap binding) for THIS
 * app's Electron ABI — required once after `pnpm install` and again after any
 * Electron major bump, because the engine child runs on Electron's own Node.
 *
 *   pnpm engine:rebuild [path-to-ao-loot-logger]
 *
 * Two things this wrapper fixes over calling @electron/rebuild by hand:
 * - Engine discovery matches the app's locator: beside this app after
 *   extraction (../ao-loot-logger), or beside the Raid-Bot repo while the app
 *   is staged inside it (../../ao-loot-logger). An argument always wins.
 * - The Electron version is passed EXPLICITLY, read from the installed
 *   dependency — `pnpm dlx` runs @electron/rebuild from a temp project where
 *   its own auto-detection has no electron to find.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const candidates =
  process.argv[2] != null
    ? [resolve(process.argv[2])]
    : [join(appRoot, "..", "ao-loot-logger"), join(appRoot, "..", "..", "ao-loot-logger")];
const engineRoot = candidates.find((dir) => existsSync(join(dir, "src", "index.js")));
if (engineRoot == null) {
  console.error("No ao-loot-logger found. Looked at:");
  for (const dir of candidates) {
    console.error(`  ${join(dir, "src", "index.js")}`);
  }
  console.error("Pass the ao-loot-logger folder as the first argument.");
  process.exit(2);
}

const electronPkg = join(appRoot, "node_modules", "electron", "package.json");
if (!existsSync(electronPkg)) {
  console.error("Electron is not installed yet — run `pnpm install` in guild-butler-capture first.");
  process.exit(2);
}
const electronVersion = JSON.parse(readFileSync(electronPkg, "utf8")).version;

console.log(`Rebuilding ${engineRoot} natives for Electron ${electronVersion}…`);
const result = spawnSync("pnpm", ["dlx", "@electron/rebuild", "-v", electronVersion, "--module-dir", engineRoot], {
  stdio: "inherit",
  cwd: appRoot,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
