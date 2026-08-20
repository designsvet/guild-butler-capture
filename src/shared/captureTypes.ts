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
  /** Data lines the current engine run has written. */
  linesThisRun: number;
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
  linesPrevRuns: 0,
  logFile: null,
  errorKind: null,
  errorDetail: null,
  startedAt: null,
  runStartedAt: null,
  lastOutputAt: null,
  lastDetectedAt: null,
  restartAttempt: 0,
  restartDelayMs: null,
  heartbeatSeen: false,
  stopRequested: false,
};

/** What the session-total counter shows: every run's lines, current one included. */
export const lootLinesOf = (state: TCaptureState): number => {
  return state.linesPrevRuns + state.linesThisRun;
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
