/**
 * Which notice the v5 shell's band shows, and when the broken decoder's dialog interrupts — decided
 * apart from the words and the drawing, so test/notices.test.ts holds every rule without a window.
 *
 * The owner's rulings (raid-bot ADR 0159, amendment 2026-10-01; boards Fh4 and Fh5): one slot under
 * the title bar, on every page, one notice at a time — the most blocking first: capture is blocked,
 * then a game update broke the decoder, then the logger keeps stopping, then an update is ready. A
 * broken decoder also interrupts with a dialog, once when it is found and again when the fix has
 * downloaded; "Later" closes the dialog, never the notice. Every other notice is the band alone.
 *
 * Pure and platform-free (compiled for the main process, the old window and the v5 shell alike).
 */

import {
  ECaptureAccess,
  ECaptureStatus,
  EEngineErrorKind,
  EUpdatePhase,
  HEALTHY_RUN_MS,
  type TCaptureState,
  type TSetupStatus,
  type TUpdateStatus,
} from "./captureTypes.js";
import { engineRunning, healthCard, lootBroken, type EHealthAction, type EHealthLine } from "./engineHealth.js";

/** What stands between the member and a capture — each its own sentences and its own fix. */
export enum EBlock {
  /** macOS: /dev/bpf* is root-only. Fixed by the one-time admin helper. */
  MacPermission = "mac-permission",
  /** Windows: no Npcap. Fixed by the in-app install, or the download page. */
  NpcapMissing = "npcap-missing",
  /** Windows: Npcap installed for administrators only. Reinstalled by hand. */
  NpcapAdminOnly = "npcap-admin-only",
  /** The engine is not on disk. Fixed by pointing the app at it. */
  EngineMissing = "engine-missing",
  /** The engine's native module was built for another runtime. Fixed by a rebuild (developers). */
  AbiMismatch = "abi-mismatch",
  /** An error state with no kind — the reducer never makes one; the old window's words if it does. */
  Unknown = "unknown",
}

/**
 * Is capture blocked, and by what? Two places say so, as the old window has them: a capture that
 * failed for a reason a retry cannot fix (the error state), and — while idle — the setup probe,
 * which knows before Start is pressed that the engine is missing or the permission is not there.
 * The engine first: with no engine, a permission fix would fix nothing. An access the probe could
 * not judge (Unknown) blocks nothing: a Start will find out.
 */
export const captureBlock = (capture: TCaptureState | null, setup: TSetupStatus | null): EBlock | null => {
  if (capture == null) {
    return null;
  }
  const platform = setup?.platform ?? "";
  if (capture.status === ECaptureStatus.Error) {
    switch (capture.errorKind) {
      case EEngineErrorKind.Permission: {
        // The same engine error tells two stories: on Windows it means Npcap is admin-only.
        return platform === "win32" ? EBlock.NpcapAdminOnly : EBlock.MacPermission;
      }
      case EEngineErrorKind.NpcapMissing: {
        return EBlock.NpcapMissing;
      }
      case EEngineErrorKind.AbiMismatch: {
        return EBlock.AbiMismatch;
      }
      case EEngineErrorKind.EngineMissing: {
        return EBlock.EngineMissing;
      }
      default: {
        return EBlock.Unknown;
      }
    }
  }
  if (capture.status !== ECaptureStatus.Idle || setup == null) {
    return null;
  }
  if (setup.engineEntry == null) {
    return EBlock.EngineMissing;
  }
  switch (setup.access) {
    case ECaptureAccess.NoPermission: {
      return EBlock.MacPermission;
    }
    case ECaptureAccess.NpcapMissing: {
      return EBlock.NpcapMissing;
    }
    case ECaptureAccess.NpcapAdminOnly: {
      return EBlock.NpcapAdminOnly;
    }
    default: {
      return null;
    }
  }
};

/** "The logger keeps stopping" from the third restart in a row (a new rule, SPEC step 6). */
export const LOGGER_STOPPING_FROM = 3;

