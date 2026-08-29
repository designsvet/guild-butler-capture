/**
 * Renderer — a dumb view over the main process's TCaptureState snapshots plus
 * a TSetupStatus probe. No state of its own beyond a 1-second clock tick for
 * the "seen Ns ago" lines and the purely cosmetic log rain. Everything it can
 * do goes through the preload bridge (`window.gbc`); it has no Node, no
 * Electron, no network.
 *
 * Layout is the "focused HUD" (Direction B, 2026-08-29 canvas): one fixed
 * window, a greeting hero that flexes, the CTA pill in the eye path, pairing
 * anchored at the bottom, configuration behind the gear.
 */

import {
  ECaptureAccess,
  ECaptureStatus,
  EEngineErrorKind,
  ENpcapInstallOutcome,
  EPermissionFixOutcome,
  lootLinesOf,
  type TCaptureState,
  type TNpcapFixResult,
  type TPermissionFixResult,
  EPairFailure,
  initialPairingStatus,
  type TPairAttempt,
  type TPairingStatus,
  type TSetupStatus,
  ERestartRefusal,
  EUpdatePhase,
  initialUpdateStatus,
  asTheme,
  type TAppSettings,
  type TRestartResult,
  type TTheme,
  type TUpdateStatus,
} from "../shared/captureTypes.js";
import { asLang, detectLang, LANG_NAMES, SUPPORTED_LANGS, type TLang } from "../shared/i18n.js";
import { PAIR_COMMAND } from "../shared/ipc.js";
import { stringsFor } from "../shared/strings.js";

// The OS decides the DEFAULT language; a stored override (the gear's picker)
// arrives with the settings snapshot and re-applies everything live. The
// binding keeps the name STR so every call site reads as it always did.
let LANG: TLang = detectLang(navigator.language);
let STR = stringsFor(LANG);
document.documentElement.lang = LANG;

type TGbc = {
  platform: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => Promise<TCaptureState>;
  reveal: () => Promise<boolean>;
  getSetup: () => Promise<TSetupStatus>;
  fixMacPermissions: () => Promise<TPermissionFixResult>;
  installNpcap: () => Promise<TNpcapFixResult>;
  openNpcapPage: () => Promise<void>;
  pickEnginePath: () => Promise<TSetupStatus>;
  onState: (listener: (state: TCaptureState) => void) => () => void;
  getPairing: () => Promise<TPairingStatus>;
  pair: (code: string) => Promise<TPairAttempt>;
  unpair: () => Promise<TPairingStatus>;
  setUpload: (enabled: boolean) => Promise<TPairingStatus>;
  openLoot: () => Promise<void>;
  onPairing: (listener: (status: TPairingStatus) => void) => () => void;
  getUpdate: () => Promise<TUpdateStatus>;
  updateRestart: () => Promise<TRestartResult>;
  onUpdate: (listener: (status: TUpdateStatus) => void) => () => void;
  getSettings: () => Promise<TAppSettings>;
  setAutoCapture: (enabled: boolean) => Promise<TAppSettings>;
  setLanguage: (lang: string | null) => Promise<TAppSettings>;
  setTheme: (theme: string) => Promise<TAppSettings>;
  updateCheckNow: () => Promise<TUpdateStatus>;
  copyText: (text: string) => Promise<void>;
};

const gbc = (window as unknown as { gbc: TGbc }).gbc;

// The merged title bar needs per-platform padding (traffic lights left on
// macOS, overlay window controls right on Windows) — CSS keys off this.
document.documentElement.classList.add(`platform-${gbc.platform}`);

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found == null) {
    throw new Error(`missing element #${id}`);
  }
  return found as T;
};

