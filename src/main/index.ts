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

import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
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
import { decryptToken, encryptPairing, EStoreOutcome } from "./pairingStore.js";
import { apiBase, EPairOutcome, pairDevice } from "./uploadClient.js";
import { createUploader, type TUploader } from "./uploader.js";

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

const createWindow = (): void => {
  win = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    backgroundColor: "#14161b",
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
    const choice = dialog.showMessageBoxSync(win as BrowserWindow, {
      type: "question",
      buttons: ["Stop and quit", "Keep capturing"],
      defaultId: 1,
      cancelId: 1,
      title: "Stop capturing?",
      message: "Capture is still running. Quit and stop logging loot?",
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
      // Npcap's installer asks for elevation itself (its manifest), so this is
      // where Windows shows the UAC prompt — the app never elevates.
      run: async (file) => {
        await new Promise<void>((resolve, reject) => {
          execFile(file, { timeout: 15 * 60_000, windowsHide: false }, (err) => {
            if (err != null && (err as NodeJS.ErrnoException).code !== undefined && err.message.includes("EACCES")) {
              reject(err);
              return;
            }
            // A non-zero exit means the member cancelled the wizard; the
            // re-probe decides, not the exit code.
            resolve();
          });
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
    // Without a guild the deep link has no target — send them to the app root
    // rather than a 404 that reads as the feature being broken.
    const url =
      guildId != null && guildId.length > 0
        ? `${apiBase(settings.apiBase)}/?guild=${encodeURIComponent(guildId)}`
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
