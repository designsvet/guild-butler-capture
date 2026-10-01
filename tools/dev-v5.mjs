#!/usr/bin/env node
/**
 * Try the v5 shell on this computer: `pnpm dev:v5` (after a build, which the script does).
 *
 * It opens the new shell (GBC_SHELL=v5) with the mock engine, in a data folder of its own
 * (`.dev-v5-data/` in this checkout, git-ignored) — never the installed app's, so your settings,
 * your pairing and your captures are not read or touched, and nothing is sent to your guild's bot
 * (the folder is not paired, and the mock engine never talks to the bot either).
 *
 *   pnpm dev:v5               the mock engine: waiting, then "Albion detected", then loot ticking
 *   pnpm dev:v5 -- --real     the real engine (needs the capture permission, as the app does)
 *   pnpm dev:v5 -- --fresh    forget the throwaway folder first (a first open again)
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dataDir = join(root, ".dev-v5-data");
if (args.includes("--fresh")) {
  rmSync(dataDir, { recursive: true, force: true });
}
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env, GBC_SHELL: "v5" };
if (!args.includes("--real")) {
  env.GBC_MOCK_ENGINE = "1";
}
console.log(`v5 shell · ${env.GBC_MOCK_ENGINE === "1" ? "mock engine" : "real engine"} · data folder ${dataDir}`);
const child = spawn(electron, [root, `--user-data-dir=${dataDir}`], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
