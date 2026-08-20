/**
 * Renderer — a dumb view over the main process's TCaptureState snapshots plus
 * a TSetupStatus probe. No state of its own beyond a 1-second clock tick for
 * the "seen Ns ago" lines. Everything it can do goes through the preload
 * bridge (`window.gbc`); it has no Node, no Electron, no network.
 */

import {
  ECaptureAccess,
  ECaptureStatus,
  EEngineErrorKind,
  EPermissionFixOutcome,
  lootLinesOf,
  type TCaptureState,
  type TPermissionFixResult,
  type TSetupStatus,
} from "../shared/captureTypes.js";
import { STR } from "../shared/strings.js";

type TGbc = {
  platform: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => Promise<TCaptureState>;
  reveal: () => Promise<boolean>;
  getSetup: () => Promise<TSetupStatus>;
  fixMacPermissions: () => Promise<TPermissionFixResult>;
  openNpcapPage: () => Promise<void>;
  pickEnginePath: () => Promise<TSetupStatus>;
  onState: (listener: (state: TCaptureState) => void) => () => void;
};

const gbc = (window as unknown as { gbc: TGbc }).gbc;

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found == null) {
    throw new Error(`missing element #${id}`);
  }
  return found as T;
};

const ui = {
  statusDot: el<HTMLSpanElement>("status-dot"),
  statusLabel: el<HTMLSpanElement>("status-label"),
  statusHint: el<HTMLParagraphElement>("status-hint"),
  hints: el<HTMLDivElement>("waiting-hints"),
  hintsTitle: el<HTMLParagraphElement>("waiting-hints-title"),
  hintsList: el<HTMLUListElement>("waiting-hints-list"),
  statCharacter: el<HTMLSpanElement>("stat-character"),
  statLoot: el<HTMLSpanElement>("stat-loot"),
  statTraffic: el<HTMLSpanElement>("stat-traffic"),
  statFile: el<HTMLSpanElement>("stat-file"),
  revealBtn: el<HTMLButtonElement>("btn-reveal"),
  primaryBtn: el<HTMLButtonElement>("btn-primary"),
  errorPanel: el<HTMLDivElement>("error-panel"),
  errorTitle: el<HTMLParagraphElement>("error-title"),
  errorBody: el<HTMLParagraphElement>("error-body"),
  errorFixMac: el<HTMLButtonElement>("btn-fix-mac"),
  errorGetNpcap: el<HTMLButtonElement>("btn-get-npcap"),
  errorChooseEngine: el<HTMLButtonElement>("btn-error-choose-engine"),
  errorFixNote: el<HTMLParagraphElement>("error-fix-note"),
  errorDetails: el<HTMLDetailsElement>("error-details"),
  errorDetailText: el<HTMLPreElement>("error-detail-text"),
  setupPanel: el<HTMLDivElement>("setup-panel"),
  setupEngine: el<HTMLLIElement>("setup-engine"),
  setupAccess: el<HTMLLIElement>("setup-access"),
  setupFixMac: el<HTMLButtonElement>("btn-setup-fix-mac"),
  setupGetNpcap: el<HTMLButtonElement>("btn-setup-get-npcap"),
  setupFixNote: el<HTMLParagraphElement>("setup-fix-note"),
  advEngine: el<HTMLSpanElement>("adv-engine-path"),
  advChoose: el<HTMLButtonElement>("btn-choose-engine"),
  footer: el<HTMLParagraphElement>("footer-credit"),
  version: el<HTMLSpanElement>("app-version"),
};

let state: TCaptureState | null = null;
let setup: TSetupStatus | null = null;
/** Last "Fix capture permissions…" attempt this window — feedback, not state. */
let fixAttempt: TPermissionFixResult | null = null;

const WAITING_HINTS_AFTER_MS = 90_000;

const STATUS_LABEL: Record<ECaptureStatus, string> = {
  [ECaptureStatus.Idle]: STR.status.idle,
  [ECaptureStatus.Starting]: STR.status.starting,
  [ECaptureStatus.Waiting]: STR.status.waiting,
  [ECaptureStatus.Capturing]: STR.status.capturing,
  [ECaptureStatus.Stopping]: STR.status.stopping,
  [ECaptureStatus.Restarting]: STR.status.restarting,
  [ECaptureStatus.Error]: STR.status.error,
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
      return s.character != null ? STR.statusHint.capturingAs(s.character) : STR.statusHint.capturing;
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
  ui.statusLabel.textContent = STATUS_LABEL[s.status];
  ui.statusHint.textContent = statusHintFor(s);

  const waitingLong =
    s.status === ECaptureStatus.Waiting && s.runStartedAt != null && now - s.runStartedAt > WAITING_HINTS_AFTER_MS;
  show(ui.hints, waitingLong);

  ui.statCharacter.textContent = s.character ?? (running ? STR.stats.characterUnknown : "—");
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
    show(
      ui.errorGetNpcap,
      s.errorKind === EEngineErrorKind.NpcapMissing ||
        (s.errorKind === EEngineErrorKind.Permission && gbc.platform === "win32"),
    );
    show(ui.errorChooseEngine, s.errorKind === EEngineErrorKind.EngineMissing);
    const errorNote = s.errorKind === EEngineErrorKind.Permission && gbc.platform === "darwin" ? fixNoteText() : "";
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
          : STR.setup.permissionNeeded;
    show(ui.setupFixMac, setup.access === ECaptureAccess.NoPermission);
    show(
      ui.setupGetNpcap,
      setup.access === ECaptureAccess.NpcapMissing || setup.access === ECaptureAccess.NpcapAdminOnly,
    );
    const setupNote = fixNoteText();
    ui.setupFixNote.textContent = setupNote;
    show(ui.setupFixNote, setupNote.length > 0);
  }

  ui.advEngine.textContent = setup?.engineRoot ?? STR.advanced.engineNotFound;
  // The build time answers "am I looking at the code I just built?" — the
  // semver alone cannot (it only moves at releases).
  const builtShort =
    setup?.builtAt != null
      ? ` · built ${new Date(setup.builtAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "";
  ui.version.textContent = setup != null ? `v${setup.appVersion}${builtShort}` : "";
};

const refreshSetup = async (): Promise<void> => {
  setup = await gbc.getSetup();
  render();
};

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

// Static copy that never changes at runtime.
ui.hintsTitle.textContent = STR.waitingHints.title;
for (const hint of STR.waitingHints.items) {
  const li = document.createElement("li");
  li.textContent = hint;
  ui.hintsList.append(li);
}
ui.footer.textContent = STR.footer.engineCredit;
ui.revealBtn.textContent =
  gbc.platform === "darwin"
    ? STR.buttons.revealMac
    : gbc.platform === "win32"
      ? STR.buttons.revealWin
      : STR.buttons.reveal;

gbc.onState((next) => {
  state = next;
  render();
});

void gbc.getState().then((initial) => {
  state = initial;
  render();
});
void refreshSetup();

// Re-probe when the user comes back (they may have just installed Npcap or
// finished the macOS permission fix in another window).
window.addEventListener("focus", () => {
  void refreshSetup();
});

// The 1-second clock for "seen Ns ago" and the waiting-hints threshold.
setInterval(render, 1000);
