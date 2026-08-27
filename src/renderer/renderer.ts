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
  type TRestartResult,
  type TUpdateStatus,
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
  errorInstallNpcap: el<HTMLButtonElement>("btn-install-npcap"),
  errorGetNpcap: el<HTMLButtonElement>("btn-get-npcap"),
  errorChooseEngine: el<HTMLButtonElement>("btn-error-choose-engine"),
  errorFixNote: el<HTMLParagraphElement>("error-fix-note"),
  errorDetails: el<HTMLDetailsElement>("error-details"),
  errorDetailText: el<HTMLPreElement>("error-detail-text"),
  setupPanel: el<HTMLDivElement>("setup-panel"),
  setupEngine: el<HTMLLIElement>("setup-engine"),
  setupAccess: el<HTMLLIElement>("setup-access"),
  setupFixMac: el<HTMLButtonElement>("btn-setup-fix-mac"),
  setupInstallNpcap: el<HTMLButtonElement>("btn-setup-install-npcap"),
  setupGetNpcap: el<HTMLButtonElement>("btn-setup-get-npcap"),
  setupFixNote: el<HTMLParagraphElement>("setup-fix-note"),
  advEngine: el<HTMLSpanElement>("adv-engine-path"),
  advChoose: el<HTMLButtonElement>("btn-choose-engine"),
  footer: el<HTMLParagraphElement>("footer-credit"),
  version: el<HTMLSpanElement>("app-version"),
  pairTitle: el<HTMLParagraphElement>("pairing-title"),
  pairSetup: el<HTMLDivElement>("pairing-setup"),
  pairHint: el<HTMLParagraphElement>("pairing-hint"),
  pairCodeLabel: el<HTMLLabelElement>("pairing-code-label"),
  pairCode: el<HTMLInputElement>("pairing-code"),
  pairBtn: el<HTMLButtonElement>("btn-pair"),
  pairError: el<HTMLParagraphElement>("pairing-error"),
  pairConnected: el<HTMLDivElement>("pairing-connected"),
  pairAs: el<HTMLParagraphElement>("pairing-as"),
  pairUploadStatus: el<HTMLParagraphElement>("pairing-upload-status"),
  pairUploadToggle: el<HTMLInputElement>("pairing-upload-toggle"),
  pairUploadLabel: el<HTMLSpanElement>("pairing-upload-label"),
  viewLootBtn: el<HTMLButtonElement>("btn-view-loot"),
  unpairBtn: el<HTMLButtonElement>("btn-unpair"),
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

// Static copy that never changes at runtime.
ui.hintsTitle.textContent = STR.waitingHints.title;
for (const hint of STR.waitingHints.items) {
  const li = document.createElement("li");
  li.textContent = hint;
  ui.hintsList.append(li);
}
ui.setupInstallNpcap.textContent = STR.buttons.installNpcap;
ui.errorInstallNpcap.textContent = STR.buttons.installNpcap;
ui.setupGetNpcap.textContent = STR.buttons.getNpcap;
ui.errorGetNpcap.textContent = STR.buttons.getNpcap;
ui.footer.textContent = STR.footer.engineCredit;
ui.revealBtn.textContent =
  gbc.platform === "darwin"
    ? STR.buttons.revealMac
    : gbc.platform === "win32"
      ? STR.buttons.revealWin
      : STR.buttons.reveal;

// --- pairing (ADR 0092 P2 slice 4) --------------------------------------------

const PAIR_FAIL_COPY: Record<EPairFailure, string> = {
  [EPairFailure.BadCode]: STR.pairing.failBadCode,
  [EPairFailure.Refused]: STR.pairing.failRefused,
  [EPairFailure.Unreachable]: STR.pairing.failUnreachable,
  [EPairFailure.BadReply]: STR.pairing.failBadReply,
  [EPairFailure.NotDeployed]: STR.pairing.failNotDeployed,
  [EPairFailure.NoEncryption]: STR.pairing.failNoEncryption,
  [EPairFailure.StoreFailed]: STR.pairing.failStoreFailed,
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
  ui.pairTitle.textContent = STR.pairing.title;
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

  ui.pairHint.textContent = STR.pairing.notPairedHint;
  ui.pairCodeLabel.textContent = STR.pairing.codeLabel;
  ui.pairCode.placeholder = STR.pairing.codePlaceholder;
  ui.pairBtn.textContent = pairBusy ? STR.pairing.pairing : STR.pairing.pair;
  ui.pairBtn.disabled = pairBusy;
  const failure = pairFailure;
  ui.pairError.classList.toggle("hidden", failure == null);
  if (failure != null) {
    ui.pairError.textContent = PAIR_FAIL_COPY[failure];
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

gbc.onPairing((status) => {
  pairing = status;
  renderPairing();
});

void gbc.getPairing().then((status) => {
  pairing = status;
  renderPairing();
});

// --- auto-update strip -------------------------------------------------------

const updateEls = {
  strip: el<HTMLDivElement>("update-strip"),
  text: el<HTMLParagraphElement>("update-text"),
  restart: el<HTMLButtonElement>("btn-update-restart"),
  note: el<HTMLParagraphElement>("update-note"),
};
let update: TUpdateStatus = initialUpdateStatus;

const renderUpdate = (): void => {
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

updateEls.restart.addEventListener("click", () => {
  void gbc.updateRestart().then((result: TRestartResult) => {
    if (!result.ok && result.reason === ERestartRefusal.Capturing) {
      updateEls.note.textContent = STR.update.blockedCapturing;
      updateEls.note.classList.remove("hidden");
    }
    // ok:true never renders — the app is quitting.
  });
});

gbc.onUpdate((status) => {
  update = status;
  renderUpdate();
});

void gbc.getUpdate().then((status) => {
  update = status;
  renderUpdate();
});

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