const ui = {
  hero: el<HTMLElement>("hero"),
  rainCanvas: el<HTMLCanvasElement>("rain-canvas"),
  statusDot: el<HTMLSpanElement>("status-dot"),
  statusLabel: el<HTMLSpanElement>("status-label"),
  heroCharacter: el<HTMLSpanElement>("hero-character"),
  statusHint: el<HTMLParagraphElement>("status-hint"),
  hints: el<HTMLDivElement>("waiting-hints"),
  hintsTitle: el<HTMLParagraphElement>("waiting-hints-title"),
  hintsList: el<HTMLUListElement>("waiting-hints-list"),
  statLoot: el<HTMLSpanElement>("stat-loot"),
  statLootLabel: el<HTMLSpanElement>("stat-loot-label"),
  statTraffic: el<HTMLSpanElement>("stat-traffic"),
  statFile: el<HTMLSpanElement>("stat-file"),
  revealBtn: el<HTMLButtonElement>("btn-reveal"),
  primaryBtn: el<HTMLButtonElement>("btn-primary"),
  errorPanel: el<HTMLDivElement>("error-panel"),
  errorTitle: el<HTMLParagraphElement>("error-title"),
  errorBody: el<HTMLParagraphElement>("error-body"),
  errorFixMac: el<HTMLButtonElement>("btn-fix-mac"),
  errorInstallNpcap: el<HTMLButtonElement>("btn-install-npcap"),
  errorGetNpcap: el<HTMLButtonElement>("btn-get-npcap"),
  errorChooseEngine: el<HTMLButtonElement>("btn-error-choose-engine"),
  errorFixNote: el<HTMLParagraphElement>("error-fix-note"),
  errorDetails: el<HTMLDetailsElement>("error-details"),
  errorDetailText: el<HTMLPreElement>("error-detail-text"),
  errorDetailsSummary: el<HTMLElement>("error-details-summary"),
  setupPanel: el<HTMLDivElement>("setup-panel"),
  setupEngine: el<HTMLLIElement>("setup-engine"),
  setupAccess: el<HTMLLIElement>("setup-access"),
  setupFixMac: el<HTMLButtonElement>("btn-setup-fix-mac"),
  setupInstallNpcap: el<HTMLButtonElement>("btn-setup-install-npcap"),
  setupGetNpcap: el<HTMLButtonElement>("btn-setup-get-npcap"),
  setupFixNote: el<HTMLParagraphElement>("setup-fix-note"),
  version: el<HTMLSpanElement>("app-version"),
  // pairing — the two faces
  pairTitle: el<HTMLParagraphElement>("pairing-title"),
  pairSetup: el<HTMLDivElement>("pairing-setup"),
  pairIntro: el<HTMLParagraphElement>("pairing-intro"),
  pairStep1: el<HTMLSpanElement>("pairing-step1-label"),
  pairStep2: el<HTMLSpanElement>("pairing-step2-label"),
  copyCmdBtn: el<HTMLButtonElement>("btn-copy-cmd"),
  copyNote: el<HTMLSpanElement>("copy-note"),
  pairCode: el<HTMLInputElement>("pairing-code"),
  pairBtn: el<HTMLButtonElement>("btn-pair"),
  pairError: el<HTMLParagraphElement>("pairing-error"),
  pairConnected: el<HTMLDivElement>("pairing-connected"),
  pairAs: el<HTMLSpanElement>("pairing-as"),
  pairUploadStatus: el<HTMLSpanElement>("pairing-upload-status"),
  pairMore: el<HTMLButtonElement>("btn-pairing-more"),
  pairDetails: el<HTMLDivElement>("pairing-details"),
  pairUploadToggle: el<HTMLInputElement>("pairing-upload-toggle"),
  pairUploadLabel: el<HTMLSpanElement>("pairing-upload-label"),
  viewLootBtn: el<HTMLButtonElement>("btn-view-loot"),
  unpairBtn: el<HTMLButtonElement>("btn-unpair"),
  // gear + popover
  gearBtn: el<HTMLButtonElement>("btn-settings"),
  popover: el<HTMLDivElement>("settings-popover"),
  autoToggle: el<HTMLInputElement>("auto-capture-toggle"),
  autoLabel: el<HTMLSpanElement>("auto-capture-label"),
  langLabel: el<HTMLSpanElement>("lang-label"),
  langDd: el<HTMLDivElement>("lang-dd"),
  langBtn: el<HTMLButtonElement>("btn-lang"),
  langCurrent: el<HTMLSpanElement>("lang-current"),
  langMenu: el<HTMLDivElement>("lang-menu"),
  themeLabel: el<HTMLSpanElement>("theme-label"),
  themeObsidian: el<HTMLButtonElement>("theme-obsidian"),
  themeParchment: el<HTMLButtonElement>("theme-parchment"),
  themeObsidianLabel: el<HTMLSpanElement>("theme-obsidian-label"),
  themeParchmentLabel: el<HTMLSpanElement>("theme-parchment-label"),
  updatesLabel: el<HTMLSpanElement>("updates-label"),
  updateInline: el<HTMLSpanElement>("update-inline-status"),
  checkUpdatesBtn: el<HTMLButtonElement>("btn-check-updates"),
  advCaption: el<HTMLSpanElement>("adv-caption"),
  advEngine: el<HTMLSpanElement>("adv-engine-path"),
  advChoose: el<HTMLButtonElement>("btn-choose-engine"),
  credit: el<HTMLParagraphElement>("footer-credit"),
};

let state: TCaptureState | null = null;
let setup: TSetupStatus | null = null;
/** Last "Fix capture permissions…" attempt this window — feedback, not state. */
let fixAttempt: TPermissionFixResult | null = null;
/** Last in-app Npcap install attempt, and whether one is in flight. */
let npcapAttempt: TNpcapFixResult | null = null;
let npcapBusy = false;
let pairing: TPairingStatus = initialPairingStatus;
/** Last pairing attempt in THIS window — feedback, not persistent state. */
let pairFailure: EPairFailure | null = null;
let pairBusy = false;
let theme: TTheme = "obsidian";
/** The language picker's value: "system" or a TLang. */
let langValue = "system";

const WAITING_HINTS_AFTER_MS = 90_000;

const statusLabelFor = (status: ECaptureStatus): string => {
  const labels: Record<ECaptureStatus, string> = {
    [ECaptureStatus.Idle]: STR.status.idle,
    [ECaptureStatus.Starting]: STR.status.starting,
    [ECaptureStatus.Waiting]: STR.status.waiting,
    [ECaptureStatus.Capturing]: STR.status.capturing,
    [ECaptureStatus.Stopping]: STR.status.stopping,
    [ECaptureStatus.Restarting]: STR.status.restarting,
    [ECaptureStatus.Error]: STR.status.error,
  };
  return labels[status];
};

