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
  // The v5 shell's notices (board Fh5): every kind of blocked capture, the logger stopping from the
  // third restart in a row, a broken decoder over an idle capture.
  errorNpcap: { status: "error", errorKind: "npcap-missing", errorDetail: "wpcap.dll not found" },
  errorEngine: { status: "error", errorKind: "engine-missing", errorDetail: "No ao-loot-logger found" },
  errorAbi: { status: "error", errorKind: "abi-mismatch", errorDetail: "NODE_MODULE_VERSION 127" },
  restartingAgain: { ...capturing, status: "restarting", albionSeen: false, restartAttempt: 4, restartDelayMs: 8_000 },
  healthIdle: { engineBroken: [{ handler: "EvOtherGrabbedLoot", failures: 5, calls: 5 }] },
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

const PAIRED = {
  paired: true,
  deviceName: "Member's MacBook Pro",
  guildId: "1",
  lootUrl: "https://app.guild-butler.com/?guild=1&tab=loot",
  pairedAt: now,
  uploadEnabled: sc.uploadEnabled ?? true,
  // sc.upload, sc.sent and sc.uploadEnabled shape the v5 shell's sidebar foot; the old check sets none
  upload: { state: sc.upload ?? "idle", sentTotal: sc.sent ?? 1284, lastSentAt: now - (sc.sentAgoMs ?? 0), failures: 0, lastError: null },
};
const UNPAIRED = {
  paired: false,
  deviceName: null,
  guildId: null,
  lootUrl: null,
  pairedAt: null,
  uploadEnabled: true,
  upload: { state: "unpaired", sentTotal: 0, lastSentAt: null, failures: 0, lastError: null },
};
// What main would hold: the v5 shell's connection panel pairs, disconnects and switches the upload,
// and each answers with the status after it, and pushes it, as main does. The old check presses
// Pair alone.
let pairing = sc.paired ? PAIRED : UNPAIRED;
const onPairingListeners = new Set();
const setPairing = (next) => {
  pairing = next;
  for (const listener of onPairingListeners) {
    listener(pairing);
  }
  return pairing;
};

// The folders a real install reports, at their longest: the v5 shell's settings show both whole
// (sc.longPaths, set by its tools); the old check keeps its short stand-ins.
const LONG_PATHS = {
  darwin: {
    engineRoot: "/Applications/Guild Butler Capture.app/Contents/Resources/engine",
    captureDir: "/Users/Borysthenes/Library/Application Support/guild-butler-capture/captures",
  },
  win32: {
    engineRoot: "C:\\Users\\Borysthenes\\AppData\\Local\\Programs\\guild-butler-capture\\resources\\engine",
    captureDir: "C:\\Users\\Borysthenes\\AppData\\Roaming\\guild-butler-capture\\captures",
  },
};
const paths = sc.longPaths ? (LONG_PATHS[sc.platform] ?? LONG_PATHS.darwin) : { engineRoot: "/engine", captureDir: "/engine" };

// sc.access, sc.engineMissing and sc.update shape the v5 shell's notices; the old check sets none.
const setup = {
  platform: sc.platform,
  engineEntry: sc.engineMissing ? null : "/engine/src/index.js",
  engineRoot: sc.engineMissing ? null : paths.engineRoot,
  engineSource: sc.engineMissing ? null : "bundled",
  captureDir: sc.engineMissing ? null : paths.captureDir,
  access: sc.access ?? "ok",
  appVersion: "0.0.0",
  builtAt: null,
};
const update = { phase: "off", version: null, percent: null, error: null, ...sc.update };
// sc.fixOutcome: what "Fix capture permissions…" answers (the password prompt closed, say);
// sc.npcapPending: the driver install never answers, so the notice is shot while it fetches.
const never = new Promise(() => {});
// autoCapture off: the check must not press Start behind its own back. A set stores and answers
// what it stored, as main does — the v5 check picks a language and a theme in the settings drawer
// and expects them to stay; the old check sets nothing.
let settings = { autoCapture: false, language: sc.lang, theme: sc.theme };
const store = (patch) => {
  settings = { ...settings, ...patch };
  return ok(settings);
};

const ok = (value) => Promise.resolve(value);

const bridge = {
  platform: sc.platform,
  start: () => ok(),
  stop: () => ok(),
  getState: () => ok(state),
  reveal: () => ok(true),
  getSetup: () => ok(setup),
  fixMacPermissions: () => ok({ setup, outcome: sc.fixOutcome ?? null, detail: null }),
  installNpcap: () => (sc.npcapPending ? never : ok({ setup, install: { outcome: "cancelled", version: null, detail: null } })),
  openNpcapPage: () => ok(),
  pickEnginePath: () => ok(setup),
  onState: (listener) => {
    onStateListeners.add(listener);
    return () => {
      onStateListeners.delete(listener);
    };
  },
  getPairing: () => ok(pairing),
  // Every code is refused: the failure sentence is the tallest thing the steps can hold — the
  // refusal of sc.pairFailure, if a scenario names another (an EPairFailure). sc.pairPending: the
  // answer never comes, so a scenario sees the panel while a code is checked; sc.pairOk: accepted.
  pair: () =>
    sc.pairPending
      ? never
      : sc.pairOk
        ? ok({ ok: true, status: setPairing(PAIRED), failure: null, detail: null })
        : ok({ ok: false, status: pairing, failure: sc.pairFailure ?? "refused", detail: null }),
  unpair: () => ok(setPairing(UNPAIRED)),
  setUpload: (enabled) => ok(setPairing({ ...pairing, uploadEnabled: enabled !== false })),
  openLoot: () => ok(),
  openPrivacy: () => ok(),
  onPairing: (listener) => {
    onPairingListeners.add(listener);
    return () => {
      onPairingListeners.delete(listener);
    };
  },
  getUpdate: () => ok(update),
  updateRestart: () => ok({ ok: true }),
  onUpdate: () => () => {},
  getSettings: () => ok(settings),
  setAutoCapture: (autoCapture) => store({ autoCapture }),
  setLanguage: (language) => store({ language }),
  setTheme: (theme) => store({ theme }),
  updateCheckNow: () => ok(update),
  copyText: () => ok(),
};

// Every call the page makes, in order, by name and arguments — the subscriptions (on*) apart — so a
// tool can tell that a control reached the bridge at all: the v5 check presses each of the settings
// drawer's controls and reads the calls back from `gbcStub.calls()`. The old check never asks.
const calls = [];
const recorded = Object.fromEntries(
  Object.entries(bridge).map(([name, value]) =>
    typeof value !== "function" || /^on[A-Z]/.test(name)
      ? [name, value]
      : [
          name,
          (...args) => {
            calls.push({ name, args });
            return value(...args);
          },
        ],
  ),
);

contextBridge.exposeInMainWorld("gbc", recorded);
contextBridge.exposeInMainWorld("gbcStub", { calls: () => calls.map((call) => ({ name: call.name, args: call.args })) });
