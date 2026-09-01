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

import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from "electron";
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
import { defaultDeviceName, isValidPairCodeShape, normalizePairCode } from "../shared/pairing.js";
import { IPC, NPCAP_URL } from "../shared/ipc.js";
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
import { loadSettings, saveSettings, settingsFilePath } from "./settings.js";
import { asLang, detectLang } from "../shared/i18n.js";
import { asTheme, type TTheme } from "../shared/captureTypes.js";
import { stringsFor } from "../shared/strings.js";
import { decryptToken, encryptPairing, EStoreOutcome } from "./pairingStore.js";
import {
  apiBase,
  EPairOutcome,
  pairDevice,
  sendEnergyLogPage,
  sendEnergyReading,
  sendFestivities,
} from "./uploadClient.js";
import electronUpdater from "electron-updater";

import { createUpdateController, updaterEnabled, type TUpdateController } from "./updateController.js";
import { createUploader, type TUploader } from "./uploader.js";
import type { TEngineEvent } from "./engineAdapter.js";

const APP_ROOT = app.getAppPath();
const SETTINGS_FILE = settingsFilePath(app.getPath("userData"));
const APP_LOG = join(app.getPath("userData"), "logs", "capture-app.log");

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
let state: TCaptureState = initialCaptureState;
let supervisor: TEngineSupervisor | null = null;
let tracker: TLogFileTracker | null = null;
let currentEngine: TResolvedEngine | null = null;
let quitConfirmed = false;

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
  state = reduceCaptureSession(state, ev);
  if (ev.type === "engine-line" && ev.event.kind === "festivities") {
    forwardFestivities(ev.event);
  }
  if (ev.type === "engine-line" && ev.event.kind === "energy") {
    forwardEnergy(ev.event);
  }
  if (ev.type === "engine-line" && ev.event.kind === "energy-log") {
    forwardEnergyLog(ev.event);
  }
  if (ev.type === "engine-exit") {
    appLog(`engine exit fatal=${ev.fatal ?? "none"} willRestart=${ev.willRestart} attempt=${ev.attempt}`);
  }
  if (state.status === ECaptureStatus.Idle || state.status === ECaptureStatus.Error) {
    stopTracker();
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
  // One last pass so the tail of a session is not left on disk until next time.
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
    access: await probeAccess(),
    appVersion: app.getVersion(),
    builtAt: BUILT_AT,
  };
};

// --- capture control ---------------------------------------------------------

const engineEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  if (process.platform === "win32") {
    env.PATH = npcapChildPathEnv(process.env.SystemRoot ?? "C:\\Windows", process.env.PATH);
  }
  return env;
};

const startCapture = (): void => {
  if (supervisor?.isActive() === true) {
    return;
  }
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
  startUploadLoop();

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
};

const stopCapture = (): void => {
  supervisor?.stopSession();
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

/** Windows overlay window-controls, tinted to match the active theme's title bar. */
const overlayFor = (theme: TTheme): { color: string; symbolColor: string; height: number } => {
  return theme === "parchment"
    ? { color: "#ece3cf", symbolColor: "#6b6353", height: 48 }
    : { color: "#0c0b0f", symbolColor: "#a7a39b", height: 48 };
};

const createWindow = (): void => {
  const theme = appSettings().theme;
  win = new BrowserWindow({
    // ONE window size for every state (owner ruling, 2026-08-29): the hero
    // zone flexes inside; idle gives its room to the pairing card. Content
    // size, not outer size — the merged title bar is part of the content.
    width: 660,
    height: 620,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // Merged OS chrome: the app's own 48px header IS the title bar. macOS
    // keeps its traffic lights over the app surface; Windows gets overlay
    // window controls in the same strip. Anywhere else (dev on Linux) the
    // normal frame stays — the CSS drag region is inert there.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 18 } }
      : process.platform === "win32"
        ? { titleBarStyle: "hidden" as const, titleBarOverlay: overlayFor(theme) }
        : {}),
    // Matches --gb-bg so the flash before first paint is the brand ground,
    // not a grey rectangle.
    backgroundColor: theme === "parchment" ? "#f3ecdd" : "#0a0a0c",
    title: "Guild Butler Capture",
    webPreferences: {
      preload: join(APP_ROOT, "dist", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu?.();
  void win.loadFile(join(APP_ROOT, "dist", "web", "renderer", "index.html"));
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
  ipcMain.handle(IPC.captureStart, () => {
    startCapture();
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
                declined ? "UAC prompt declined" : `installer failed to start: ${String(stderr || err.message).slice(0, 200)}`,
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
    const settings = loadSettings(SETTINGS_FILE);
    const narrowed = asLang(lang);
    if (narrowed == null) {
      // "System" (or garbage): drop the override so the OS decides again.
      delete settings.language;
    } else {
      settings.language = narrowed;
    }
    saveSettings(SETTINGS_FILE, settings);
    return appSettings();
  });
  ipcMain.handle(IPC.settingsSetTheme, (_event, theme: unknown): TAppSettings => {
    const settings = loadSettings(SETTINGS_FILE);
    const narrowed = asTheme(theme) ?? "obsidian";
    saveSettings(SETTINGS_FILE, { ...settings, theme: narrowed });
    if (process.platform === "win32") {
      try {
        win?.setTitleBarOverlay(overlayFor(narrowed));
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
    const guildId = settings.pairing?.guildId;
    // `tab=loot` lands them ON the Loot tab. Without it the dashboard follows the
    // guild and stops on Overview, so every press of this button ended with the
    // member hunting for the tab themselves — the actual complaint, reported
    // 2026-08-30. The dashboard validates the value against its own tab ids and
    // ignores anything else, so an old build sending a renamed id degrades to
    // today's behaviour rather than breaking.
    //
    // What this does NOT fix, and cannot: `shell.openExternal` hands a URL to the
    // system browser, which opens a new tab every time. Nothing outside a browser
    // can name or focus a tab already open in it.
    //
    // Without a guild the deep link has no target — send them to the app root
    // rather than a 404 that reads as the feature being broken.
    const url =
      guildId != null && guildId.length > 0
        ? `${apiBase(settings.apiBase)}/?guild=${encodeURIComponent(guildId)}&tab=loot`
        : apiBase(settings.apiBase);
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC.setupOpenNpcapPage, async () => {
    await shell.openExternal(NPCAP_URL);
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

  app.on("before-quit", () => {
    stopTracker();
    supervisor?.dispose();
  });
}