const statusHintFor = (s: TCaptureState): string => {
  switch (s.status) {
    case ECaptureStatus.Idle: {
      return STR.statusHint.idle;
    }
    case ECaptureStatus.Starting: {
      return STR.statusHint.starting;
    }
    case ECaptureStatus.Waiting: {
      return STR.statusHint.waiting;
    }
    case ECaptureStatus.Capturing: {
      // The greeting already says who — a hint repeating the name is noise.
      return s.character != null ? "" : STR.statusHint.capturing;
    }
    case ECaptureStatus.Stopping: {
      return STR.statusHint.stopping;
    }
    case ECaptureStatus.Restarting: {
      return STR.statusHint.restarting(Math.ceil((s.restartDelayMs ?? 1000) / 1000));
    }
    case ECaptureStatus.Error: {
      return "";
    }
  }
};

const errorCopy = (kind: EEngineErrorKind | null): { title: string; body: string } => {
  switch (kind) {
    case EEngineErrorKind.Permission: {
      // Same engine error, two platform stories: on Windows a capture-permission
      // failure means Npcap was installed admin-restricted.
      if (gbc.platform === "win32") {
        return { title: STR.errors.npcapAdminOnlyTitle, body: STR.errors.npcapAdminOnly };
      }
      return { title: STR.errors.permissionTitle, body: STR.errors.permission };
    }
    case EEngineErrorKind.NpcapMissing: {
      return { title: STR.errors.npcapMissingTitle, body: STR.errors.npcapMissing };
    }
    case EEngineErrorKind.AbiMismatch: {
      return { title: STR.errors.abiMismatchTitle, body: STR.errors.abiMismatch };
    }
    case EEngineErrorKind.EngineMissing: {
      return { title: STR.errors.engineMissingTitle, body: STR.errors.engineMissing };
    }
    default: {
      return { title: STR.errors.crashTitle, body: "" };
    }
  }
};

const basename = (path: string): string => {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
};

/** The feedback line under an "Install capture driver" attempt — "" hides it. */
const npcapNoteText = (): string => {
  if (npcapBusy) {
    return STR.setup.npcapInstalling;
  }
  switch (npcapAttempt?.install.outcome) {
    case ENpcapInstallOutcome.Installed: {
      return STR.setup.npcapInstalled(npcapAttempt.install.version);
    }
    case ENpcapInstallOutcome.NotCompleted: {
      return STR.setup.npcapNotCompleted;
    }
    case ENpcapInstallOutcome.Cancelled: {
      return STR.setup.npcapCancelled;
    }
    case ENpcapInstallOutcome.LaunchFailed: {
      return STR.setup.npcapLaunchFailed(npcapAttempt.install.detail != null ? npcapAttempt.install.detail.slice(0, 160) : null);
    }
    case ENpcapInstallOutcome.DownloadFailed: {
      return STR.setup.npcapDownloadFailed;
    }
    case ENpcapInstallOutcome.Untrusted: {
      return STR.setup.npcapUntrusted;
    }
    default: {
      return "";
    }
  }
};

/** The feedback line under a "Fix capture permissions…" attempt — "" hides it. */
const fixNoteText = (): string => {
  if (fixAttempt == null || setup?.access === ECaptureAccess.Ok) {
    return "";
  }
  switch (fixAttempt.outcome) {
    case EPermissionFixOutcome.Cancelled: {
      return STR.setup.permissionFixCancelled;
    }
    case EPermissionFixOutcome.Failed: {
      const detail = fixAttempt.detail != null ? fixAttempt.detail.slice(0, 160) : null;
      return STR.setup.permissionFixFailed(detail);
    }
    case EPermissionFixOutcome.StillBlocked: {
      return STR.setup.permissionFixStillBlocked;
    }
    default: {
      return "";
    }
  }
};

const show = (element: HTMLElement, visible: boolean): void => {
  element.classList.toggle("hidden", !visible);
};