/**
 * The logger keeps stopping: the supervisor has relaunched it three times in a row
 * (`restartAttempt`, its count of quick deaths in a row — a healthy run starts it over). Up while
 * the next relaunch is pending, and through the relaunched run until it proves healthy — it sees
 * Albion, or lives HEALTHY_RUN_MS, the supervisor's own test — so the band does not come and go
 * with every short-lived run, pushing the page up and down each time. A Stop ends it.
 */
export const loggerKeepsStopping = (capture: TCaptureState | null, now: number): boolean => {
  if (capture == null || capture.restartAttempt < LOGGER_STOPPING_FROM) {
    return false;
  }
  if (capture.status === ECaptureStatus.Restarting) {
    return true;
  }
  const relaunched = capture.status === ECaptureStatus.Starting || capture.status === ECaptureStatus.Waiting;
  return relaunched && capture.runStartedAt != null && now - capture.runStartedAt < HEALTHY_RUN_MS;
};

export enum ENotice {
  Blocked = "blocked",
  Decoder = "decoder",
  LoggerStopping = "logger-stopping",
  UpdateReady = "update-ready",
}

/** The band's order: the first that applies is the one shown. */
export const NOTICE_ORDER: readonly ENotice[] = [ENotice.Blocked, ENotice.Decoder, ENotice.LoggerStopping, ENotice.UpdateReady];

export type TNotice =
  | { kind: ENotice.Blocked; block: EBlock }
  /** `line` and `action` are healthCard's: the member's next step toward the fixed build. */
  | { kind: ENotice.Decoder; line: EHealthLine; action: EHealthAction }
  | { kind: ENotice.LoggerStopping }
  /** While the logger runs the update waits: the notice then offers to stop it first. */
  | { kind: ENotice.UpdateReady; running: boolean };

export type TNoticeInput = {
  capture: TCaptureState | null;
  setup: TSetupStatus | null;
  update: TUpdateStatus | null;
  now: number;
};

/** Every notice that applies now, in the band's order. */
export const noticesNow = ({ capture, setup, update, now }: TNoticeInput): TNotice[] => {
  const out: TNotice[] = [];
  const block = captureBlock(capture, setup);
  if (block != null) {
    out.push({ kind: ENotice.Blocked, block });
  }
  // Only a break that reaches the loot log: a broken festivity or energy reader makes no loot wrong,
  // and "your guild's loot numbers will be off" would be a false alarm on the loudest notice there is.
  if (capture != null && update != null && lootBroken(capture.engineBroken)) {
    const card = healthCard(update, capture.status);
    out.push({ kind: ENotice.Decoder, line: card.line, action: card.action });
  }
  if (loggerKeepsStopping(capture, now)) {
    out.push({ kind: ENotice.LoggerStopping });
  }
  if (capture != null && update?.phase === EUpdatePhase.Ready) {
    out.push({ kind: ENotice.UpdateReady, running: engineRunning(capture.status) });
  }
  return out.sort((a, b) => NOTICE_ORDER.indexOf(a.kind) - NOTICE_ORDER.indexOf(b.kind));
};

/** The one the band shows, or none. */
export const bandNotice = (input: TNoticeInput): TNotice | null => noticesNow(input)[0] ?? null;

/**
 * The broken decoder's dialog (board Fh4, option D) interrupts for an EVENT, and "Later" answers
 * that event: the break being found, and the fix having downloaded — a version of its own, so a
 * second fix interrupts again. Null while the decoder is fine. The shell keeps the events answered.
 */
export const decoderDialogEvent = (capture: TCaptureState | null, update: TUpdateStatus | null): string | null => {
  if (capture == null || !lootBroken(capture.engineBroken)) {
    return null;
  }
  return update?.phase === EUpdatePhase.Ready ? `fix-ready:${update.version ?? ""}` : "broken";
};
