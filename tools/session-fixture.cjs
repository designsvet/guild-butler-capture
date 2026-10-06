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
module.exports = { replayedSession, fromSource };
