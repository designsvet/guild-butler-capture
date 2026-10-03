#!/usr/bin/env node
/** The installer engine must distinguish Favor updates from earned city-faction currency. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { fromSource } = require("./session-fixture.cjs");
const { parseActivityLine } = fromSource("src/shared/session/events.ts");
const { newSession, reduceSession } = fromSource("src/shared/session/model.ts");
const engine = resolve(process.argv[2] ?? "engine-dist");
const { createActivity } = require(join(engine, "src/activity/activity.js"));
const { ActivityLog, activityFileFor } = require(join(engine, "src/activity/activity-log.js"));
const dir = mkdtempSync(join(tmpdir(), "loot-currency-bundle-"));
const lootFile = join(dir, "loot-events-proof.txt");
const log = new ActivityLog({ enabled: true, lootFile: () => lootFile });

try {
  const activity = createActivity({
    sink: (line) => log.write(line),
    items: { get: () => undefined, source: "live" },
    now: () => 1,
  });
  activity.onResponse({
    parameters: { 0: 123, 2: "Recorder", 8: "1354", 253: 2 },
  });
  // Exact currency/Favor amounts from the live 2026-10-03 regression.
  activity.onEvent({
    parameters: { 0: 3, 2: 7, 3: 61023, 9: 252113462, 252: 85 },
  });
  activity.onEvent({
    parameters: {
      0: 0,
      1: 261796,
      2: 40276,
      3: 87265,
      4: 61023,
      5: 5306,
      6: 20341,
      252: 497,
    },
  });
  for (const city of [undefined, 0, 7, 8, 1.5]) {
    activity.onEvent({ parameters: { 2: city, 3: 61023, 252: 85 } });
  }
  for (const gained of [undefined, 0, -250000, 1.5]) {
    activity.onEvent({ parameters: { 2: 4, 3: gained, 252: 85 } });
  }
  // A synthetic positive city probe also verifies that the fix did not disable real faction gains.
  activity.onEvent({ parameters: { 2: 4, 3: 250000, 252: 85 } });
  const flushed = once(log.stream, "finish");
  log.close();
  await flushed;
  const lines = readFileSync(activityFileFor(lootFile), "utf8").trim().split("\n");
  const events = lines.map(parseActivityLine);
  assert.ok(
    events.every((event) => event != null),
    "App refused assembled currency JSONL",
  );
  assert.deepEqual(
    events.map((event) => event.t),
    ["zone", "might", "faction"],
  );
  const favorOnly = events
    .slice(0, 2)
    .reduce((session, event) => reduceSession(session, event), newSession("favor", 1));
  assert.equal(favorOnly.totals.faction, null);
  assert.equal(favorOnly.totals.favor, 86670);
  assert.equal(favorOnly.totals.might, 389337);
  const withFaction = reduceSession(favorOnly, events[2]);
  assert.equal(withFaction.totals.faction, 250000);
  console.log("Currency bundle: Favor-only bytes omit faction; positive city gains reach the app model.");
} finally {
  log.close();
  rmSync(dir, { recursive: true, force: true });
}
