/**
 * Electron main process — the thin impure shell over the tested core:
 * window + IPC wiring, the real spawn/fs/timer implementations injected into
 * the supervisor and trackers, and the platform preflights.
 *
 * The engine child runs on Electron's OWN Node (`ELECTRON_RUN_AS_NODE=1`), so
 * members never install Node. Consequence: the engine's native `cap` module
 * must be built for Electron's ABI — `pnpm engine:rebuild` in the README; a
 * mismatch is detected and explained by the AbiMismatch error path.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, safeStorage, screen, shell } from "electron";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  promises as fsp,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import {
  ECaptureAccess,
  ECaptureStatus,
  EEngineErrorKind,
  ENpcapInstallOutcome,
  EPermissionFixOutcome,
  initialCaptureState,
  type TCaptureState,
  type TNpcapFixResult,
  type TPermissionFixResult,
  EPairFailure,
  initialPairingStatus,
  type TPairAttempt,
  type TPairingStatus,
  type TSetupStatus,
  type TAppSettings,
} from "../shared/captureTypes.js";
import { defaultDeviceName, isValidPairCodeShape, lootPageUrl, normalizePairCode } from "../shared/pairing.js";
import { IPC, NPCAP_URL, PRIVACY_URL } from "../shared/ipc.js";
import { reduceCaptureSession, type TSessionEvent } from "./captureSession.js";
import { resolveEngine, type TResolvedEngine } from "./engineLocator.js";
import { createEngineSupervisor, type TEngineSupervisor } from "./engineSupervisor.js";
import { createLogFileTracker, isLootLogName, type TLogCandidate, type TLogFileTracker } from "./logFileTracker.js";
import {
  checkBpfAccess,
  installBpfHelper,
  removeStagedBpfResources,
  stageBpfResources,
  type TBpfInstallResult,
} from "./platform/macBpf.js";
import { installNpcap, parseSignatureOutput, type TSignatureCheck } from "./platform/npcapInstall.js";
import { classifyNpcap, npcapChildPathEnv, probeNpcap } from "./platform/winNpcap.js";
import { talksToBot } from "./botFacing.js";
import { loadSettings, saveSettings, settingsFilePath, wantsV5Shell, withLanguage, withTheme } from "./settings.js";
import { asLang, detectLang } from "../shared/i18n.js";
import { asTheme } from "../shared/captureTypes.js";
import { stringsFor } from "../shared/strings.js";
import { decryptToken, encryptPairing, EStoreOutcome } from "./pairingStore.js";
import {
  apiBase,
  EPairOutcome,
  pairDevice,
  sendEnergyLogPage,
  sendEnergyReading,
  sendEngineHealth,
  sendFestivities,
} from "./uploadClient.js";
import { lootBroken, newlyBroken } from "../shared/engineHealth.js";
import { createHeldStore, heldUploadsFilePath } from "./heldUploads.js";
import {
  decoderVerdictFilePath,
  forgetDecoderVerdict,
  loadDecoderVerdict,
  saveDecoderVerdict,
} from "./decoderVerdict.js";
import electronUpdater from "electron-updater";

import { createUpdateController, updaterEnabled, type TUpdateController } from "./updateController.js";
import { createUploader, type TUploader } from "./uploader.js";
import { placeWindow, windowStateOf, type TPlacement } from "./windowBounds.js";
import { isOwnPage, overlayFor, shellOverlayFor, windowOptions } from "./windowOptions.js";
import { createWindowStateKeeper, loadWindowState, saveWindowState, windowStateFilePath } from "./windowState.js";
import type { TEngineEvent } from "./engineAdapter.js";
import { createSessionTracker, type TSessionTracker } from "./sessionTracker.js";
import { listSessionFiles, readSessionBytes, saveSessionSummary } from "./sessionDisk.js";
import { parseActivityLine, parseLootLine } from "../shared/session/events.js";
import type { TSession } from "../shared/session/model.js";
import { createItemArt } from "./itemArt.js";

// Images have one private scheme; its handler accepts only game item IDs and serves validated PNGs.
// This narrowly scoped scheme can serve images under the existing img-src 'self' policy.
protocol.registerSchemesAsPrivileged([
  { scheme: "albion-art", privileges: { standard: true, secure: true, bypassCSP: true } },
]);

const APP_ROOT = app.getAppPath();
const SETTINGS_FILE = settingsFilePath(app.getPath("userData"));
/** The v5 window's size and place — its own file, never settings.json (see windowState.ts). */
const WINDOW_STATE_FILE = windowStateFilePath(app.getPath("userData"));
const APP_LOG = join(app.getPath("userData"), "logs", "capture-app.log");
/** The lines the guild never gets — decoded while the decoder was broken (heldUploads.ts). */
const HELD_UPLOADS_FILE = heldUploadsFilePath(app.getPath("userData"));
/** A broken decoder, kept with the app version it was reached on (decoderVerdict.ts). */
const DECODER_VERDICT_FILE = decoderVerdictFilePath(app.getPath("userData"));

/** Build timestamp stamped by tools/build-static.mjs — identifies WHICH build runs. */
const BUILT_AT: string | null = (() => {
  try {
    const parsed = JSON.parse(readFileSync(join(APP_ROOT, "dist", "buildstamp.json"), "utf8")) as {
      builtAt?: unknown;
    };
    return typeof parsed.builtAt === "string" ? parsed.builtAt : null;
  } catch {
    return null;
  }
})();

let win: BrowserWindow | null = null;
/** Whether `win` is the v5 shell's window — its Windows caption buttons take the shell's colours. */
let winIsShell = false;
let state: TCaptureState = initialCaptureState;
let supervisor: TEngineSupervisor | null = null;
let tracker: TLogFileTracker | null = null;
let currentEngine: TResolvedEngine | null = null;
let quitConfirmed = false;
let sessionTracker: TSessionTracker | null = null;
let sessionValue: TSession | null = null;
let dataFinish: Promise<void> = Promise.resolve();
let startingCapture = false;
let startRevision = 0;
let quitDrained = false;
let quitDraining = false;
let captureStopped: (() => void) | null = null;

const finishDataSession = (): Promise<void> => {
  const tracker = sessionTracker;
  if (tracker != null) {
    sessionTracker = null;
    dataFinish = tracker.stop().catch((err: unknown) => {
      appLog(`[session] summary failed: ${String(err)}`);
    });
  }
  return dataFinish;
};

