#!/usr/bin/env node
/** Prove the assembled engine writes completion lines the app actually reads, without loading cap. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const engine = resolve(process.argv[2] ?? "engine-dist");
const { createActivity } = require(join(engine, "src/activity/activity.js"));
const { ActivityLog, activityFileFor } = require(join(engine, "src/activity/activity-log.js"));
const loadSessionModule = (name) => {
  const output = buildSync({
    entryPoints: [join(root, `src/shared/session/${name}.ts`)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
};
const { parseActivityLine } = loadSessionModule("events");
const { newSession, reduceSession } = loadSessionModule("model");
const fixture = join(root, "test/fixtures/journals");
const packets = readFileSync(join(fixture, "2026-09-16-packets.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const items = JSON.parse(readFileSync(join(fixture, "items.json"), "utf8")).items;
const dir = mkdtempSync(join(tmpdir(), "loot-journal-bundle-"));
const lootFile = join(dir, "loot-events-proof.txt");
const log = new ActivityLog({ enabled: true, lootFile: () => lootFile });

try {
  let at = Date.parse(packets[0].at);
  const activity = createActivity({
    sink: (line) => log.write(line),
    items: { get: (index) => (items[index] == null ? undefined : { itemId: items[index] }), source: "live" },
    now: () => at,
  });
  // Ownership and shape guards must hold in the bytes assembled for the installer.
  activity.onEvent({ parameters: packets[1].payload }); // before Join
  for (const packet of packets) {
    at = Date.parse(packet.at);
    activity[packet.kind === "response" ? "onResponse" : "onEvent"]({ parameters: packet.payload });
  }
  for (const qty of [undefined, 0, -1, 1.5]) {
    activity.onEvent({ parameters: { ...packets[1].payload, 2: qty } });
  }
  activity.onEvent({ parameters: { ...packets[1].payload, 0: 99999, 2: 100 } });
  activity.onEvent({ parameters: { 0: 100, 1: 12055, 2: 100, 8: 585900000, 252: 35 } });

  const flushed = once(log.stream, "finish");
  log.close();
  await flushed;
  const lines = readFileSync(activityFileFor(lootFile), "utf8").trim().split("\n");
  let session = newSession("bundle-proof", Date.parse(packets[0].at));
  for (const line of lines) {
    const event = parseActivityLine(line);
    assert.ok(event, `App refused the bundled engine's line: ${line}`);
    session = reduceSession(session, event);
  }
  assert.equal(lines.length, 4); // Join plus three genuine completion packets
  assert.equal(session.journals.T8_JOURNAL_WARRIOR_FULL?.qty, 6);
  assert.equal(session.totals.fame, null); // completing a book does not invent earned fame
  assert.equal(session.character, "Me");
  console.log("Journal bundle: 3 observed packets → 6 completed books through engine JSONL and app session model.");
} finally {
  log.close();
  rmSync(dir, { recursive: true, force: true });
}
