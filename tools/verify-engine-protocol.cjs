// Offline check of the engine actually assembled/packaged by the release workflow.
// Never imports src/index.js, starts capture, fetches items or contacts the bot.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const lock = require("../resources/engine-lock.json");

assert.ok(process.argv[2], "an assembled engine directory is required");
const root = path.resolve(process.argv[2]);
for (const [relative, expected] of Object.entries(lock.sha256)) {
  assert.equal(createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex"), expected, relative);
}
const fromEngine = (relative) => require(path.join(root, relative));
if (process.argv.includes("--native")) {
  assert.equal(typeof fromEngine("node_modules/cap").Cap, "function", "packaged Electron must load cap's native binding");
}
const logger = fromEngine("src/utils/logger");
logger.clear();
const warnings = [];
for (const level of ["debug", "info", "silly"]) logger[level] = () => {};
for (const level of ["warn", "error"]) logger[level] = (error) => warnings.push(String(error));
const rows = [];
fromEngine("src/loot-logger").write = (row) => rows.push(row);
const dispatcher = fromEngine("src/data-handler/data-handler");
const send = (code, parameters) => dispatcher.handleEventData({ parameters: { ...parameters, 252: code } });
send(142, { 0: 101, 1: "FixtureLooter", 2: "Fixture Guild", 4: "TAG", 5: "example profile" });
for (let i = 0; i < 8; i++) {
  send(143, { 0: 101, 1: "FixtureLooter", 2: ["Opponent"], 3: [123], 4: [1], 5: [1], 6: [123456789] });
}
const pickup = { 0: 50058, 1: "@MOB_T6_MOB_ROAMING_STEPPE_CHEST", 2: "FixtureLooter", 4: 255, 5: 1 };
send(278, pickup);
send(279, pickup);
assert.equal(rows.length, 1, "the current pickup is logged once; old 279 is not an alias");
assert.equal(rows[0].lootedBy.guildName, "Fixture Guild");
assert.equal(rows[0].quantity, 1);
assert.deepEqual(warnings, []);
assert.equal(fromEngine("src/storage/parse-health").statusLine(), "[health] parse ok");
console.log("Packaged decoder verified: exact source hashes, profile 142, history 143, pickup 278; no capture started.");