const startDataSession = (engine: TResolvedEngine, initialOffsets: Map<string, number>, at: number): void => {
  if (!heldUploadOn()) {
    return;
  }
  const replay = engine.source === "replay";
  sessionTracker = createSessionTracker({
    initialOffsets,
    list: () => listSessionFiles(engine.workDir),
    read: readSessionBytes,
    now: replay ? () => sessionValue?.lastAt ?? at : Date.now,
    id: randomUUID,
    log: appLog,
    save: (session) => saveSessionSummary(replay ? join(app.getPath("userData"), "replays") : engine.workDir, session),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
    onSnapshot: (session) => {
      sessionValue = session;
      win?.webContents.send(IPC.sessionChanged, session);
    },
  });
  // Replay starts at the first recorded timestamp; rates and durations never use today's clock.
  sessionValue = sessionTracker.snapshot();
  win?.webContents.send(IPC.sessionChanged, sessionValue);
};

/** Small on-disk breadcrumb trail for supporting members remotely. Best-effort. */
const appLog = (line: string): void => {
  try {
    mkdirSync(dirname(APP_LOG), { recursive: true });
    try {
      if (statSync(APP_LOG).size > 512 * 1024) {
        renameSync(APP_LOG, `${APP_LOG}.old`);
      }
    } catch {
      // first write — no file yet
    }
    appendFileSync(APP_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging must never break capturing
  }
};

const stopTracker = (): void => {
  tracker?.stop();
  tracker = null;
};

const dispatch = (ev: TSessionEvent): void => {
  const brokenBefore = state.engineBroken;
  state = reduceCaptureSession(state, ev);
  const fresh = newlyBroken(brokenBefore, state.engineBroken);
  // The mock engine's lines are invented: they never leave the machine (see botFacing.ts).
  const toBot = talksToBot(currentEngine?.source);
  if (toBot && fresh.length > 0) {
    forwardEngineHealth(fresh);
  }
  if (toBot && fresh.length > 0 && state.engineBroken != null) {
    // Remembered so this version, reopened, holds from its first second (decoderVerdict.ts).
    saveDecoderVerdict(DECODER_VERDICT_FILE, app.getVersion(), state.engineBroken);
  }
  // The flag last: it reads settings.json from disk, and this runs for every line the engine prints —
  // only the one event that breaks the decoder for loot should pay for that read.
  if (toBot && !lootBroken(brokenBefore) && lootBroken(state.engineBroken) && heldUploadOn()) {
    // The guild upload is held from this moment (uploader.ts): a pass now records where in the
    // file, rather than at the next tick, up to ten seconds on — and the foot says so at once.
    appLog("upload: held until the update — the decoder is broken where loot is concerned");
    void ensureUploader()
      .tick()
      .then(pushPairing)
      .catch((err: unknown) => {
        appLog(`[upload] held pass failed: ${err instanceof Error ? err.message : "error"}`);
      });
  }
  if (toBot && ev.type === "engine-line" && ev.event.kind === "festivities") {
    forwardFestivities(ev.event);
  }
  if (toBot && ev.type === "engine-line" && ev.event.kind === "energy") {
    forwardEnergy(ev.event);
  }
  if (toBot && ev.type === "engine-line" && ev.event.kind === "energy-log") {
    forwardEnergyLog(ev.event);
  }
  if (ev.type === "engine-exit") {
    appLog(`engine exit fatal=${ev.fatal ?? "none"} willRestart=${ev.willRestart} attempt=${ev.attempt}`);
  }
  if (state.status === ECaptureStatus.Idle || state.status === ECaptureStatus.Error) {
    stopTracker();
    void finishDataSession();
    captureStopped?.();
    captureStopped = null;
    // Same condition as the tracker on purpose: the uploader's lifetime is the
    // capture session's, and two separate end-detections would drift.
    stopUploadLoop();
  }
  win?.webContents.send(IPC.stateChanged, state);
};

// --- auto-update (Phase 3, Windows slice) -------------------------------------

// Thin adapter: electron-updater's `on` is keyed to its own event map, while
// the controller keeps a loose, injectable surface — the cast lives HERE, once.
const realUpdater = electronUpdater.autoUpdater;
const updates: TUpdateController = createUpdateController({
  updater: {
    get autoDownload() {
      return realUpdater.autoDownload;
    },
    set autoDownload(v: boolean) {
      realUpdater.autoDownload = v;
    },
    get autoInstallOnAppQuit() {
      return realUpdater.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(v: boolean) {
      realUpdater.autoInstallOnAppQuit = v;
    },
    on: (event, listener) => realUpdater.on(event as never, listener as never),
    checkForUpdates: () => realUpdater.checkForUpdates(),
    quitAndInstall: () => {
      realUpdater.quitAndInstall();
    },
  },
  enabled: updaterEnabled(process.platform, app.isPackaged, process.env),
  // Starting/waiting/capturing all mean a live engine child — never cut it.
  engineRunning: () => state.status !== ECaptureStatus.Idle && state.status !== ECaptureStatus.Error,
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => {
      clearTimeout(t);
    };
  },
  log: appLog,
  onStatus: (status) => {
    win?.webContents.send(IPC.updateChanged, status);
  },
});

// --- pairing + auto-upload (ADR 0092 P2 slice 4) ------------------------------
//
// Uploading is a convenience layered OVER capture, never a precondition for it.
// Nothing in this section may stop the engine, block a Start, or throw into the
// capture session: the log file on disk is the fallback and officers can still
// take it by hand.

let uploader: TUploader | null = null;
let uploadTimer: NodeJS.Timeout | null = null;

/**
 * Whether a broken decoder holds the guild upload (uploader.ts): the v5 shell's rule, so on where the
 * v5 shell is — the same test that picks the window (createWindow). The old window has no words for
 * a hold, and 0.8.x ships unchanged until the shell becomes the default.
 */
const heldUploadOn = (): boolean => wantsV5Shell(process.env, loadSettings(SETTINGS_FILE));

/** Every 10s while capturing. Uploading is not urgent; the file is safe. */
const UPLOAD_TICK_MS = 10_000;

/**
 * Forward one daily-bonus rotation (raid-bot ADR 0102).
 *
 * Fire-and-forget, and silent at both gates. **Not paired** is the ordinary state of a fresh
 * install, not an error to nag about. **No server** means the engine has not yet seen enough
 * traffic to tell Europe from Americas — sending anyway would mean guessing whose rotation this
 * is, and a wrong guess publishes a confidently wrong card to every guild on that server.
 *
 * No retry queue, deliberately: unlike loot, the rotation re-sends itself on the next login, and
 * a snapshot the bot already holds beats a queue of stale ones.
 */
const forwardFestivities = (event: Extract<TEngineEvent, { kind: "festivities" }>): void => {
  const settings = loadSettings(SETTINGS_FILE);
  const token = decryptToken(safeStorage, settings.pairing);
  if (token == null || event.server == null) {
    return;
  }
  void sendFestivities(fetch, settings.apiBase ?? "", token, {
    server: event.server,
    capturedAt: Date.now(),
    eventCode: event.code ?? 0,
    entries: event.entries,
  }).then((result) => {
    appLog(`festivities ${result.outcome} server=${event.server} entries=${event.entries.length}`);
  });
};

/**
 * A game update broke part of the engine's decoder (raid-bot ADR 0092 amendment, 2026-09-28).
 *
 * Logged for support first — the card on screen does not depend on anything below. Then, when
 * paired, the NEW handlers go to the bot, which posts them to its ops channel: that is how the
 * people who can ship the fix hear about it the first time any member meets the broken packet,
 * instead of days later from wrong loot. Only newly broken handlers, so a sticky verdict repeated
 * every minute costs one request per handler per app session.
 */
const forwardEngineHealth = (fresh: ReadonlyArray<{ handler: string; failures: number; calls: number }>): void => {
  appLog(`engine health: broken ${fresh.map((b) => `${b.handler} ${b.failures}/${b.calls}`).join(", ")}`);
  const settings = loadSettings(SETTINGS_FILE);
  const token = decryptToken(safeStorage, settings.pairing);
  if (token == null) {
    return;
  }
  void sendEngineHealth(fetch, settings.apiBase ?? "", token, {
    appVersion: app.getVersion(),
    broken: fresh,
  }).then((result) => {
    appLog(`engine health report ${result.outcome}`);
  });
};

/**
 * Send one guild siphoned-energy reading (raid-bot ADR 0022).
 *
 * Read time is stamped HERE rather than on the bot, because the reading is a fact about a
 * moment and the upload can be delayed by a slow network — a history that is differenced to
 * derive territory income would attribute that delay to the guild's territories.
 *
 * Unlike the rotation, this is one guild's private number: it goes nowhere without the
 * pairing, and the bot refuses a reading whose guild does not match what that Discord server
 * is bound to. No retry, for the reason in sendEnergyReading.
 */
const forwardEnergy = (event: Extract<TEngineEvent, { kind: "energy" }>): void => {
  const settings = loadSettings(SETTINGS_FILE);
  const token = decryptToken(safeStorage, settings.pairing);
  if (token == null) {
    return;
  }
  void sendEnergyReading(fetch, settings.apiBase ?? "", token, {
    server: event.server,
    guildName: event.guildName,
    albionGuildId: event.albionGuildId,
    total: event.total,
    readAt: Date.now(),
  }).then((result) => {
    appLog(`energy ${result.outcome} guild=${event.guildName} total=${event.total} changed=${event.changed}`);
  });
};

/**
 * Send one page of the guild's energy log (raid-bot ADR 0022).
 *
 * No read-time stamp here, unlike a reading: every row carries the game's own timestamp, and
 * when this page reached us says nothing about when the rows happened.
 *
 * A page with no guild id is still sent. The bot has a binding to check it against and will
 * refuse it; deciding here would put half the attribution rule in the client, where it cannot
 * be audited and cannot be fixed without a release.
 */
const forwardEnergyLog = (event: Extract<TEngineEvent, { kind: "energy-log" }>): void => {
  const settings = loadSettings(SETTINGS_FILE);
  const token = decryptToken(safeStorage, settings.pairing);
  if (token == null) {
    return;
  }
  void sendEnergyLogPage(fetch, settings.apiBase ?? "", token, {
    server: event.server,
    albionGuildId: event.albionGuildId,
    logType: event.logType,
    rows: event.rows,
  }).then((result) => {
    // The reason, when there is one: "energy-log Accepted rows=101" was printed for a whole
    // page the bot had thrown away, and that is how the missing logType hid for a day.
    const why = "detail" in result && result.detail ? ` (${result.detail})` : "";
    appLog(`energy-log ${result.outcome} rows=${event.rows.length}${why}`);
  });
};

const storedToken = (): string | null => {
  const pairing = loadSettings(SETTINGS_FILE).pairing;
  return decryptToken(safeStorage, pairing);
};

const pairingStatus = (): TPairingStatus => {
  const settings = loadSettings(SETTINGS_FILE);
  const pairing = settings.pairing;
  const up = uploader?.status() ?? null;
  return {
    paired: pairing != null,
    deviceName: pairing?.deviceName ?? null,
    guildId: pairing?.guildId ?? null,
    lootUrl: pairing != null ? lootPageUrl(apiBase(settings.apiBase), pairing.guildId) : null,
    pairedAt: pairing?.pairedAt ?? null,
    uploadEnabled: settings.uploadEnabled !== false,
    upload:
      up == null
        ? initialPairingStatus.upload
        : {
            state: up.state,
            sentTotal: up.sentTotal,
            lastSentAt: up.lastSentAt,
            failures: up.failures,
            lastError: up.lastError,
          },
  };
};

const pushPairing = (): void => {
  win?.webContents.send(IPC.pairingChanged, pairingStatus());
};

const ensureUploader = (): TUploader => {
  if (uploader != null) {
    return uploader;
  }
  uploader = createUploader({
    fetchLike: async (url, init) => {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, text: () => res.text() };
    },
    base: apiBase(loadSettings(SETTINGS_FILE).apiBase),
    token: storedToken,
    enabled: () => loadSettings(SETTINGS_FILE).uploadEnabled !== false,
    // The tracker knows the current file; before it finds one there is nothing
    // to send, which is not an error.
    currentFile: () => state.logFile,
    readFile: (path) => fsp.readFile(path, "utf8"),
    newRunId: () => randomUUID(),
    now: Date.now,
    log: appLog,
    // Sticky for the app session, as the break is: only the updated app clears it. Behind the v5
    // flag for now, as everything new is (SPEC ground rules): the old window says nothing of a
    // hold, and 0.8.x ships as it was. Ranges recorded under the flag are honoured either way.
    // The break first: the flag reads settings.json, and a healthy decoder (the old window's every
    // pass) need not read it at all.
    held: () => lootBroken(state.engineBroken) && heldUploadOn(),
    holds: createHeldStore(HELD_UPLOADS_FILE, appLog),
  });
  return uploader;
};

