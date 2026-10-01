/**
 * The stub bridge for tools/layout-check.cjs: the same `window.gbc` shape the
 * real preload exposes (src/preload/index.cts), answering from one scenario
 * instead of from the main process. Nothing here talks to an engine, a bot or
 * the disk — the check is about what the window DRAWS in each state.
 *
 * The scenario arrives as a base64 JSON argument (additionalArguments), which
 * is why this preload runs unsandboxed: a sandboxed preload cannot read argv.
 * The real app's preload stays sandboxed, and this file never ships:
 * electron-builder.yml packages tools/mock-engine.cjs and nothing else here.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--gbc-scenario="));
const sc = JSON.parse(Buffer.from(arg.slice("--gbc-scenario=".length), "base64").toString("utf8"));
const now = Date.now();

// initialCaptureState (src/shared/captureTypes.ts), spelled out: this file is
// plain CommonJS and cannot import the compiled ESM.
const idle = {
  status: "idle",
  albionSeen: false,
  character: null,
  linesThisRun: 0,
  linesSinceHeartbeat: 0,
  linesPrevRuns: 0,
  logFile: null,
  errorKind: null,
  errorDetail: null,
  startedAt: null,
  runStartedAt: null,
  lastOutputAt: null,
  lastDetectedAt: null,
  lastLootAt: null,
  restartAttempt: 0,
  restartDelayMs: null,
  heartbeatSeen: false,
  stopRequested: false,
  engineBroken: null,
};

// The longest values a real session puts in the greeting: a long character
// name, a four-digit count, the engine's full log-file name.
const capturing = {
  status: "capturing",
  albionSeen: true,
  character: "Borysthenes",
  linesThisRun: 1284,
  heartbeatSeen: true,
  logFile: "/Users/member/Library/Application Support/Guild Butler Capture/logs/loot-events-2026-09-29-14-02-11.txt",
  startedAt: now - 3_600_000,
  runStartedAt: now - 3_600_000,
  lastOutputAt: now,
  lastDetectedAt: now,
};

const STATES = {
  idle: {},
  waiting: { status: "waiting", startedAt: now - 20_000, runStartedAt: now - 20_000 },
  // past WAITING_HINTS_AFTER_MS, so the "Nothing after a few minutes?" line shows
  waitingLong: { status: "waiting", startedAt: now - 900_000, runStartedAt: now - 900_000 },
  capturing,
  health: { ...capturing, engineBroken: [{ handler: "EvOtherGrabbedLoot", failures: 5, calls: 5 }] },
  // The states only the v5 shell's tools use (tools/shell-shots.cjs, tools/shell-layout-check.cjs);
  // the old check never asks.
  starting: { status: "starting", startedAt: now - 3_000, runStartedAt: now - 3_000 },
  // Capturing before Albion has named the character: the bar says "detecting…".
  capturingNew: { ...capturing, character: null, linesThisRun: 0, heartbeatSeen: false, startedAt: now - 20_000 },
  restarting: { ...capturing, status: "restarting", albionSeen: false, restartAttempt: 1, restartDelayMs: 4_000 },
  stopping: { ...capturing, status: "stopping", stopRequested: true },
  error: { status: "error", errorKind: "permission", errorDetail: "bpf: Permission denied" },
};

const stateFor = (name) => ({ ...idle, ...STATES[name] });
const state = stateFor(sc.state);

// A state pushed later, as main pushes one: the v5 shell's tools (tools/shell-shots.cjs,
// tools/shell-layout-check.cjs) send a state's name on this channel to play a change — the
// title bar's Start/Stop morph. The old check never sends it.
const onStateListeners = new Set();
ipcRenderer.on("gbc-stub:state", (_event, name) => {
  const next = stateFor(name);
  for (const listener of onStateListeners) {
    listener(next);
  }
});

const pairing = sc.paired
  ? {
      paired: true,
      deviceName: "Member's MacBook Pro",
      guildId: "1",
      pairedAt: now,
      uploadEnabled: sc.uploadEnabled ?? true,
      // sc.upload, sc.sent and sc.uploadEnabled shape the v5 shell's sidebar foot; the old check sets none
      upload: { state: sc.upload ?? "idle", sentTotal: sc.sent ?? 1284, lastSentAt: now - (sc.sentAgoMs ?? 0), failures: 0, lastError: null },
    }
  : {
      paired: false,
      deviceName: null,
      guildId: null,
      pairedAt: null,
      uploadEnabled: true,
      upload: { state: "unpaired", sentTotal: 0, lastSentAt: null, failures: 0, lastError: null },
    };

const setup = {
  platform: sc.platform,
  engineEntry: "/engine/src/index.js",
  engineRoot: "/engine",
  engineSource: "bundled",
  access: "ok",
  appVersion: "0.0.0",
  builtAt: null,
};
const update = { phase: "off", version: null, percent: null, error: null };
// autoCapture off: the check must not press Start behind its own back.
const settings = { autoCapture: false, language: sc.lang, theme: sc.theme };

const ok = (value) => Promise.resolve(value);

contextBridge.exposeInMainWorld("gbc", {
  platform: sc.platform,
  start: () => ok(),
  stop: () => ok(),
  getState: () => ok(state),
  reveal: () => ok(true),
  getSetup: () => ok(setup),
  fixMacPermissions: () => ok({ setup, outcome: null, detail: null }),
  installNpcap: () => ok({ setup, install: { outcome: "cancelled", version: null, detail: null } }),
  openNpcapPage: () => ok(),
  pickEnginePath: () => ok(setup),
  onState: (listener) => {
    onStateListeners.add(listener);
    return () => {
      onStateListeners.delete(listener);
    };
  },
  getPairing: () => ok(pairing),
  // Every code is refused: the failure sentence is the tallest thing the steps can hold.
  pair: () => ok({ ok: false, status: pairing, failure: "refused" }),
  unpair: () => ok(pairing),
  setUpload: () => ok(pairing),
  openLoot: () => ok(),
  openPrivacy: () => ok(),
  onPairing: () => () => {},
  getUpdate: () => ok(update),
  updateRestart: () => ok({ ok: true }),
  onUpdate: () => () => {},
  getSettings: () => ok(settings),
  setAutoCapture: () => ok(settings),
  setLanguage: () => ok(settings),
  setTheme: () => ok(settings),
  updateCheckNow: () => ok(update),
  copyText: () => ok(),
});
