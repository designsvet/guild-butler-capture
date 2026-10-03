/** One scrubbed real evening through the real pure reducer, shared by layout checks and proofs. */
"use strict";
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { buildSync } = require("esbuild");
const ROOT = join(__dirname, "..");
const fromSource = (file) => {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT, file)],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const module = { exports: {} };
  new Function("module", "exports", outputFiles[0].text)(module, module.exports);
  return module.exports;
};
const replayedSession = () => {
  const { parseActivityLine, parseLootLine } = fromSource("src/shared/session/events.ts");
  const { newSession, reduceSession } = fromSource("src/shared/session/model.ts");
  const folder = join(ROOT, "test", "fixtures", "session");
  const events = readdirSync(folder)
    .filter((file) => /\.(jsonl|txt)$/.test(file))
    .flatMap((file) => {
      let offset = 0;
      return readFileSync(join(folder, file), "utf8")
        .split("\n")
        .flatMap((raw, index) => {
          const fromByte = offset;
          offset += Buffer.byteLength(raw) + 1;
          const line = raw.replace(/\r$/, "");
          if (line.trim() === "" || line.startsWith("timestamp_utc;")) {
            return [];
          }
          const event = file.endsWith("jsonl") ? parseActivityLine(line) : parseLootLine(line);
          if (event == null) {
            throw new Error(`Invalid fixture ${file}:${index + 1}`);
          }
          return [{ file, line: index + 1, event, fromByte, toByte: offset }];
        });
    })
    .sort((a, b) => a.event.at - b.event.at);
  let session = newSession("september-21", events[0].event.at);
  for (const { file, line, event, fromByte, toByte } of events) {
    session = reduceSession(session, event, file);
    const previous = session.files.find((f) => f.path === file);
    session.files = [
      ...session.files.filter((f) => f.path !== file),
      {
        path: file,
        originByte: 0,
        fromByte: Math.min(previous?.fromByte ?? fromByte, fromByte),
        toByte: Math.max(previous?.toByte ?? 0, toByte),
        fromLine: previous?.fromLine ?? 1,
        toLine: Math.max(previous?.toLine ?? 0, line),
      },
    ];
  }
  if (
    session.activityLines !== 361 ||
    session.totals.fame !== 13307603664 ||
    session.totals.silver !== 142162640 ||
    Object.values(session.audits).some((audit) => audit.mismatches !== 0)
  ) {
    throw new Error("Replay fixture failed its raw-file acceptance totals");
  }
  return session;
};
/** An independent recorded journal excerpt; it is never merged into the September 21 evening. */
const journalSession = () => {
  const { newSession, reduceSession } = fromSource("src/shared/session/model.ts");
  const folder = join(ROOT, "test/fixtures/journals");
  const packets = readFileSync(join(folder, "2026-09-16-packets.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const items = JSON.parse(readFileSync(join(folder, "items.json"), "utf8")).items;
  const first = packets[0];
  const base = { v: 1, char: first.payload[2], zone: first.payload[8] };
  let session = newSession("september-16-journals", Date.parse(first.at));
  session = reduceSession(session, {
    ...base,
    t: "zone",
    at: Date.parse(first.at),
    items: "live",
    fame_total: first.payload[35],
  });
  for (const packet of packets.slice(1)) {
    session = reduceSession(session, {
      ...base,
      t: "journal",
      at: Date.parse(packet.at),
      item: items[packet.payload[1]],
      index: packet.payload[1],
      qty: packet.payload[2],
    });
  }
  return session;
};
/** Current live Favor-only excerpt, kept independent from the September 21 recording. */
const favorOnlySession = () => {
  const { parseActivityLine } = fromSource("src/shared/session/events.ts");
  const { newSession, reduceSession } = fromSource("src/shared/session/model.ts");
  const events = readFileSync(join(ROOT, "test/fixtures/currencies/favor-only-2026-10-03.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(parseActivityLine);
  if (events.some((event) => event == null)) {
    throw new Error("Invalid Favor-only fixture");
  }
  return events.reduce((state, event) => reduceSession(state, event), newSession("october-3-favor-only", events[0].at));
};
module.exports = {
  replayedSession,
  journalSession,
  favorOnlySession,
  fromSource,
};