const startUploadLoop = (): void => {
  ensureUploader().resetSession();
  if (uploadTimer != null) {
    return;
  }
  uploadTimer = setInterval(() => {
    // Fire and forget: a rejected upload must never surface as an unhandled
    // rejection that could take the app down mid-raid.
    void ensureUploader()
      .tick()
      .then(pushPairing)
      .catch((err: unknown) => {
        appLog(`[upload] tick failed: ${err instanceof Error ? err.message : "error"}`);
      });
  }, UPLOAD_TICK_MS);
  uploadTimer.unref?.();
};

const stopUploadLoop = (): void => {
  if (uploadTimer != null) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }
  // One last pass so the tail of a session is not left on disk until next time — never for the mock
  // engine, whose file is invented (botFacing.ts).
  if (!talksToBot(currentEngine?.source)) {
    return;
  }
  void ensureUploader()
    .tick()
    .then(pushPairing)
    .catch(() => undefined);
};

// --- setup probing -----------------------------------------------------------

const regQuery = (keyPath: string, valueName: string): Promise<string> => {
  return new Promise((resolve) => {
    execFile("reg", ["query", keyPath, "/v", valueName], { timeout: 5000 }, (err, stdout) => {
      resolve(err != null ? "" : stdout);
    });
  });
};

const probeAccess = async (): Promise<ECaptureAccess> => {
  if (process.platform === "darwin") {
    return await checkBpfAccess();
  }
  if (process.platform === "win32") {
    const probe = await probeNpcap({
      exists: existsSync,
      regQuery,
      systemRoot: process.env.SystemRoot ?? "C:\\Windows",
    });
    return classifyNpcap(probe);
  }
  return ECaptureAccess.Unknown;
};

