/**
 * "A game update broke loot logging" — the rules behind the card, kept pure so they are tested
 * without a window (raid-bot ADR 0092 amendment, 2026-09-28/29).
 *
 * The engine prints a `[health]` verdict every minute (designsvet/ao-loot-logger#16). When a
 * handler is broken, the member must understand that updating the app is the fix and that until
 * then loot is logged wrong — the owner chose the loudest option on purpose (2026-09-29, "C":
 * the card takes the greeting's place, like the other fix cards). So everything here answers one
 * question: what is the member's next step toward the fixed build, given where the updater is?
 */

import { ECaptureStatus, EUpdatePhase, type TBrokenHandler, type TUpdateStatus } from "./captureTypes.js";

/**
 * Union by handler, sorted by name. A newer report's counts replace an older one's; a handler the
 * newer report no longer lists stays (the build is still broken — see TCaptureState.engineBroken).
 */
export const mergeBroken = (
  prev: readonly TBrokenHandler[] | null,
  next: readonly TBrokenHandler[],
): TBrokenHandler[] => {
  const byName = new Map<string, TBrokenHandler>();
  for (const entry of prev ?? []) {
    byName.set(entry.handler, entry);
  }
  for (const entry of next) {
    byName.set(entry.handler, entry);
  }
  return [...byName.values()].sort((a, b) => a.handler.localeCompare(b.handler));
};

/** Handlers `next` has that `prev` did not — the only thing worth telling the bot about. */
export const newlyBroken = (
  prev: readonly TBrokenHandler[] | null,
  next: readonly TBrokenHandler[] | null,
): TBrokenHandler[] => {
  const known = new Set((prev ?? []).map((entry) => entry.handler));
  return (next ?? []).filter((entry) => !known.has(entry.handler));
};

/** The one sentence under the headline, by where the fix is. */
export enum EHealthLine {
  /** Downloaded and verified: one click away. */
  Ready = "ready",
  Downloading = "downloading",
  Checking = "checking",
  /** The updater runs and knows of nothing newer: the fix is not published yet. */
  NotOutYet = "not-out-yet",
  CheckFailed = "check-failed",
  /** No auto-update on this build (macOS, dev): the member downloads it. */
  Manual = "manual",
}

/** The card's one button. */
export enum EHealthAction {
  /** The update is ready but the engine runs, and main refuses to cut a live capture: stop first. */
  StopAndUpdate = "stop-and-update",
  RestartToUpdate = "restart-to-update",
  CheckForFix = "check-for-fix",
  /** Opens the download page (main's update-check handler does that where the updater is off). */
  GetUpdate = "get-update",
  /** Checking or downloading — nothing to press. */
  None = "none",
}

/** Main's own rule for "a restart would cut a live capture" (updateController engineRunning). */
export const engineRunning = (status: ECaptureStatus): boolean =>
  status !== ECaptureStatus.Idle && status !== ECaptureStatus.Error;

export const healthCard = (
  update: TUpdateStatus,
  status: ECaptureStatus,
): { line: EHealthLine; action: EHealthAction } => {
  switch (update.phase) {
    case EUpdatePhase.Ready: {
      return {
        line: EHealthLine.Ready,
        action: engineRunning(status) ? EHealthAction.StopAndUpdate : EHealthAction.RestartToUpdate,
      };
    }
    case EUpdatePhase.Downloading: {
      return { line: EHealthLine.Downloading, action: EHealthAction.None };
    }
    case EUpdatePhase.Checking: {
      return { line: EHealthLine.Checking, action: EHealthAction.None };
    }
    case EUpdatePhase.UpToDate: {
      return { line: EHealthLine.NotOutYet, action: EHealthAction.CheckForFix };
    }
    case EUpdatePhase.Error: {
      return { line: EHealthLine.CheckFailed, action: EHealthAction.CheckForFix };
    }
    case EUpdatePhase.Off: {
      return { line: EHealthLine.Manual, action: EHealthAction.GetUpdate };
    }
  }
};
