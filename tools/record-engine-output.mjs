#!/usr/bin/env node
/**
 * Record the REAL engine's stdout/stderr — the first thing to run on real
 * hardware, because the adapter's line patterns are educated guesses until a
 * genuine session has been captured (see engineAdapter.ts CONTRACT STATUS).
 *
 *   sudo node tools/record-engine-output.mjs [path-to-ao-loot-logger]
 *
 * (sudo only until the app's permission fix has been installed.) Every line is
 * teed to the console and to engine-output-<timestamp>.log with a stream tag
 * and a relative timestamp. Play for a few minutes, pick up loot, Ctrl-C —
 * then copy the interesting lines into test/fixtures/ and tighten the adapter.
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Same discovery rule as the app's engine locator: the engine sits beside this
// app after extraction (../ao-loot-logger), or beside the Raid-Bot repo while
// the app is staged inside it (../../ao-loot-logger). An argument always wins.
const candidates =
  process.argv[2] != null
    ? [resolve(process.argv[2])]
    : [resolve(process.cwd(), "..", "ao-loot-logger"), resolve(process.cwd(), "..", "..", "ao-loot-logger")];
const engineRoot = candidates.find((dir) => existsSync(join(dir, "src", "index.js")));
if (engineRoot == null) {
  console.error("No ao-loot-logger found. Looked at:");
  for (const dir of candidates) {
    console.error(`  ${join(dir, "src", "index.js")}`);
  }
  console.error("Pass the ao-loot-logger folder as the first argument.");
  process.exit(2);
}
const entry = join(engineRoot, "src", "index.js");

const outName = `engine-output-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
const out = createWriteStream(outName);
const startedAt = Date.now();

const tee = (tag) => (chunk) => {
  const stamp = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(7);
  for (const line of chunk.toString().split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const tagged = `${stamp}s ${tag} ${line}`;
    console.log(tagged);
    out.write(`${tagged}\n`);
  }
};

console.log(`Recording ${entry} → ${outName} (Ctrl-C to stop)`);
const child = spawn(process.execPath, [entry], { cwd: engineRoot, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", tee("OUT"));
child.stderr.on("data", tee("ERR"));
child.on("exit", (code, signal) => {
  tee("SYS")(`engine exited code=${code} signal=${signal}`);
  out.end(() => process.exit(0));
});
process.on("SIGINT", () => {
  child.kill("SIGINT");
});