const resolveCurrentEngine = (): TResolvedEngine | null => {
  if (process.env.GBC_REPLAY_DIR != null) {
    const folder = process.env.GBC_REPLAY_DIR;
    currentEngine = { entry: "", root: folder, workDir: folder, source: "replay" };
    return currentEngine;
  }
  // Dev/demo escape hatch: GBC_MOCK_ENGINE=1 runs the bundled mock engine so
  // the whole app loop can be exercised with no game, no libpcap, no engine.
  if (process.env.GBC_MOCK_ENGINE === "1") {
    const mockCwd = join(app.getPath("userData"), "mock-captures");
    mkdirSync(mockCwd, { recursive: true });
    currentEngine = {
      entry: join(APP_ROOT, "tools", "mock-engine.cjs"),
      root: mockCwd,
      workDir: mockCwd,
      source: "mock",
    };
    return currentEngine;
  }
  const settings = loadSettings(SETTINGS_FILE);
  currentEngine = resolveEngine({
    configuredPath: settings.enginePath ?? null,
    resourcesPath: app.isPackaged ? process.resourcesPath : null,
    appRoot: APP_ROOT,
    dataDir: app.getPath("userData"),
    exists: existsSync,
    join,
    dirname,
  });
  return currentEngine;
};

const getSetup = async (): Promise<TSetupStatus> => {
  const engine = resolveCurrentEngine();
  return {
    platform: process.platform,
    engineEntry: engine?.entry ?? null,
    engineRoot: engine?.root ?? null,
    engineSource: engine?.source ?? null,
    captureDir: engine?.workDir ?? null,
    access: engine?.source === "replay" ? ECaptureAccess.Ok : await probeAccess(),
    appVersion: app.getVersion(),
    builtAt: BUILT_AT,
  };
};

// --- capture control ---------------------------------------------------------

const engineEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ...(heldUploadOn() ? { ACTIVITY_EVENTS: "1" } : {}),
  };
  if (process.platform === "win32") {
    env.PATH = npcapChildPathEnv(process.env.SystemRoot ?? "C:\\Windows", process.env.PATH);
  }
  return env;
};

