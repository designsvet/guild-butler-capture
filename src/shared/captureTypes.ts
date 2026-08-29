/**
 * Types shared by the main process, the preload bridge and the renderer.
 *
 * This module must stay platform-pure: no `electron`, no `node:*` imports —
 * it is compiled three times (ESM for main, CJS for the preload, browser ESM
 * for the renderer) and the renderer build has no Node at all.
 */

export enum ECaptureStatus {
  /** Nothing running. The resting state, and where a user Stop lands. */
  Idle = "idle",
  /** Engine spawned, nothing decoded from it yet. */
  Starting = "starting",
  /** Engine alive but no Albion traffic is being seen. */
  Waiting = "waiting",
  /** Albion traffic is being decoded — the good state. */
  Capturing = "capturing",
  /** User pressed Stop; waiting for the engine to flush and exit. */
  Stopping = "stopping",
  /** Engine died unexpectedly; a relaunch is scheduled. */
  Restarting = "restarting",
  /** Engine cannot run until the user fixes something (permissions, Npcap…). */
  Error = "error",
}

export enum EEngineErrorKind {
  /** macOS: /dev/bpf* is root-only (the reason the raw script needed sudo). */
  Permission = "permission",
  /** Windows: wpcap.dll nowhere to be found — Npcap is not installed. */
  NpcapMissing = "npcap-missing",
  /** Native `cap` module built for a different Node ABI than the one running it. */
  AbiMismatch = "abi-mismatch",
  /** The engine entry point (or its node_modules) is not on disk. */
  EngineMissing = "engine-missing",
  /** Unclassified nonzero exit — auto-restarted, never shown as fatal. */
  Crash = "crash",
}

/** The kinds a Start press can NOT recover from by retrying — no auto-restart loop into EPERM. */
export const isFatalErrorKind = (kind: EEngineErrorKind | null): boolean => {
  return kind != null && kind !== EEngineErrorKind.Crash;
};

/**
 * The one snapshot the renderer renders. Main owns it, every change is pushed
 * whole over IPC — the renderer never accumulates state of its own beyond a
 * 1-second clock for the "last seen Ns ago" style lines.
 */
export type TCaptureState = {
  status: ECaptureStatus;
  /** Albion traffic is being decoded in the CURRENT engine run. */
  albionSeen: boolean;
  /** Detected character name; sticky across engine restarts within a session. */
  character: string | null;
  /** Data lines the current engine run has written, as of the last heartbeat. */
  linesThisRun: number;
  /**
   * Loot lines counted from the engine's own live output SINCE that heartbeat.
   *
   * The heartbeat is only printed once a minute, so it alone makes the counter
   * up to a minute stale. The engine also prints one line per pickup the
   * moment it happens; those are counted here and the next heartbeat resets
   * this to zero, so an optimistic miscount can never accumulate — the
   * heartbeat stays the reconciling truth, this is only how the number moves
   * between two of them.
   */
  linesSinceHeartbeat: number;
  /** Data lines rolled up from earlier runs of this session (engine restarts). */
  linesPrevRuns: number;
  /** Absolute path of the newest log file. Kept after Stop so Reveal still works. */
  logFile: string | null;
  errorKind: EEngineErrorKind | null;
  /** Last raw engine lines around a failure — the "show technical details" text. */
  errorDetail: string | null;
  /** Session start (the user's Start press), epoch ms. Null when idle-from-boot. */
  startedAt: number | null;
  /** Current engine run's spawn time, epoch ms. */
  runStartedAt: number | null;
  /** Last time ANY engine output arrived. */
  lastOutputAt: number | null;
  /** Last time ALBION DETECTED fired. */
  lastDetectedAt: number | null;
  /** Last loot line seen, epoch ms — the renderer's cue to pulse. */
  lastLootAt: number | null;
  /** Consecutive unexpected-exit count feeding the restart backoff display. */
  restartAttempt: number;
  /** Next relaunch is due this many ms after the exit (display only). */
  restartDelayMs: number | null;
  /**
   * A heartbeat carrying a line count has been seen this run. While true, file
   * polling defers to the engine's own count instead of second-guessing it.
   */
  heartbeatSeen: boolean;
  stopRequested: boolean;
};

export const initialCaptureState: TCaptureState = {
  status: ECaptureStatus.Idle,
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
};

/** What the session-total counter shows: every run's lines, current one included. */
export const lootLinesOf = (state: TCaptureState): number => {
  return state.linesPrevRuns + state.linesThisRun + state.linesSinceHeartbeat;
};

/** Can the user's ability to capture be established before Start? Probed at boot + on focus. */
export enum ECaptureAccess {
  Ok = "ok",
  /** macOS: /dev/bpf* not readable by this user. */
  NoPermission = "no-permission",
  /** Windows: Npcap not installed at all. */
  NpcapMissing = "npcap-missing",
  /** Windows: Npcap installed but restricted to Administrators. */
  NpcapAdminOnly = "npcap-admin-only",
  /** Could not tell — fail open, a Start attempt will produce the real answer. */
  Unknown = "unknown",
}

export type TSetupStatus = {
  /** `process.platform` verbatim ("darwin", "win32", …). */
  platform: string;
  /** Resolved engine entry script, or null when nothing was found. */
  engineEntry: string | null;
  /** The engine repo root the entry came from (spawn cwd, log-file location). */
  engineRoot: string | null;
  /** Where the entry came from: "settings", "bundled", "sibling". */
  engineSource: string | null;
  access: ECaptureAccess;
  appVersion: string;
  /** Build timestamp (ISO) from dist/buildstamp.json — null on odd layouts. */
  builtAt: string | null;
};

