/** Drives the actual main + sandboxed preload + built renderer, using only scrubbed files. */
"use strict";
const { app, BrowserWindow } = require("electron");
const { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");
const ROOT = resolve(__dirname, "..");
const data = mkdtempSync(join(tmpdir(), "loot-replay-proof-"));
app.setPath("userData", data);
app.setAppPath(ROOT);
process.env.GBC_SHELL = "v5";
const sources = join(data, "sources");
cpSync(join(ROOT, "test", "fixtures", "session"), sources, { recursive: true });
process.env.GBC_REPLAY_DIR = sources;
process.env.GBC_NO_AUTO_UPDATE = "1";
delete process.env.GBC_MOCK_ENGINE;
app.commandLine.appendSwitch("force-prefers-reduced-motion");
const waitFor = async (read, accepts) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Replay never reached the expected state");
};
const assert = (condition, why) => {
  if (!condition) {
    throw new Error(why);
  }
};
const run = async () => {
  // app.getAppPath is this repo under `electron .` but under a harness it follows the harness.
  app.setAppLogsPath(join(data, "logs"));
  await import(pathToFileURL(join(ROOT, "dist", "main", "index.js")).href);
  await app.whenReady();
  const win = await waitFor(
    () => BrowserWindow.getAllWindows()[0],
    (win) => win != null,
  );
  const call = (code) => win.webContents.executeJavaScript(code);
  const session = await waitFor(
    () => call("window.gbc?.getSession() ?? null"),
    (s) => s?.activityLines === 361,
  );
  assert(
    session.totals.fame === 13307603664 && session.totals.silver === 142162640,
    "IPC totals differ from raw files",
  );
  await waitFor(
    () => call("document.querySelector('[data-session-count=resources]')?.textContent"),
    (value) => value === "19",
  );
  await call("document.querySelector('[data-new-session]').click()");
  await waitFor(
    () => call("window.gbc.getSession()"),
    (s) => s?.id !== session.id && s.events === 0,
  );
  const summaryDir = join(data, "replays", "sessions", session.id);
  const summary = JSON.parse(readFileSync(join(summaryDir, "session.json"), "utf8"));
  assert(
    summary.totals.fame === session.totals.fame && summary.endedAt === session.lastAt,
    "New session summary differs from IPC",
  );
  await call("window.gbc.stop()");
  await waitFor(
    () => call("window.gbc.getSession()"),
    (s) => s?.endedAt != null,
  );
  const logs = readFileSync(join(data, "logs", "capture-app.log"), "utf8");
  assert(
    !logs.includes("[upload]") && !logs.includes("[pair] connected") && logs.includes("bot traffic disabled"),
    "Replay attempted bot traffic",
  );
  assert(readdirSync(join(data, "replays", "sessions")).length === 1, "Empty second session wrote history");
  const startAgain = async () => {
    await call("window.gbc.start()");
    return waitFor(
      () => call("window.gbc.getSession()"),
      (s) => s?.events > 0 && s.endedAt == null,
    );
  };
  const malformedRun = await startAgain();
  await call("window.gbc.newSession()");
  writeFileSync(join(sources, "activity-events-refused.jsonl"), '{"v":99}\n');
  await waitFor(() => call("window.gbc.getSession()"), (s) => s?.events === 0 && s.refused === 1);
  await waitFor(() => call("document.querySelector('.lb-data-warning[role=status]')?.textContent"), (value) => value?.includes("session data"));
  await call("window.gbc.stop()");
  await waitFor(() => call("window.gbc.getSession()"), (s) => s?.endedAt != null);
  assert(malformedRun.activityLines === 361, "Malformed-line run did not replay the recording");
  const stopped = await startAgain();
  await call("window.gbc.stop()");
  await waitFor(
    () => call("window.gbc.getSession()"),
    (s) => s?.id === stopped.id && s.endedAt != null,
  );
  const stoppedSummary = JSON.parse(
    readFileSync(join(data, "replays", "sessions", stopped.id, "session.json"), "utf8"),
  );
  assert(stoppedSummary.totals.fame === session.totals.fame, "Stop lost session totals");
  const quitting = await startAgain();
  // Quit with a nonempty, active tracker. app.exit would skip this flush.
  app.once("will-quit", () => {
    try {
      const summary = JSON.parse(readFileSync(join(data, "replays", "sessions", quitting.id, "session.json"), "utf8"));
      assert(
        summary.endedAt === quitting.lastAt && summary.totals.fame === session.totals.fame,
        "Quit lost session totals",
      );
      assert(readdirSync(join(data, "replays", "sessions")).length === 5, "Summary boundaries were duplicated or lost");
      console.log(
        "Real replay: 361 activity lines, raw totals, renderer, New session, Stop + active quit summaries, no bot traffic — passed.",
      );
      rmSync(data, { recursive: true, force: true });
    } catch (err) {
      console.error(err);
      rmSync(data, { recursive: true, force: true });
      app.exit(1);
    }
  });
  app.quit();
};
run().catch((err) => {
  console.error(err);
  rmSync(data, { recursive: true, force: true });
  app.exit(1);
});