const startCapture = async (): Promise<void> => {
  if (
    startingCapture ||
    quitDraining ||
    supervisor?.isActive() === true ||
    (currentEngine?.source === "replay" && sessionTracker != null)
  ) {
    return;
  }
  startingCapture = true;
  const revision = ++startRevision;
  try {
    await dataFinish;
    if (quitDraining || revision !== startRevision) {
      return;
    }
    sessionValue = null;
    const engine = resolveCurrentEngine();
    if (engine == null) {
      // No process to supervise — synthesize the session so the UI tells the
      // one story: started, failed for a reason, here is the fix.
      dispatch({ type: "user-start", at: Date.now() });
      dispatch({
        type: "engine-exit",
        at: Date.now(),
        fatal: EEngineErrorKind.EngineMissing,
        detail: `No ao-loot-logger found next to ${APP_ROOT}`,
        willRestart: false,
        delayMs: 0,
        attempt: 0,
      });
      return;
    }
    if (engine.source === "replay") {
      const files = await listSessionFiles(engine.workDir);
      const events = (
        await Promise.all(
          files.map(async (file) =>
            (await fsp.readFile(file.path, "utf8")).split(/\r?\n/).flatMap((line) => {
              const event = file.path.endsWith(".jsonl") ? parseActivityLine(line) : parseLootLine(line);
              return event == null ? [] : [event];
            }),
          ),
        )
      ).flat();
      const first = events.reduce((at, event) => Math.min(at, event.at), Infinity);
      if (!Number.isFinite(first)) {
        throw new Error("No readable session events in replay folder");
      }
      if (quitDraining || revision !== startRevision) {
        return;
      }
      dispatch({ type: "user-start", at: first });
      startDataSession(engine, new Map(), first);
      const data = sessionTracker;
      if (data != null) {
        await data.poll();
      }
      dispatch({ type: "engine-line", at: first, event: { kind: "albion-detected" } });
      const character = data?.snapshot().character;
      if (character != null) {
        dispatch({ type: "engine-line", at: first, event: { kind: "character", name: character } });
      }
      appLog(`session: replay ${engine.workDir}; bot traffic disabled`);
      return;
    }
    const initialOffsets = new Map(
      (await listSessionFiles(engine.workDir).catch(() => [])).map((file) => [file.path, file.size]),
    );
    if (quitDraining || revision !== startRevision) {
      return;
    }
    startDataSession(engine, initialOffsets, Date.now());
    appLog(`start capture engine=${engine.entry} (${engine.source}) workDir=${engine.workDir}`);
    // The engine writes its log to cwd; a bundled engine's workDir is a per-user
    // captures folder that may not exist yet.
    mkdirSync(engine.workDir, { recursive: true });

    const nodeBin = process.env.GBC_NODE_BIN ?? process.execPath;
    supervisor = createEngineSupervisor({
      spawn: () =>
        spawn(nodeBin, [engine.entry], {
          cwd: engine.workDir,
          env: engineEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }),
      now: Date.now,
      emit: dispatch,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
      resolveLogPath: (name) => (isAbsolute(name) ? name : join(engine.workDir, name)),
    });
    supervisor.startSession();
    if (talksToBot(engine.source)) {
      startUploadLoop();
    } else {
      appLog("upload: off — the mock engine's lines never leave this computer");
    }

    stopTracker();
    if (!supervisor.isActive()) {
      // the spawn failed synchronously — the state is already Error, and a
      // poller with nothing to watch would just tick until the next session
      return;
    }
    tracker = createLogFileTracker({
      dirs: [engine.workDir],
      sinceMs: Date.now(),
      listDir: async (dir) => {
        const names = await fsp.readdir(dir);
        const out: TLogCandidate[] = [];
        for (const name of names) {
          if (!isLootLogName(name)) {
            continue;
          }
          try {
            const st = await fsp.stat(join(dir, name));
            out.push({ path: join(dir, name), mtimeMs: st.mtimeMs });
          } catch {
            // deleted between readdir and stat
          }
        }
        return out;
      },
      readFile: (path) => fsp.readFile(path, "utf8"),
      onUpdate: (file, lines) => dispatch({ type: "file-lines", at: Date.now(), file, lines }),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
    });
  } catch (err) {
    appLog(`[session] start failed: ${String(err)}`);
    await finishDataSession();
    throw err;
  } finally {
    startingCapture = false;
  }
};

const stopCapture = (): void => {
  startRevision += 1;
  if (currentEngine?.source === "replay") {
    dispatch({ type: "user-stop", at: Date.now() });
    dispatch({
      type: "engine-exit",
      at: Date.now(),
      fatal: null,
      detail: null,
      willRestart: false,
      delayMs: 0,
      attempt: 0,
    });
  } else {
    supervisor?.stopSession();
  }
};

// --- window ------------------------------------------------------------------

const macResourceDir = (): string => {
  return app.isPackaged ? join(process.resourcesPath, "mac") : join(APP_ROOT, "resources", "mac");
};

/** One app-log line describing /dev/bpf0..4 — the remote answer to "did the fix land?". */
const describeBpfDevices = async (): Promise<string> => {
  const parts: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    try {
      const st = await fsp.stat(`/dev/bpf${i}`);
      parts.push(`bpf${i}=uid:${st.uid},gid:${st.gid},mode:${(st.mode & 0o777).toString(8)}`);
    } catch (err) {
      parts.push(`bpf${i}=${(err as NodeJS.ErrnoException).code ?? "stat-failed"}`);
    }
  }
  return parts.join(" ");
};

/** The renderer-visible settings view, with untrusted stored values narrowed. */
const appSettings = (): TAppSettings => {
  const s = loadSettings(SETTINGS_FILE);
  return {
    autoCapture: s.autoCapture !== false,
    language: asLang(s.language),
    theme: asTheme(s.theme) ?? "obsidian",
  };
};

/** The app's language: the stored override, else the OS. */
const appLang = (): ReturnType<typeof detectLang> => {
  return asLang(loadSettings(SETTINGS_FILE).language) ?? detectLang(app.getLocale());
};

/** How long the v5 window must be still after a move or resize before its place is written. */
const WINDOW_STATE_DELAY_MS = 500;

/** Where the v5 window opens: the remembered place when it is still on a screen (windowBounds.ts). */
const placeShellWindow = (): TPlacement => {
  return placeWindow({
    stored: loadWindowState(WINDOW_STATE_FILE),
    workAreas: screen.getAllDisplays().map((display) => display.workArea),
    primary: screen.getPrimaryDisplay().workArea,
  });
};

/**
 * The v5 window remembers its size and place: written once it has been still after a move or a
 * resize, and when it closes. Registered before the window's own close handler, whose first move
 * on a Mac is to return — there, closing the window is not quitting, and the next window (a click
 * on the dock icon) opens from this file.
 */
const rememberPlace = (w: BrowserWindow): void => {
  const keeper = createWindowStateKeeper({
    read: () =>
      w.isDestroyed()
        ? null
        : windowStateOf({
            normalBounds: w.getNormalBounds(),
            maximized: w.isMaximized(),
            fullScreen: w.isFullScreen(),
            minimized: w.isMinimized(),
          }),
    write: (next) => {
      const ok = saveWindowState(WINDOW_STATE_FILE, next);
      if (!ok) {
        appLog(`window: could not write ${WINDOW_STATE_FILE}`);
      }
      return ok;
    },
    delayMs: WINDOW_STATE_DELAY_MS,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  });
  w.on("move", keeper.schedule);
  w.on("resize", keeper.schedule);
  w.on("maximize", keeper.schedule);
  w.on("unmaximize", keeper.schedule);
  w.on("close", keeper.flush);
  w.on("closed", keeper.dispose);
};

/**
 * The v5 page stays the only page in its window: a navigation anywhere else is refused, and so is
 * every new window (the page opens links through the bridge, as the old one does). Logged, so a
 * button that "does nothing" because of this is one grep away. The page is compared as Chromium
 * spells it (`getURL()`), not as Node would, so a data folder with an unusual character in its
 * path cannot make the page a stranger to itself.
 */