/**
 * What actually happened when the user clicked "Fix capture permissions…".
 * The first hardware pass proved that a silent failure here reads as "the fix
 * doesn't work": the user grants a macOS SETTINGS dialog (unrelated), the
 * checklist still says permission needed, and nothing explains why.
 */
export enum EPermissionFixOutcome {
  /** Installer completed and the re-probe confirms access. */
  Completed = "completed",
  /** The admin password prompt was dismissed — nothing was changed. */
  Cancelled = "cancelled",
  /** The installer ran and failed (the app log has the stderr). */
  Failed = "failed",
  /** Installer reported success, yet the probe still says no access. */
  StillBlocked = "still-blocked",
}

/**
 * What happened when the app installed Npcap for the member (Windows).
 * Lives in shared, not in the platform module, because the renderer renders
 * one sentence per outcome — a generic "it didn't work" is the failure mode
 * the macOS permission bug taught us to avoid.
 */
export enum ENpcapInstallOutcome {
  Installed = "installed",
  NotCompleted = "not-completed",
  Cancelled = "cancelled",
  /** The installer never started — no UAC prompt was ever shown. */
  LaunchFailed = "launch-failed",
  DownloadFailed = "download-failed",
  Untrusted = "untrusted",
  Unsupported = "unsupported",
}

export type TNpcapInstallResult = {
  outcome: ENpcapInstallOutcome;
  /** Npcap version when known. */
  version: string | null;
  /** Diagnostic for the app log. */
  detail: string | null;
};

/** IPC reply for the in-app Npcap install: the re-probe plus what happened. */
export type TNpcapFixResult = {
  setup: TSetupStatus;
  install: TNpcapInstallResult;
};

export type TPermissionFixResult = {
  setup: TSetupStatus;
  /** Null when the fix does not apply (non-mac platforms). */
  outcome: EPermissionFixOutcome | null;
  /** On Failed: what osascript/the installer said (also in the app log). */
  detail: string | null;
};

// --- pairing + upload (ADR 0092 P2 slice 4) ----------------------------------

/**
 * Why a pairing attempt did not work. One sentence per reason in the UI: the
 * macOS permission fix and the Npcap install both taught this project that a
 * generic "it didn't work" is indistinguishable from a broken feature.
 */
export enum EPairFailure {
  /** The code was not 8 valid characters — caught locally, no round trip. */
  BadCode = "bad-code",
  /** The server said no: wrong, expired, already used, or at the device cap. */
  Refused = "refused",
  /** Could not reach the bot. */
  Unreachable = "unreachable",
  /** The bot answered something this version does not understand. */
  BadReply = "bad-reply",
  /** This guild's bot has no pairing route yet — an officer must update it. */
  NotDeployed = "not-deployed",
  /** This computer cannot encrypt the token, and we will not store it plainly. */
  NoEncryption = "no-encryption",
  /** Encryption threw. */
  StoreFailed = "store-failed",
}

/** What the member's computer knows about its own pairing. */
export type TPairingStatus = {
  paired: boolean;
  deviceName: string | null;
  /** Discord guild id — used only to build the "View my loot" link. */
  guildId: string | null;
  pairedAt: number | null;
  /** Auto-upload toggle. Default ON. */
  uploadEnabled: boolean;
  upload: TUploadStatusView;
};

/** The upload half, flattened for the renderer. */
export type TUploadStatusView = {
  state: string;
  sentTotal: number;
  lastSentAt: number | null;
  failures: number;
  lastError: string | null;
};

export type TPairAttempt = {
  ok: boolean;
  failure: EPairFailure | null;
  /** Diagnostic for the app log, never the member-facing sentence. */
  detail: string | null;
  status: TPairingStatus;
};

export const initialPairingStatus: TPairingStatus = {
  paired: false,
  deviceName: null,
  guildId: null,
  pairedAt: null,
  uploadEnabled: true,
  upload: { state: "unpaired", sentTotal: 0, lastSentAt: null, failures: 0, lastError: null },
};

// --- auto-update (Phase 3, Windows slice) ------------------------------------

export enum EUpdatePhase {
  /** Updates not running: disabled platform, dev build, or not started yet. */
  Off = "off",
  /** Enabled and quiet — nothing known to be newer. */
  UpToDate = "up-to-date",
  Checking = "checking",
  /** A newer version exists; the download is in flight. */
  Downloading = "downloading",
  /** Downloaded and verified — installs on quit, or on Restart now. */
  Ready = "ready",
  /** Last check or download failed; will try again on the next interval. */
  Error = "error",
}

export type TUpdateStatus = {
  phase: EUpdatePhase;
  /** The newer version, once one is known. */
  version: string | null;
  /** Download progress 0–100, only while Downloading. */
  percent: number | null;
  /** Last failure, for the UI sentence and the app log. */
  error: string | null;
};

export const initialUpdateStatus: TUpdateStatus = {
  phase: EUpdatePhase.Off,
  version: null,
  percent: null,
  error: null,
};

export enum ERestartRefusal {
  NotReady = "not-ready",
  /** Engine running — a restart would cut a live capture. */
  Capturing = "capturing",
}

export type TRestartResult = { ok: true } | { ok: false; reason: ERestartRefusal };

/** The two window looks, named like the kill-card grounds (ADR 0074). */
export type TTheme = "obsidian" | "parchment";

/** Narrow an untrusted stored value to a theme, or null. */
export const asTheme = (value: unknown): TTheme | null => {
  return value === "obsidian" || value === "parchment" ? value : null;
};

/** Renderer-visible app settings (IPC `settings:get` / `settings:set-*`). */
export type TAppSettings = {
  /** Start capture as soon as the app opens. Default ON. */
  autoCapture: boolean;
  /** Stored language override; null = follow the OS (the "System" pick). */
  language: string | null;
  /** Window look. Default obsidian. */
  theme: TTheme;
};
