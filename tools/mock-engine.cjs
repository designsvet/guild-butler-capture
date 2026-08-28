#!/usr/bin/env node
/**
 * Mock capture engine — a stand-in for ao-loot-logger so the app can be
 * developed, demoed and integration-tested without the game, without libpcap,
 * and without the real (GPL, separately-cloned) engine.
 *
 * It speaks the stdout contract RECORDED from the real engine on 2026-08-20
 * (see src/main/engineAdapter.ts — CONTRACT STATUS — and
 * test/fixtures/realEngineLines.ts for the verbatim lines) and writes a real
 * `loot-events-<timestamp>.txt` in its cwd whose rows match the 11-field
 * madvac-fork CSV the Discord bot ingests (raid-bot ADR 0092,
 * src/domain/lootLog.ts):
 *
 *   timestamp_utc;alliance;guild;name;item_id;item_name;qty;from_alliance;from_guild;from_name;server__region
 *
 * Plain CommonJS on purpose: it must run under any Node (or Electron-as-Node)
 * with zero dependencies and zero build steps.
 *
 * Flags:
 *   --interval=<ms>      heartbeat + loot cadence (default 2000)
 *   --detect-after=<ms>  time until ALBION DETECTED (default 3000)
 *   --no-game            never detect (the "Albion not running" scenario)
 *   --crash-after=<ms>   exit(1) after this long (tests the auto-restart)
 *   --fail=permission|npcap|abi   die immediately the way the real engine does
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit == null ? fallback : hit.slice(name.length + 3);
};
const has = (name) => process.argv.includes(`--${name}`);

const ITEMS = [
  ["T4_SKILLBOOK_STANDARD", "Adept's Tome of Insight"],
  ["T6_2H_BOW@1", "Master's Bow"],
  ["T5_ARMOR_LEATHER_SET2@2", "Expert's Hellion Jacket"],
  ["T7_MEAL_STEW", "Grandmaster's Beef Stew"],
  ["T8_ORE@3", "Elder's Ore"],
];
const CHARACTER = arg("character", "MockWarrior");
const VICTIMS = ["FallenKnight", "DeadOrc", "LostPilgrim"];

/** One CSV row in the exact shape the bot's parser (AO_LOOT_RE) accepts. */
const buildLootLine = (now, index) => {
  const item = ITEMS[index % ITEMS.length];
  const victim = VICTIMS[index % VICTIMS.length];
  const qty = (index % 3) + 1;
  return [
    new Date(now).toISOString(),
    "MOCK",
    "VITRYLA",
    CHARACTER,
    item[0],
    item[1],
    String(qty),
    "",
    "EnemyGuild",
    victim,
    "europe",
  ].join(";");
};

const HEADER =
  "timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name;server__region";

const NET_EPOCH_TICKS = 621355968000000000;

/**
 * One `[festivities]` line, the shape the real engine's FestivitiesUpdate handler prints
 * (raid-bot ADR 0102) — modelled on the payload RECORDED from live traffic on 2026-08-28:
 * seasonal rows carry an EMPTY category, production rows carry `GENERAL`, and every time is
 * .NET ticks, unconverted, because the engine reports what the wire said.
 */
const buildFestivitiesLine = (nowMs) => {
  const ticks = (ms) => NET_EPOCH_TICKS + ms * 10000;
  const day = 24 * 60 * 60 * 1000;
  return `[festivities] ${JSON.stringify({
    server: "europe",
    code: 518,
    entries: [
      { kind: 0, category: "", uniqueName: "DRAGON_LEAD_UP_PHASE_1", startTicks: ticks(nowMs - day), endTicks: ticks(nowMs + 3 * day) },
      { kind: 1, category: "ACTIVITIES", uniqueName: "MISTS", startTicks: ticks(nowMs), endTicks: ticks(nowMs + 2 * day) },
      { kind: 2, category: "GENERAL", uniqueName: "COMMON_BOW", startTicks: ticks(nowMs), endTicks: ticks(nowMs + day) },
    ],
  })}`;
};

module.exports = { buildLootLine, HEADER, CHARACTER, buildFestivitiesLine };

if (require.main === module) {
  const interval = Number(arg("interval", "2000"));
  const detectAfter = Number(arg("detect-after", "3000"));
  const crashAfter = arg("crash-after", null);
  const fail = arg("fail", null);

  if (fail != null) {
    // Each shape matches ONE classifier in engineAdapter.ts. Real-world lines
    // recorded on hardware belong in test/fixtures/, not here.
    const lines = {
      permission: "Error: (cannot open device) /dev/bpf0: Permission denied — Operation not permitted",
      npcap: "Error: cap.node could not load wpcap.dll — is Npcap installed?",
      abi: "Error: The module 'cap.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115.",
    };
    process.stderr.write(`${lines[fail] ?? `unknown fail mode ${fail}`}\n`);
    process.exit(1);
  }

  const logName = `loot-events-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  const logPath = path.join(process.cwd(), logName);
  fs.writeFileSync(logPath, `${HEADER}\n`);

  // Startup lines exactly as recorded: banner, ABSOLUTE-path announcement.
  process.stdout.write("AO Loot Logger - v0.0.0-mock\n");
  process.stdout.write(`Logs will be written to ${logPath}\n`);
  process.stdout.write('You can always press "d" to start a new log file.\n');

  let detected = false;
  let linesWritten = 0;
  let tickCount = 0;

  if (has("no-game")) {
    // The real NOT-DETECTED line is still unrecorded (the game was running when
    // the contract was captured) — this shape is the documented signal only.
    setTimeout(() => {
      process.stdout.write("ALBION NOT DETECTED — waiting for game traffic\n");
    }, detectAfter);
  } else {
    setTimeout(() => {
      detected = true;
      process.stdout.write("\tALBION DETECTED. Loot events should be logged.\n");
      process.stdout.write("\tCURRENT SERVER: Europe (Europe)\n");
      // The rotation arrives with the session, exactly as the real event does on login.
      process.stdout.write(`${buildFestivitiesLine(Date.now())}\n`);
    }, detectAfter);
  }

  const tick = setInterval(() => {
    tickCount += 1;
    if (detected) {
      const rows = (tickCount % 2) + 1;
      let batch = "";
      for (let i = 0; i < rows; i += 1) {
        batch += `${buildLootLine(Date.now(), linesWritten)}\n`;
        linesWritten += 1;
      }
      fs.appendFileSync(logPath, batch);
      // The console echo the real engine prints alongside each CSV row.
      process.stdout.write(
        `05:42:00 UTC: {MOCK} [VITRYLA] ${CHARACTER} looted ${rows}x Adept's Tome of Insight from @MOB_MOCK_CHAMPION.\n`,
      );
    }
    const who = detected ? CHARACTER : "not identified yet (change zone once)";
    process.stdout.write(`[status] character: ${who} · lines written: ${linesWritten}\n`);
  }, interval);

  if (crashAfter != null) {
    setTimeout(() => {
      process.stderr.write("mock engine: simulated crash\n");
      process.exit(1);
    }, Number(crashAfter));
  }

  process.on("SIGINT", () => {
    clearInterval(tick);
    process.stdout.write("[mock] flushed, exiting\n");
    process.exit(0);
  });
}