const guardShellPage = (w: BrowserWindow): void => {
  w.webContents.on("will-navigate", (event) => {
    if (!isOwnPage(event.url, w.webContents.getURL())) {
      event.preventDefault();
      appLog(`window: refused navigation to ${event.url.slice(0, 200)}`);
    }
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    appLog(`window: refused a new window for ${url.slice(0, 200)}`);
    return { action: "deny" };
  });
};

const createWindow = (): void => {
  const theme = appSettings().theme;
  // Which window opens: the old greeting (the default, as 0.8.x ships it) or the v5 shell
  // preview (dist/web/app, tools/build-app.mjs) in its own resizable window.
  const v5 = wantsV5Shell(process.env, loadSettings(SETTINGS_FILE));
  const placement = v5 ? placeShellWindow() : null;
  win = new BrowserWindow(
    windowOptions({
      platform: process.platform,
      theme,
      // Matches --gb-bg so the flash before first paint is the brand ground,
      // not a grey rectangle — the design system's values (ds/tokens.css: the
      // light theme and the dark default); test/designSystem.test.ts pins them.
      backgroundColor: theme === "parchment" ? "#F6F1E6" : "#0A0A0C",
      preload: join(APP_ROOT, "dist", "preload", "index.cjs"),
      shell: placement,
    }),
  );
  winIsShell = placement != null;
  win.removeMenu?.();
  const page = join(APP_ROOT, "dist", "web", v5 ? "app" : "renderer", "index.html");
  if (placement != null) {
    const { x, y, width, height } = placement.bounds;
    appLog(
      `window: the v5 shell preview (GBC_SHELL=v5 or settings.shell), ${placement.source} ` +
        `${width}x${height} at ${x},${y}${placement.maximized ? ", maximized" : ""}`,
    );
    guardShellPage(win);
    rememberPlace(win);
    if (placement.maximized) {
      // Created hidden (windowOptions), so it appears already maximized.
      win.maximize();
      win.show();
    }
  }
  void win.loadFile(page);
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send(IPC.stateChanged, state);
  });
  win.on("close", (event) => {
    // Windows/Linux: closing the window is quitting — confirm while capturing.
    // macOS closes the window and keeps capturing (dock icon stays), as usual.
    if (process.platform === "darwin" || quitConfirmed || supervisor?.isActive() !== true) {
      return;
    }
    event.preventDefault();
    // The one main-process surface with words on it follows the app language —
    // the stored override when there is one, the OS otherwise.
    const qc = stringsFor(appLang()).quitConfirm;
    const choice = dialog.showMessageBoxSync(win as BrowserWindow, {
      type: "question",
      buttons: [qc.quit, qc.cancel],
      defaultId: 1,
      cancelId: 1,
      title: qc.title,
      message: qc.message,
    });
    if (choice === 0) {
      quitConfirmed = true;
      win?.close();
    }
  });
  win.on("closed", () => {
    win = null;
  });
};

// --- IPC ---------------------------------------------------------------------

