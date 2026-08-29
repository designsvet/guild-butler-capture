/**
 * Auto-update (Phase 3, first slice: Windows only).
 *
 * Design rule, inherited from the uploader and just as binding here:
 * **updating must never interfere with capturing.** The update downloads in
 * the background and installs when the member quits; the only immediate path
 * is an explicit "Restart now" click, and that is refused while the engine is
 * running — a raid's capture is the app's whole job, and no version bump is
 * worth a hole in tonight's loot log.
 *
 * Why Windows only: Squirrel.Mac refuses unsigned updates outright, so macOS
 * stays on manual installs until code signing lands (Q16). The gate is the
 * pure `updaterEnabled` below, so lifting it later is one line.
 *
 * Trust model, stated plainly: the app is unsigned, so an update is trusted
 * because it comes from this project's GitHub Releases over HTTPS — the repo
 * is the trust anchor. electron-updater verifies the download against the
 * sha512 in latest.yml, which rides the same release. Signing (Q16) upgrades
 * this same mechanism in place; nothing here is throwaway.
 *
 * Every dependency is injected — the real electron-updater, timers, the
 * capture-state probe — so the whole lifecycle is testable with no Electron.
 */

import {
  EUpdatePhase,
  ERestartRefusal,
  initialUpdateStatus,
  type TRestartResult,
  type TUpdateStatus,
} from "../shared/captureTypes.js";

/**
 * Windows + packaged only. Dev builds must never self-update (they are not
 * installed), and macOS waits on signing (Q16). An env escape hatch for a
 * tester whose machine must stay pinned to one build.
 */
export const updaterEnabled = (
  platform: string,
  isPackaged: boolean,
  env: Record<string, string | undefined>,
): boolean => {
  if (env.GBC_NO_AUTO_UPDATE === "1") {
    return false;
  }
  return platform === "win32" && isPackaged;
};

/** The slice of electron-updater this controller drives. */
export type TAutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  checkForUpdates: () => Promise<unknown>;
  quitAndInstall: () => void;
};

export type TUpdateDeps = {
  updater: TAutoUpdaterLike;
  enabled: boolean;
  /** True while the engine child is alive (starting/waiting/capturing). */
  engineRunning: () => boolean;
  /** Injected timer so tests drive time; returns a cancel. */
  schedule: (fn: () => void, ms: number) => () => void;
  log: (line: string) => void;
  /** Called on every status change — index.ts pushes it to the renderer. */
  onStatus: (status: TUpdateStatus) => void;
};

/** First check waits out app startup (engine spawn, window paint). */
export const FIRST_CHECK_DELAY_MS = 30_000;
/** Steady-state re-check (owner's call, 2026-08-27: one hour — the manifest
 *  fetch is a plain CDN download, so the cost of being prompt is nothing). */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type TUpdateController = {
  start: () => void;
  status: () => TUpdateStatus;
  /** The Restart-now click. Refused while the engine runs. */
  restartNow: () => TRestartResult;
  /** The gear popover's manual "Check for updates" — a no-op when disabled. */
  checkNow: () => void;
  stop: () => void;
};

export const createUpdateController = (deps: TUpdateDeps): TUpdateController => {
  let status: TUpdateStatus = { ...initialUpdateStatus };
  let cancelNext: (() => void) | null = null;
  let started = false;

  const set = (patch: Partial<TUpdateStatus>): void => {
    status = { ...status, ...patch };
    deps.onStatus(status);
  };

  const scheduleNext = (ms: number): void => {
    cancelNext?.();
    cancelNext = deps.schedule(() => {
      void check();
    }, ms);
  };

  const check = async (): Promise<void> => {
    try {
      await deps.updater.checkForUpdates();
    } catch (err) {
      // The event handler below usually reports first; this catches transports
      // that reject without emitting. Same posture either way: say it, retry
      // on the interval, never surface as anything scarier than a line.
      set({ phase: EUpdatePhase.Error, error: err instanceof Error ? err.message : String(err) });
    }
    scheduleNext(CHECK_INTERVAL_MS);
  };

  const start = (): void => {
    if (started) {
      return;
    }
    started = true;
    if (!deps.enabled) {
      set({ phase: EUpdatePhase.Off });
      return;
    }
    const u = deps.updater;
    // Download quietly, install when the member quits — the path that never
    // asks anyone to do anything.
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on("checking-for-update", () => {
      set({ phase: EUpdatePhase.Checking, error: null });
    });
    u.on("update-available", (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined;
      set({ phase: EUpdatePhase.Downloading, version: info?.version ?? null, percent: 0, error: null });
      deps.log(`[update] v${info?.version ?? "?"} available — downloading`);
    });
    u.on("download-progress", (...args: unknown[]) => {
      const p = args[0] as { percent?: number } | undefined;
      set({ phase: EUpdatePhase.Downloading, percent: Math.floor(p?.percent ?? 0) });
    });
    u.on("update-downloaded", (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined;
      set({ phase: EUpdatePhase.Ready, version: info?.version ?? status.version, percent: null, error: null });
      deps.log(`[update] v${info?.version ?? "?"} ready — installs on quit`);
    });
    u.on("update-not-available", () => {
      set({ phase: EUpdatePhase.UpToDate, version: null, percent: null, error: null });
    });
    u.on("error", (...args: unknown[]) => {
      const err = args[0];
      const message = err instanceof Error ? err.message : String(err);
      // A failed check is a non-event for the member (the file on disk story
      // again): log it, show a muted line at most, retry on the interval.
      deps.log(`[update] ${message}`);
      set({ phase: EUpdatePhase.Error, error: message });
    });
    set({ phase: EUpdatePhase.UpToDate });
    scheduleNext(FIRST_CHECK_DELAY_MS);
  };

  return {
    start,
    status: () => status,
    checkNow: () => {
      // `check` reschedules the steady interval itself, so a manual check
      // simply pulls the next one forward — no double timers.
      if (deps.enabled && started) {
        void check();
      }
    },
    restartNow: (): TRestartResult => {
      if (status.phase !== EUpdatePhase.Ready) {
        return { ok: false, reason: ERestartRefusal.NotReady };
      }
      if (deps.engineRunning()) {
        // The one rule: never cut a live capture. Quitting later installs it
        // anyway, so refusing costs the member nothing but a sentence.
        return { ok: false, reason: ERestartRefusal.Capturing };
      }
      deps.updater.quitAndInstall();
      return { ok: true };
    },
    stop: () => {
      cancelNext?.();
      cancelNext = null;
    },
  };
};
