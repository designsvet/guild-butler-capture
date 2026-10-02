#!/usr/bin/env node
/** Real model, recorded files, isolated settings/captures, no packet driver and no bot. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const folder = process.argv.slice(2).find((arg) => arg !== "--");
if (folder == null || !existsSync(resolve(folder))) {
  throw new Error("Usage: pnpm dev:replay <folder containing activity-events-*.jsonl and loot-events-*.txt>");
}
const env = { ...process.env, GBC_SHELL: "v5", GBC_REPLAY_DIR: resolve(folder), GBC_NO_AUTO_UPDATE: "1" };
delete env.GBC_MOCK_ENGINE;
const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, [root, `--user-data-dir=${join(root, ".dev-replay-data")}`], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