const registerIpc = (): void => {
  ipcMain.handle(IPC.captureStart, () => startCapture());
  ipcMain.handle(IPC.sessionGet, () => sessionValue);
  ipcMain.handle(IPC.sessionNew, async () => {
    if (sessionTracker == null) {
      throw new Error("No active session");
    }
    return await sessionTracker.newSession();
  });
  ipcMain.handle(IPC.captureStop, () => {
    stopCapture();
  });
  ipcMain.handle(IPC.captureGetState, () => {
    return state;
  });
  ipcMain.handle(IPC.captureReveal, () => {
    if (state.logFile != null && existsSync(state.logFile)) {
      shell.showItemInFolder(state.logFile);
      return true;
    }
    if (currentEngine != null) {
      void shell.openPath(currentEngine.workDir);
      return true;
    }
    return false;
  });
  ipcMain.handle(IPC.setupGet, async () => {
    return await getSetup();
  });
  ipcMain.handle(IPC.setupFixMacPermissions, async (): Promise<TPermissionFixResult> => {
    if (process.platform !== "darwin") {
      return { setup: await getSetup(), outcome: null, detail: null };
    }
    // Stage to a TCC-free temp dir first: the privileged trampoline cannot
    // read a File-Provider path (Dropbox/CloudStorage), and this app's dev
    // layout lives in one. See stageBpfResources.
    let result: TBpfInstallResult;
    try {
      const staged = stageBpfResources(macResourceDir());
      try {
        result = await installBpfHelper(staged.dir, staged.installerPath);
      } finally {
        removeStagedBpfResources(staged.dir);
      }
    } catch (err) {
      result = { ok: false, cancelled: false, detail: `staging failed: ${String(err)}` };
    }
    appLog(
      `bpf helper install ok=${result.ok} cancelled=${result.cancelled}` +
        (result.detail != null ? ` detail=${result.detail}` : ""),
    );
    appLog(`bpf devices after install: ${await describeBpfDevices()}`);
    const setup = await getSetup();
    const outcome = !result.ok
      ? result.cancelled
        ? EPermissionFixOutcome.Cancelled
        : EPermissionFixOutcome.Failed
      : setup.access === ECaptureAccess.Ok
        ? EPermissionFixOutcome.Completed
        : EPermissionFixOutcome.StillBlocked;
    appLog(`bpf fix outcome: ${outcome} (access=${setup.access})`);
    return { setup, outcome, detail: result.detail };
  });
  ipcMain.handle(IPC.setupInstallNpcap, async (): Promise<TNpcapFixResult> => {
    if (process.platform !== "win32") {
      return {
        setup: await getSetup(),
        install: { outcome: ENpcapInstallOutcome.Unsupported, version: null, detail: null },
      };
    }
    const install = await installNpcap({
      fetchText: async (url) => {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return await res.text();
      },
      download: async (url) => {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const dir = mkdtempSync(join(tmpdir(), "gbc-npcap-"));
        const file = join(dir, "npcap-setup.exe");
        await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
        return file;
      },
      // Authenticode via PowerShell: `Status|Subject` on one line, which
      // parseSignatureOutput turns into the verdict. Anything unexpected —
      // no PowerShell, odd output — parses to "not valid" and refuses.
      verify: async (file): Promise<TSignatureCheck> => {
        return await new Promise((resolve) => {
          execFile(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "$s = Get-AuthenticodeSignature -LiteralPath $env:GBC_FILE; " +
                "Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)",
            ],
            { timeout: 60_000, env: { ...process.env, GBC_FILE: file } },
            (err, stdout) => {
              resolve(err != null ? { status: null, subject: null } : parseSignatureOutput(stdout));
            },
          );
        });
      },
      // Npcap's installer demands elevation via its manifest, and that only
      // works through ShellExecute semantics — Start-Process. Plain execFile
      // (CreateProcess) CANNOT elevate: Windows answers ERROR_ELEVATION_REQUIRED
      // (740), libuv maps it to EACCES, and v0.3.1's runner turned that into
      // "you declined the prompt" for a prompt that never appeared. -Wait
      // blocks until the wizard exits; a real UAC decline makes Start-Process
      // throw ERROR_CANCELLED ("canceled by the user"), which is the ONE case
      // marked as a decline. A non-zero wizard exit still resolves — the
      // re-probe decides, not the exit code.
      run: async (file) => {
        await new Promise<void>((resolve, reject) => {
          execFile(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:GBC_FILE -Wait",
            ],
            { timeout: 15 * 60_000, windowsHide: false, env: { ...process.env, GBC_FILE: file } },
            (err, _stdout, stderr) => {
              if (err == null) {
                resolve();
                return;
              }
              const text = `${err.message} ${stderr ?? ""}`;
              const declined = /canceled by the user|cancelled by the user|0x800704C7|1223/i.test(text);
              const failure: Error & { gbcUacDeclined?: boolean } = new Error(
                declined
                  ? "UAC prompt declined"
                  : `installer failed to start: ${String(stderr || err.message).slice(0, 200)}`,
              );
              failure.gbcUacDeclined = declined;
              reject(failure);
            },
          );
        });
      },
      probe: probeAccess,
      cleanup: (file) => {
        try {
          rmSync(dirname(file), { recursive: true, force: true });
        } catch {
          // a leftover temp file must never surface as an install failure
        }
      },
      log: appLog,
    });
    appLog(`npcap install outcome=${install.outcome} version=${install.version ?? "?"} detail=${install.detail ?? ""}`);
    return { setup: await getSetup(), install };
  });

  ipcMain.handle(IPC.settingsGet, (): TAppSettings => {
    return appSettings();
  });
  ipcMain.handle(IPC.settingsSetAutoCapture, (_event, enabled: unknown): TAppSettings => {
    const settings = loadSettings(SETTINGS_FILE);
    saveSettings(SETTINGS_FILE, { ...settings, autoCapture: enabled !== false });
    return appSettings();
  });
  ipcMain.handle(IPC.settingsSetLanguage, (_event, lang: unknown): TAppSettings => {
    // "System" (or garbage) narrows to null: the override goes and the OS decides again.
    saveSettings(SETTINGS_FILE, withLanguage(loadSettings(SETTINGS_FILE), asLang(lang)));
    return appSettings();
  });
  ipcMain.handle(IPC.settingsSetTheme, (_event, theme: unknown): TAppSettings => {
    const narrowed = asTheme(theme) ?? "obsidian";
    saveSettings(SETTINGS_FILE, withTheme(loadSettings(SETTINGS_FILE), narrowed));
    if (process.platform === "win32") {
      try {
        win?.setTitleBarOverlay(winIsShell ? shellOverlayFor(narrowed) : overlayFor(narrowed));
      } catch {
        // overlay retint is cosmetic; never let it fail the theme switch
      }
    }
    return appSettings();
  });
  ipcMain.handle(IPC.updateCheck, async () => {
    if (updaterEnabled(process.platform, app.isPackaged, process.env)) {
      updates.checkNow();
    } else {
      // The manual backup Boris asked for still does something useful where
      // the updater is off (unsigned mac, dev builds): open the download page.
      await shell.openExternal(`${apiBase(loadSettings(SETTINGS_FILE).apiBase)}/download`);
    }
    return updates.status();
  });
  ipcMain.handle(IPC.appCopyText, (_event, text: unknown): void => {
    if (typeof text === "string" && text.length > 0 && text.length <= 200) {
      clipboard.writeText(text);
    }
  });
  ipcMain.handle(IPC.updateGet, () => updates.status());
  ipcMain.handle(IPC.updateRestart, () => updates.restartNow());
  ipcMain.handle(IPC.pairingGet, () => pairingStatus());

  ipcMain.handle(IPC.pairingPair, async (_event, rawCode: unknown): Promise<TPairAttempt> => {
    const fail = (failure: EPairFailure, detail: string | null): TPairAttempt => {
      appLog(`[pair] failed: ${failure}${detail != null ? ` (${detail})` : ""}`);
      return { ok: false, failure, detail, status: pairingStatus() };
    };

    const code = normalizePairCode(typeof rawCode === "string" ? rawCode : "");
    if (!isValidPairCodeShape(code)) {
      // Caught locally: a typo costs no round trip, and the member gets the
      // specific "that's not 8 characters" sentence instead of a server error.
      return fail(EPairFailure.BadCode, null);
    }

    const settings = loadSettings(SETTINGS_FILE);
    const name = defaultDeviceName(hostname(), process.platform);
    const result = await pairDevice(
      async (url, init) => {
        const res = await fetch(url, init);
        return { ok: res.ok, status: res.status, text: () => res.text() };
      },
      apiBase(settings.apiBase),
      code,
      name,
    );
    if (result.outcome !== EPairOutcome.Paired) {
      const map = {
        [EPairOutcome.Refused]: EPairFailure.Refused,
        [EPairOutcome.Unreachable]: EPairFailure.Unreachable,
        [EPairOutcome.BadReply]: EPairFailure.BadReply,
        [EPairOutcome.NotDeployed]: EPairFailure.NotDeployed,
      } as const;
      return fail(map[result.outcome], result.detail);
    }

    // The token is written ENCRYPTED or not at all — see pairingStore.ts.
    const stored = encryptPairing(safeStorage, result.device, Date.now());
    if (stored.outcome !== EStoreOutcome.Stored) {
      return fail(
        stored.outcome === EStoreOutcome.NoEncryption ? EPairFailure.NoEncryption : EPairFailure.StoreFailed,
        stored.detail,
      );
    }
    saveSettings(SETTINGS_FILE, { ...settings, pairing: stored.pairing });
    uploader?.refresh();
    appLog(`[pair] connected as ${stored.pairing.deviceName} (guild ${stored.pairing.guildId})`);
    const status = pairingStatus();
    pushPairing();
    return { ok: true, failure: null, detail: null, status };
  });

  ipcMain.handle(IPC.pairingUnpair, (): TPairingStatus => {
    // Local only: the server's device row stays, so /capture devices still
    // shows the history and the member can revoke it there. Deleting it from
    // here would need the token we are about to forget.
    const settings = loadSettings(SETTINGS_FILE);
    delete settings.pairing;
    saveSettings(SETTINGS_FILE, settings);
    uploader?.refresh();
    appLog("[pair] disconnected on this computer");
    const status = pairingStatus();
    pushPairing();
    return status;
  });

  ipcMain.handle(IPC.pairingSetUpload, (_event, enabled: unknown): TPairingStatus => {
    const settings = loadSettings(SETTINGS_FILE);
    saveSettings(SETTINGS_FILE, { ...settings, uploadEnabled: enabled !== false });
    uploader?.refresh();
    const status = pairingStatus();
    pushPairing();
    return status;
  });

  ipcMain.handle(IPC.pairingOpenLoot, async () => {
    const settings = loadSettings(SETTINGS_FILE);
    // The deep link to the Loot tab, or the dashboard's root without a guild
    // (lootPageUrl says why). The v5 shell's link carries the same address
    // (pairingStatus's lootUrl).
    //
    // What this does NOT fix, and cannot: `shell.openExternal` hands a URL to the
    // system browser, which opens a new tab every time. Nothing outside a browser
    // can name or focus a tab already open in it.
    await shell.openExternal(lootPageUrl(apiBase(settings.apiBase), settings.pairing?.guildId ?? null));
  });

  ipcMain.handle(IPC.setupOpenNpcapPage, async () => {
    await shell.openExternal(NPCAP_URL);
  });
  ipcMain.handle(IPC.appOpenPrivacy, async () => {
    await shell.openExternal(PRIVACY_URL);
  });
  ipcMain.handle(IPC.setupPickEnginePath, async () => {
    const result = win == null ? null : await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    const picked = result?.filePaths[0];
    if (picked != null) {
      saveSettings(SETTINGS_FILE, { ...loadSettings(SETTINGS_FILE), enginePath: picked });
    }
    return await getSetup();
  });
};