const render = (): void => {
  if (state == null) {
    return;
  }
  const s = state;
  const now = Date.now();
  const running =
    s.status === ECaptureStatus.Starting ||
    s.status === ECaptureStatus.Waiting ||
    s.status === ECaptureStatus.Capturing;

  ui.statusDot.dataset.status = s.status;
  ui.statusLabel.textContent = statusLabelFor(s.status);
  ui.statusHint.textContent = statusHintFor(s);
  ui.hero.dataset.active = String(s.status === ECaptureStatus.Capturing);
  ui.hero.dataset.traffic = String(s.albionSeen);

  const waitingLong =
    s.status === ECaptureStatus.Waiting && s.runStartedAt != null && now - s.runStartedAt > WAITING_HINTS_AFTER_MS;
  show(ui.hints, waitingLong);

  // The greeting: the character's name in gold once known; the quiet
  // explanation (or a detecting note) in the same slot until then.
  const known = s.character != null;
  ui.heroCharacter.dataset.known = String(known);
  ui.heroCharacter.textContent = s.character ?? (running ? STR.stats.characterUnknown : STR.hero.noCharacter);

  ui.statLoot.textContent = String(lootLinesOf(s));
  if (s.albionSeen) {
    const ref = s.lastOutputAt ?? s.lastDetectedAt ?? now;
    ui.statTraffic.textContent = STR.stats.trafficSeenAgo(Math.max(0, Math.round((now - ref) / 1000)));
  } else {
    ui.statTraffic.textContent = STR.stats.trafficNotSeen;
  }
  ui.statFile.textContent = s.logFile != null ? basename(s.logFile) : STR.stats.logFileNone;
  ui.statFile.title = s.logFile ?? "";
  ui.revealBtn.disabled = s.logFile == null;

  const stoppedish = s.status === ECaptureStatus.Idle || s.status === ECaptureStatus.Error;
  ui.primaryBtn.textContent = stoppedish ? STR.buttons.start : STR.buttons.stop;
  ui.primaryBtn.dataset.mode = stoppedish ? "start" : "stop";
  ui.primaryBtn.disabled = s.status === ECaptureStatus.Stopping;

  // Error panel with its contextual fix actions.
  const isError = s.status === ECaptureStatus.Error;
  show(ui.errorPanel, isError);
  if (isError) {
    const copy = errorCopy(s.errorKind);
    ui.errorTitle.textContent = copy.title;
    ui.errorBody.textContent = copy.body;
    show(ui.errorFixMac, s.errorKind === EEngineErrorKind.Permission && gbc.platform === "darwin");
    show(ui.errorInstallNpcap, s.errorKind === EEngineErrorKind.NpcapMissing && gbc.platform === "win32");
    ui.errorInstallNpcap.disabled = npcapBusy;
    show(
      ui.errorGetNpcap,
      s.errorKind === EEngineErrorKind.NpcapMissing ||
        (s.errorKind === EEngineErrorKind.Permission && gbc.platform === "win32"),
    );
    show(ui.errorChooseEngine, s.errorKind === EEngineErrorKind.EngineMissing);
    const errorNote =
      s.errorKind === EEngineErrorKind.NpcapMissing
        ? npcapNoteText()
        : s.errorKind === EEngineErrorKind.Permission && gbc.platform === "darwin"
          ? fixNoteText()
          : "";
    ui.errorFixNote.textContent = errorNote;
    show(ui.errorFixNote, errorNote.length > 0);
    show(ui.errorDetails, s.errorDetail != null);
    ui.errorDetailText.textContent = s.errorDetail ?? "";
  }

  // Pre-flight checklist: only meaningful while idle, and only when something
  // is off — a clean setup renders nothing rather than a wall of green ticks.
  const engineOk = setup?.engineEntry != null;
  const accessOk = setup == null || setup.access === ECaptureAccess.Ok || setup.access === ECaptureAccess.Unknown;
  const showSetup = s.status === ECaptureStatus.Idle && setup != null && (!engineOk || !accessOk);
  show(ui.setupPanel, showSetup);
  if (showSetup && setup != null) {
    ui.setupEngine.dataset.ok = String(engineOk);
    ui.setupEngine.textContent = engineOk ? STR.setup.engineOk(setup.engineSource ?? "") : STR.setup.engineMissing;
    ui.setupAccess.dataset.ok = String(accessOk);
    ui.setupAccess.textContent =
      setup.access === ECaptureAccess.Ok
        ? STR.setup.accessOk
        : setup.access === ECaptureAccess.Unknown
          ? STR.setup.accessUnknown
          : setup.access === ECaptureAccess.NpcapMissing
            ? STR.setup.npcapNeeded
            : setup.access === ECaptureAccess.NpcapAdminOnly
              ? STR.setup.npcapAdminOnly
              : STR.setup.permissionNeeded;
    show(ui.setupFixMac, setup.access === ECaptureAccess.NoPermission);
    // Primary action is the in-app install; "download it myself" stays beside
    // it as the escape hatch for a blocked network or a refused signature.
    show(ui.setupInstallNpcap, setup.access === ECaptureAccess.NpcapMissing);
    ui.setupInstallNpcap.disabled = npcapBusy;
    show(
      ui.setupGetNpcap,
      setup.access === ECaptureAccess.NpcapMissing || setup.access === ECaptureAccess.NpcapAdminOnly,
    );
    const setupNote = npcapNoteText() || fixNoteText();
    ui.setupFixNote.textContent = setupNote;
    show(ui.setupFixNote, setupNote.length > 0);
  }

  // Fix cards replace the greeting zone — both never fight for the same room.
  show(ui.hero, !isError && !showSetup);

  ui.advEngine.textContent = setup?.engineRoot ?? STR.advanced.engineNotFound;
  // The build time answers "am I looking at the code I just built?" — the
  // semver alone cannot (it only moves at releases).
  const builtShort =
    setup?.builtAt != null
      ? ` · built ${new Date(setup.builtAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "";
  ui.version.textContent = setup != null ? `v${setup.appVersion}${builtShort}` : "";

  syncRain();
};

const refreshSetup = async (): Promise<void> => {
  setup = await gbc.getSetup();
  render();
  renderUpdateInline();
};

// --- the log rain (cosmetic, cheap by construction) ---------------------------
//
// One canvas, the session's flavor of loot lines drifting upward at ~12 fps.
// Runs ONLY while capturing, pauses when the window blurs or hides, and is off
// entirely under prefers-reduced-motion — the effect exists when someone is
// actually looking at a live session, and never costs a frame anywhere else.

const RAIN_POOL = [
  "3× Rugged Hide",
  "Adept's Broadsword",
  "T6 Sinew",
  "Greater Healing Potion",
  "Expert's Bow",
  "2× T5 Leather",
  "Elder's Rune",
  "Major Gigantify Potion",
  "T7 Cloth",
  "4× Bread",
  "Adept's Cleric Robe",
  "Journeyman's Cape",
  "T4 Planks",
  "2× Soul Rune",
  "Beef Stew",
  "Expert's Quarterstaff",
  "3× T6 Ore",
  "T5 Chestnut Planks",
  "Goose Eggs",
  "3× Limestone",
  "Adept's Frost Staff",
  "2× T6 Hide",
  "Pork Pie",
  "Expert's Cape",
];

type TRainColumn = { x: number; y: number; speed: number; dim: boolean; items: string[] };

const rain = ((): { sync: (active: boolean) => void; restyle: () => void } => {
  const canvas = ui.rainCanvas;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let columns: TRainColumn[] = [];
  let timer: number | null = null;
  let color = "rgba(230, 195, 108, 0.16)";
  let colorDim = "rgba(230, 195, 108, 0.10)";
  const LINE_H = 30;
  const TICK_MS = 83; // ~12 fps — ambience, not animation

  const readColors = (): void => {
    const styles = getComputedStyle(document.documentElement);
    color = styles.getPropertyValue("--gb-rain").trim() || color;
    colorDim = styles.getPropertyValue("--gb-rain-dim").trim() || colorDim;
  };

  const layout = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) {
      columns = [];
      return;
    }
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(3, Math.floor(w / 150));
    columns = Array.from({ length: count }, (_, i) => {
      // A short handful per column with a hole in the wrap — a packed ladder
      // of every item reads as a wall, not as rain.
      const shuffled = [...RAIN_POOL].sort(() => Math.random() - 0.5);
      return {
        x: 16 + (i * (w - 32)) / count,
        y: Math.random() * h,
        speed: 0.55 + Math.random() * 0.5,
        dim: i % 2 === 1,
        items: shuffled.slice(0, 6 + Math.floor(Math.random() * 3)),
      };
    });
  };

  const step = (): void => {
    if (ctx == null) {
      return;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    for (const col of columns) {
      col.y -= col.speed;
      const span = col.items.length * LINE_H + 120;
      if (col.y < -span) {
        col.y += span;
      }
      ctx.fillStyle = col.dim ? colorDim : color;
      // Draw two stacked copies so the wrap is seamless.
      for (let pass = 0; pass < 2; pass += 1) {
        const base = col.y + pass * span;
        for (let i = 0; i < col.items.length; i += 1) {
          const item = col.items[i];
          const y = base + i * LINE_H;
          if (item != null && y > 14 && y < h - 8) {
            ctx.fillText(item, col.x, y);
          }
        }
      }
    }
  };

  const start = (): void => {
    if (timer != null) {
      return;
    }
    readColors();
    layout();
    timer = window.setInterval(step, TICK_MS);
  };

  const stop = (): void => {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
    ctx?.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  };

  const sync = (active: boolean): void => {
    const shouldRun = active && !document.hidden && document.hasFocus() && !reduced.matches;
    if (shouldRun) {
      start();
    } else {
      stop();
    }
  };

  reduced.addEventListener?.("change", () => {
    sync(state?.status === ECaptureStatus.Capturing);
  });

  return { sync, restyle: readColors };
})();

const syncRain = (): void => {
  rain.sync(state?.status === ECaptureStatus.Capturing && !ui.hero.classList.contains("hidden"));
};

document.addEventListener("visibilitychange", syncRain);
window.addEventListener("blur", syncRain);

// --- wiring ------------------------------------------------------------------

ui.primaryBtn.addEventListener("click", () => {
  if (ui.primaryBtn.dataset.mode === "start") {
    void gbc.start();
  } else {
    void gbc.stop();
  }
});

ui.revealBtn.addEventListener("click", () => {
  void gbc.reveal();
});

const fixMac = async (): Promise<void> => {
  fixAttempt = await gbc.fixMacPermissions();
  setup = fixAttempt.setup;
  render();
};
ui.errorFixMac.addEventListener("click", () => {
  void fixMac();
});
ui.setupFixMac.addEventListener("click", () => {
  void fixMac();
});

const installNpcapDriver = async (): Promise<void> => {
  if (npcapBusy) {
    return;
  }
  npcapBusy = true;
  render();
  try {
    npcapAttempt = await gbc.installNpcap();
    setup = npcapAttempt.setup;
  } finally {
    npcapBusy = false;
    render();
  }
};
ui.setupInstallNpcap.addEventListener("click", () => {
  void installNpcapDriver();
});
ui.errorInstallNpcap.addEventListener("click", () => {
  void installNpcapDriver();
});

const openNpcap = (): void => {
  void gbc.openNpcapPage();
};
ui.errorGetNpcap.addEventListener("click", openNpcap);
ui.setupGetNpcap.addEventListener("click", openNpcap);

const chooseEngine = async (): Promise<void> => {
  setup = await gbc.pickEnginePath();
  render();
};
ui.advChoose.addEventListener("click", () => {
  void chooseEngine();
});
ui.errorChooseEngine.addEventListener("click", () => {
  void chooseEngine();
});

/**
 * Copy that does not change with capture state. Idempotent on purpose: the
 * language picker re-runs it live, so nothing here may append twice.
 */
const applyStatic = (): void => {
  ui.hintsTitle.textContent = STR.waitingHints.title;
  ui.hintsList.replaceChildren();
  for (const hint of STR.waitingHints.items) {
    const li = document.createElement("li");
    li.textContent = hint;
    ui.hintsList.append(li);
  }
  ui.statLootLabel.textContent = STR.stats.loot;
  ui.setupInstallNpcap.textContent = STR.buttons.installNpcap;
  ui.errorInstallNpcap.textContent = STR.buttons.installNpcap;
  ui.setupGetNpcap.textContent = STR.buttons.getNpcap;
  ui.errorGetNpcap.textContent = STR.buttons.getNpcap;
  ui.errorDetailsSummary.textContent = STR.buttons.details;
  ui.errorFixMac.textContent = STR.buttons.fixMacPermissions;
  ui.setupFixMac.textContent = STR.buttons.fixMacPermissions;
  ui.errorChooseEngine.textContent = STR.buttons.chooseEngine;
  ui.advChoose.textContent = STR.buttons.chooseEngine;
  ui.revealBtn.textContent =
    gbc.platform === "darwin"
      ? STR.buttons.revealMac
      : gbc.platform === "win32"
        ? STR.buttons.revealWin
        : STR.buttons.reveal;
  // gear popover
  ui.gearBtn.setAttribute("aria-label", STR.settings.gearLabel);
  ui.autoLabel.textContent = STR.prefs.autoCapture;
  ui.langLabel.textContent = STR.settings.language;
  ui.themeLabel.textContent = STR.settings.theme;
  ui.themeObsidianLabel.textContent = STR.settings.themeObsidian;
  ui.themeParchmentLabel.textContent = STR.settings.themeParchment;
  ui.updatesLabel.textContent = STR.settings.updates;
  ui.checkUpdatesBtn.textContent = STR.settings.checkUpdates;
  ui.advCaption.textContent = STR.settings.advancedEngine;
  ui.credit.textContent = STR.footer.engineCredit;
  // The picker names each language in ITSELF; only "System" translates.
  rebuildLangMenu();
  ui.copyCmdBtn.setAttribute("aria-label", STR.pairing.copy);
  ui.pairMore.setAttribute("aria-label", STR.pairing.more);
};

const applyLang = (lang: TLang): void => {
  LANG = lang;
  STR = stringsFor(lang);
  document.documentElement.lang = lang;
  applyStatic();
  render();
  renderPairing();
  renderUpdate();
  renderUpdateInline();
};

// --- pairing (ADR 0092 P2 slice 4) --------------------------------------------

const pairFailCopy = (failure: EPairFailure): string => {
  const map: Record<EPairFailure, string> = {
    [EPairFailure.BadCode]: STR.pairing.failBadCode,
    [EPairFailure.Refused]: STR.pairing.failRefused,
    [EPairFailure.Unreachable]: STR.pairing.failUnreachable,
    [EPairFailure.BadReply]: STR.pairing.failBadReply,
    [EPairFailure.NotDeployed]: STR.pairing.failNotDeployed,
    [EPairFailure.NoEncryption]: STR.pairing.failNoEncryption,
    [EPairFailure.StoreFailed]: STR.pairing.failStoreFailed,
  };
  return map[failure];
};

/**
 * One sentence per upload state. Note what is NOT here: no state says the loot
 * is lost, because it never is — the file on disk is the fallback and an
 * officer can still take it by hand.
 */
const uploadLine = (status: TPairingStatus): string => {
  if (!status.uploadEnabled) {
    return STR.pairing.uploadOffHint;
  }
  switch (status.upload.state) {
    case "sending":
      return STR.pairing.upSending;
    case "retrying":
      return STR.pairing.upRetrying;
    case "unauthorized":
      return STR.pairing.upUnauthorized;
    case "blocked":
      return STR.pairing.upBlocked;
    case "bot-outdated":
      return STR.pairing.upBotOutdated;
    default:
      return STR.pairing.upUpToDate(status.upload.sentTotal);
  }
};

const renderPairing = (): void => {
  ui.pairSetup.classList.toggle("hidden", pairing.paired);
  ui.pairConnected.classList.toggle("hidden", !pairing.paired);

  if (pairing.paired) {
    ui.pairAs.textContent = STR.pairing.pairedAs(pairing.deviceName ?? "this computer");
    ui.pairUploadStatus.textContent = uploadLine(pairing);
    ui.pairUploadToggle.checked = pairing.uploadEnabled;
    ui.pairUploadLabel.textContent = STR.pairing.uploadToggle;
    ui.viewLootBtn.textContent = STR.pairing.viewLoot;
    ui.unpairBtn.textContent = STR.pairing.unpair;
    return;
  }

  ui.pairTitle.textContent = STR.pairing.title;
  ui.pairIntro.textContent = STR.pairing.intro;
  ui.pairStep1.textContent = STR.pairing.step1;
  ui.pairStep2.textContent = STR.pairing.step2;
  ui.pairCode.placeholder = STR.pairing.codePlaceholder;
  ui.pairBtn.textContent = pairBusy ? STR.pairing.pairing : STR.pairing.pairShort;
  ui.pairBtn.disabled = pairBusy;
  const failure = pairFailure;
  ui.pairError.classList.toggle("hidden", failure == null);
  if (failure != null) {
    ui.pairError.textContent = pairFailCopy(failure);
  }
};

ui.pairBtn.addEventListener("click", () => {
  if (pairBusy) {
    return;
  }
  pairBusy = true;
  pairFailure = null;
  renderPairing();
  void gbc
    .pair(ui.pairCode.value)
    .then((attempt) => {
      pairing = attempt.status;
      pairFailure = attempt.failure;
      if (attempt.ok) {
        // The code is single-use; leaving it in the box invites a second press
        // that can only fail.
        ui.pairCode.value = "";
      }
    })
    .catch(() => {
      pairFailure = EPairFailure.Unreachable;
    })
    .finally(() => {
      pairBusy = false;
      renderPairing();
    });
});

ui.pairCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    ui.pairBtn.click();
  }
});

ui.unpairBtn.addEventListener("click", () => {
  void gbc.unpair().then((status) => {
    pairing = status;
    pairFailure = null;
    renderPairing();
  });
});

ui.pairUploadToggle.addEventListener("change", () => {
  void gbc.setUpload(ui.pairUploadToggle.checked).then((status) => {
    pairing = status;
    renderPairing();
  });
});

ui.viewLootBtn.addEventListener("click", () => {
  void gbc.openLoot();
});

ui.pairMore.addEventListener("click", () => {
  const open = ui.pairDetails.hidden;
  ui.pairDetails.hidden = !open;
  ui.pairMore.setAttribute("aria-expanded", String(open));
});

// Copy feedback clears itself; a second click restarts the clock.
let copyNoteTimer: number | null = null;
ui.copyCmdBtn.addEventListener("click", () => {
  void gbc.copyText(PAIR_COMMAND).then(() => {
    ui.copyNote.textContent = STR.pairing.copied;
    if (copyNoteTimer != null) {
      window.clearTimeout(copyNoteTimer);
    }
    copyNoteTimer = window.setTimeout(() => {
      ui.copyNote.textContent = "";
      copyNoteTimer = null;
    }, 1600);
  });
});

gbc.onPairing((status) => {
  pairing = status;
  renderPairing();
});

void gbc.getPairing().then((status) => {
  pairing = status;
  renderPairing();
});

// --- auto-update: strip + the gear's Updates row ------------------------------

const updateEls = {
  strip: el<HTMLDivElement>("update-strip"),
  text: el<HTMLParagraphElement>("update-text"),
  restart: el<HTMLButtonElement>("btn-update-restart"),
  note: el<HTMLParagraphElement>("update-note"),
};
let update: TUpdateStatus = initialUpdateStatus;

const renderUpdate = (): void => {
  updateEls.restart.textContent = STR.update.restartNow;
  const u = update;
  // Quiet phases stay invisible — the strip exists only when something is
  // actually happening. An Error shows as one muted line so a tester can see
  // it; capture is unaffected either way.
  const visible =
    u.phase === EUpdatePhase.Downloading || u.phase === EUpdatePhase.Ready || u.phase === EUpdatePhase.Error;
  updateEls.strip.classList.toggle("hidden", !visible);
  if (!visible) {
    updateEls.note.classList.add("hidden");
    return;
  }
  updateEls.restart.classList.toggle("hidden", u.phase !== EUpdatePhase.Ready);
  if (u.phase === EUpdatePhase.Downloading) {
    updateEls.text.textContent = STR.update.downloading(u.version, u.percent);
  } else if (u.phase === EUpdatePhase.Ready) {
    updateEls.text.textContent = STR.update.ready(u.version);
  } else {
    updateEls.text.textContent = STR.update.failed(u.error);
  }
};

/** The one-line summary in the gear popover — version first, state after. */
const renderUpdateInline = (): void => {
  const version = setup != null ? `v${setup.appVersion}` : "";
  const line = ((): string => {
    switch (update.phase) {
      case EUpdatePhase.Checking: {
        return STR.settings.checking;
      }
      case EUpdatePhase.Downloading: {
        return STR.update.downloading(update.version, update.percent);
      }
      case EUpdatePhase.Ready: {
        return STR.update.ready(update.version);
      }
      case EUpdatePhase.Error: {
        return STR.update.failed(update.error);
      }
      case EUpdatePhase.UpToDate: {
        return STR.settings.upToDate;
      }
      default: {
        return STR.settings.updateOff;
      }
    }
  })();
  ui.updateInline.textContent = version.length > 0 ? `${version} · ${line}` : line;
  ui.updateInline.title = line;
};

updateEls.restart.addEventListener("click", () => {
  void gbc.updateRestart().then((result: TRestartResult) => {
    if (!result.ok && result.reason === ERestartRefusal.Capturing) {
      updateEls.note.textContent = STR.update.blockedCapturing;
      updateEls.note.classList.remove("hidden");
    }
    // ok:true never renders — the app is quitting.
  });
});

ui.checkUpdatesBtn.addEventListener("click", () => {
  ui.checkUpdatesBtn.disabled = true;
  void gbc
    .updateCheckNow()
    .then((status) => {
      update = status;
      renderUpdate();
      renderUpdateInline();
    })
    .finally(() => {
      ui.checkUpdatesBtn.disabled = false;
    });
});

gbc.onUpdate((status) => {
  update = status;
  renderUpdate();
  renderUpdateInline();
});

void gbc.getUpdate().then((status) => {
  update = status;
  renderUpdate();
  renderUpdateInline();
});

let igniteTimer: number | null = null;

/**
 * The ignite beat: when a session actually reaches Capturing, the hero plays
 * one orchestrated reveal (dot pulse -> name -> count bloom -> chips) and the
 * rain fades in behind it. Only on a genuine transition — a window reopened
 * over an already-running capture starts calm.
 */
const maybeIgnite = (prev: ECaptureStatus | null, next: ECaptureStatus): void => {
  if (next !== ECaptureStatus.Capturing || prev === ECaptureStatus.Capturing || prev == null) {
    return;
  }
  ui.hero.classList.remove("ignite");
  // force a reflow so a rapid stop/start replays the animation
  void ui.hero.offsetWidth;
  ui.hero.classList.add("ignite");
  if (igniteTimer != null) {
    window.clearTimeout(igniteTimer);
  }
  igniteTimer = window.setTimeout(() => {
    ui.hero.classList.remove("ignite");
    igniteTimer = null;
  }, 950);
};

gbc.onState((next) => {
  const prev = state?.status ?? null;
  state = next;
  maybeIgnite(prev, next.status);
  render();
});

// --- the gear popover ---------------------------------------------------------

const setPopover = (open: boolean): void => {
  ui.popover.hidden = !open;
  ui.gearBtn.classList.toggle("open", open);
};

ui.gearBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setPopover(ui.popover.hidden);
});

document.addEventListener("click", (event) => {
  if (!ui.popover.hidden && !ui.popover.contains(event.target as Node)) {
    setPopover(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!ui.langMenu.hidden) {
      setLangOpen(false);
      return;
    }
    setPopover(false);
  }
});

// --- settings: auto-capture, language, theme ----------------------------------

const applyTheme = (next: TTheme): void => {
  theme = next;
  if (next === "parchment") {
    document.documentElement.dataset.theme = "parchment";
  } else {
    delete document.documentElement.dataset.theme;
  }
  ui.themeObsidian.setAttribute("aria-pressed", String(next === "obsidian"));
  ui.themeParchment.setAttribute("aria-pressed", String(next === "parchment"));
  rain.restyle();
};

const applySettings = (settings: TAppSettings): void => {
  ui.autoToggle.checked = settings.autoCapture;
  setLangValue(settings.language ?? "system");
  applyTheme(asTheme(settings.theme) ?? "obsidian");
  applyLang(asLang(settings.language) ?? detectLang(navigator.language));
};

/**
 * Auto-start goes through the exact same path as the button, once per window.
 * If permissions are missing the start lands on the fix card — which on a
 * first run is the right first thing to see, and better than a button the
 * member has to press to discover it. A member who pressed Stop is not
 * re-started (the flag), and a reopened window over an already-running
 * capture starts nothing (the Idle check).
 */
let autoStartDone = false;

const maybeAutoStart = (settings: TAppSettings): void => {
  applySettings(settings);
  if (autoStartDone || !settings.autoCapture) {
    return;
  }
  autoStartDone = true;
  if (state?.status === ECaptureStatus.Idle) {
    void gbc.start();
  }
};

ui.autoToggle.addEventListener("change", () => {
  void gbc.setAutoCapture(ui.autoToggle.checked).then((settings) => {
    ui.autoToggle.checked = settings.autoCapture;
  });
});

// --- the language dropdown (ours, not the OS's) -------------------------------

const langLabelFor = (value: string): string => {
  const lang = asLang(value);
  return lang != null ? LANG_NAMES[lang] : STR.settings.system;
};

const setLangOpen = (open: boolean): void => {
  ui.langMenu.hidden = !open;
  ui.langDd.dataset.open = String(open);
  ui.langBtn.setAttribute("aria-expanded", String(open));
};

const rebuildLangMenu = (): void => {
  ui.langMenu.replaceChildren();
  for (const value of ["system", ...SUPPORTED_LANGS]) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dd-item";
    item.dataset.value = value;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(value === langValue));
    const check = document.createElement("span");
    check.className = "dd-check";
    check.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 6.4 L4.8 9 L10 3.4"></path></svg>';
    const label = document.createElement("span");
    label.textContent = langLabelFor(value);
    item.append(check, label);
    item.addEventListener("click", () => {
      setLangOpen(false);
      pickLanguage(value);
    });
    ui.langMenu.append(item);
  }
  ui.langCurrent.textContent = langLabelFor(langValue);
};

const setLangValue = (value: string): void => {
  langValue = asLang(value) != null ? value : "system";
  ui.langCurrent.textContent = langLabelFor(langValue);
  for (const item of ui.langMenu.querySelectorAll<HTMLElement>(".dd-item")) {
    item.setAttribute("aria-selected", String(item.dataset.value === langValue));
  }
};

const pickLanguage = (value: string): void => {
  void gbc.setLanguage(value === "system" ? null : value).then((settings) => {
    setLangValue(settings.language ?? "system");
    applyLang(asLang(settings.language) ?? detectLang(navigator.language));
  });
};

ui.langBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setLangOpen(ui.langMenu.hidden);
});

document.addEventListener("click", (event) => {
  if (!ui.langMenu.hidden && !ui.langDd.contains(event.target as Node)) {
    setLangOpen(false);
  }
});

const pickTheme = (next: TTheme): void => {
  applyTheme(next);
  void gbc.setTheme(next).then((settings) => {
    applyTheme(asTheme(settings.theme) ?? "obsidian");
  });
};
ui.themeObsidian.addEventListener("click", () => {
  pickTheme("obsidian");
});
ui.themeParchment.addEventListener("click", () => {
  pickTheme("parchment");
});

void gbc.getState().then((initial) => {
  state = initial;
  render();
  // Settings are read AFTER the first state snapshot on purpose: the Idle
  // check above needs to know whether something is already running.
  void gbc.getSettings().then(maybeAutoStart);
});
void refreshSetup();
applyStatic();
renderPairing();

// Re-probe when the user comes back (they may have just installed Npcap or
// finished the macOS permission fix in another window). Focus also wakes the
// rain, which pauses on blur.
window.addEventListener("focus", () => {
  void refreshSetup();
  syncRain();
});

// The 1-second clock for "seen Ns ago" and the waiting-hints threshold.
setInterval(render, 1000);