const registerItemArt = (): void => {
  const cache = join(app.getPath("userData"), "item-art");
  const load = createItemArt({
    read: async (key) => {
      try {
        return await fsp.readFile(join(cache, `${key}.png`));
      } catch {
        return null;
      }
    },
    write: async (key, bytes) => {
      await fsp.mkdir(cache, { recursive: true });
      const path = join(cache, `${key}.png`);
      await fsp.writeFile(`${path}.tmp`, bytes);
      await fsp.rename(`${path}.tmp`, path);
    },
    fetch: async (url) => {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8_000) });
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body != null) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            length += value.byteLength;
            if (length > 1024 * 1024) {
              await reader.cancel();
              throw new Error("Item art response too large");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      return { ok: response.ok, bytes: Buffer.concat(chunks), contentType: response.headers.get("content-type") };
    },
    log: (message, error) => appLog(`[art] ${message}${error == null ? "" : `: ${String(error)}`}`),
  });
  protocol.handle("albion-art", async (request) => {
    const bytes = await load(request.url);
    return bytes == null
      ? new Response(null, { status: 404 })
      : new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "image/png" } });
  });
};

// --- lifecycle ---------------------------------------------------------------

// Packaged: single instance — an extra launch fronts the existing window.
// Dev: NO lock at all. The first hardware pass proved the lock is a dev trap
// twice over: macOS keeps the app alive when its window closes (deliberate —
// capture survives it), so a stale morning process silently swallowed three
// `pnpm dev` launches; and the first fix — the stale holder relaunching
// itself onto the new build — could never fire, because it lived in exactly
// the code the stale process kept from running. A guard whose fix ships
// inside the gated code cannot deploy itself: in dev the launch you typed
// must ALWAYS run, and the build-time chip tells concurrent windows apart.
const gotLock = app.isPackaged ? app.requestSingleInstanceLock() : true;
if (!gotLock) {
  console.error(
    "[gbc] Another Guild Butler Capture instance is already running — its window was brought to the front; this launch exits.",
  );
  app.quit();
} else {
  if (app.isPackaged) {
    app.on("second-instance", () => {
      if (win != null) {
        win.restore();
        win.focus();
      } else {
        createWindow();
      }
    });
  }

  void app.whenReady().then(() => {
    // A decoder this very version found broken before is broken still: start from that verdict, so a
    // reopened build holds the upload from its first line rather than from the engine's next report.
    // Behind the same flag as the hold itself; a verdict for another version is the update — forget it.
    const remembered = loadDecoderVerdict(DECODER_VERDICT_FILE, app.getVersion());
    if (remembered.stale) {
      forgetDecoderVerdict(DECODER_VERDICT_FILE);
    } else if (remembered.broken != null && heldUploadOn()) {
      state = { ...state, engineBroken: remembered.broken };
      appLog(`decoder: broken before on v${app.getVersion()} — the upload is held from the start`);
    }
    registerItemArt();
    registerIpc();
    createWindow();
    updates.start();
    appLog(`app start v${app.getVersion()} (built ${BUILT_AT ?? "unstamped"}) on ${process.platform}`);
  });

  app.on("activate", () => {
    if (win == null && app.isReady()) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (quitDrained || !heldUploadOn()) {
      stopTracker();
      supervisor?.dispose();
      return;
    }
    event.preventDefault();
    if (quitDraining) {
      return;
    }
    quitDraining = true;
    void (async () => {
      if (supervisor?.isActive()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 4_000);
          captureStopped = () => {
            clearTimeout(timer);
            resolve();
          };
          stopCapture();
        });
      }
      await finishDataSession();
      stopTracker();
      supervisor?.dispose();
      quitDrained = true;
      app.quit();
    })();
  });
}
