/**
 * What a notice says and offers (boards Fh4, Fh5), decided apart from how it is drawn: the band's
 * card and the broken decoder's dialog. Which notice shows is src/shared/notices.ts; this turns it
 * into the app's own words — every title and sentence is the old window's (errors, setup, health,
 * update), wired to what its buttons already do — and the button each one carries.
 *
 * Pure — the notice, the snapshot and the words in, a plain value out — so test/shellModel.test.ts
 * holds every notice to its board without a window.
 */

import {
  ECaptureAccess,
  ECaptureStatus,
  ENpcapInstallOutcome,
  EPermissionFixOutcome,
  type TCaptureState,
  type TSetupStatus,
  type TUpdateStatus,
} from "../shared/captureTypes.js";
import { EHealthAction, EHealthLine } from "../shared/engineHealth.js";
import { EBlock, ENotice, type TNotice } from "../shared/notices.js";
import type { TStrings } from "../shared/strings.js";
import { blockTitle } from "./model.js";
import type { TShellUi } from "./store.js";

/** Tabler outline icons a notice picks from (src/app/icons.tsx draws them). */
export type TNoticeIcon = "shield" | "desktop" | "alert" | "refresh" | "download";

/** What a button does — the store's action of the same name (src/app/store.ts). */
export type TNoticeActionId =
  | "fix-mac"
  | "install-npcap"
  | "get-npcap"
  | "choose-engine"
  | "update-now"
  | "check-for-fix"
  | "get-update";

export type TNoticeButton = {
  id: TNoticeActionId;
  label: string;
  /**
   * The fix is the gold primary — the window's one gold button while it shows (the bar's Start
   * steps back; model.ts `barAction`). A second, quieter way is outlined; one that leaves the app
   * for a web page is the gold link with its chevron (board Fh5).
   */
  look: "primary" | "outline" | "link";
  /** Running: dimmed, and it refuses a second press (aria-disabled, so it keeps the focus). */
  busy: boolean;
};

export type TNoticeView = {
  kind: ENotice;
  /** An alert sets its title and its icon in the danger text; a quiet notice in the inks (Fh5). */
  tone: "alert" | "quiet";
  icon: TNoticeIcon;
  title: string;
  /** The app's sentence. Empty when it has none (an error with no kind). */
  body: string;
  /** Smaller lines under it: what a fix attempt did, and the held upload. */
  notes: string[];
  /** The technical detail, in mono, shown open: what the engine said was broken (Fh5). */
  details: string[];
  buttons: TNoticeButton[];
};

export type TNoticeContext = {
  capture: TCaptureState | null;
  setup: TSetupStatus | null;
  update: TUpdateStatus | null;
  ui: TShellUi;
  s: TStrings;
};

/** The sentence under "Fix capture permissions…" once it has been tried — the old window's fixNoteText. */
const fixNote = ({ ui, setup, s }: TNoticeContext): string | null => {
  const attempt = ui.fixAttempt;
  if (attempt == null || setup?.access === ECaptureAccess.Ok) {
    return null;
  }
  switch (attempt.outcome) {
    case EPermissionFixOutcome.Cancelled: {
      return s.setup.permissionFixCancelled;
    }
    case EPermissionFixOutcome.Failed: {
      return s.setup.permissionFixFailed(attempt.detail != null ? attempt.detail.slice(0, 160) : null);
    }
    case EPermissionFixOutcome.StillBlocked: {
      return s.setup.permissionFixStillBlocked;
    }
    default: {
      return null;
    }
  }
};

/** The sentence under "Install capture driver" — the old window's npcapNoteText. */
const npcapNote = ({ ui, s }: TNoticeContext): string | null => {
  if (ui.npcapBusy) {
    return s.setup.npcapInstalling;
  }
  const install = ui.npcapAttempt?.install;
  switch (install?.outcome) {
    case ENpcapInstallOutcome.Installed: {
      return s.setup.npcapInstalled(install.version);
    }
    case ENpcapInstallOutcome.NotCompleted: {
      return s.setup.npcapNotCompleted;
    }
    case ENpcapInstallOutcome.Cancelled: {
      return s.setup.npcapCancelled;
    }
    case ENpcapInstallOutcome.LaunchFailed: {
      return s.setup.npcapLaunchFailed(install.detail != null ? install.detail.slice(0, 160) : null);
    }
    case ENpcapInstallOutcome.DownloadFailed: {
      return s.setup.npcapDownloadFailed;
    }
    case ENpcapInstallOutcome.Untrusted: {
      return s.setup.npcapUntrusted;
    }
    default: {
      return null;
    }
  }
};

const getNpcap = (s: TStrings): TNoticeButton => ({ id: "get-npcap", label: s.buttons.getNpcap, look: "link", busy: false });

const blockedView = (block: EBlock, ctx: TNoticeContext): TNoticeView => {
  const { s, ui, setup } = ctx;
  const view = { kind: ENotice.Blocked, tone: "alert" as const, title: blockTitle(block, s), details: [] as string[] };
  const notes = (...lines: Array<string | null>): string[] => lines.filter((line): line is string => line != null);
  switch (block) {
    case EBlock.MacPermission: {
      return {
        ...view,
        icon: "shield",
        body: s.errors.permission,
        notes: notes(fixNote(ctx)),
        buttons: [{ id: "fix-mac", label: s.buttons.fixMacPermissions, look: "primary", busy: false }],
      };
    }
    case EBlock.NpcapMissing: {
      // The in-app install is Windows'; "Download it myself" stays beside it, the way out for a
      // blocked network or a refused signature.
      const install: TNoticeButton[] =
        setup?.platform === "win32" ? [{ id: "install-npcap", label: s.buttons.installNpcap, look: "primary", busy: ui.npcapBusy }] : [];
      return { ...view, icon: "desktop", body: s.errors.npcapMissing, notes: notes(npcapNote(ctx)), buttons: [...install, getNpcap(s)] };
    }
    case EBlock.NpcapAdminOnly: {
      return { ...view, icon: "desktop", body: s.errors.npcapAdminOnly, notes: [], buttons: [getNpcap(s)] };
    }
    case EBlock.EngineMissing: {
      return {
        ...view,
        icon: "desktop",
        body: s.errors.engineMissing,
        notes: [],
        buttons: [{ id: "choose-engine", label: s.buttons.chooseEngine, look: "primary", busy: false }],
      };
    }
    case EBlock.AbiMismatch: {
      // The fix is a rebuild from the README, which no button can do.
      return { ...view, icon: "desktop", body: s.errors.abiMismatch, notes: [], buttons: [] };
    }
    case EBlock.Unknown: {
      return { ...view, icon: "alert", body: "", notes: [], buttons: [] };
    }
  }
};

/** The sentence after the headline, by where the fix is — the old window's renderHealth. */
export const healthLine = (line: EHealthLine, update: TUpdateStatus | null, s: TStrings): string => {
  switch (line) {
    case EHealthLine.Ready: {
      return s.health.ready(update?.version ?? null);
    }
    case EHealthLine.Downloading: {
      return s.health.downloading(update?.version ?? null, update?.percent ?? null);
    }
    case EHealthLine.Checking: {
      return s.health.checking;
    }
    case EHealthLine.NotOutYet: {
      return s.health.notOutYet;
    }
    case EHealthLine.CheckFailed: {
      return s.health.checkFailed(update?.error ?? null);
    }
    case EHealthLine.Manual: {
      return s.health.manual;
    }
  }
};

/** The broken decoder's one button: the next step toward the fixed build (healthCard decides it). */
export const healthButton = (action: EHealthAction, ui: TShellUi, s: TStrings): TNoticeButton | null => {
  switch (action) {
    case EHealthAction.StopAndUpdate: {
      return { id: "update-now", label: s.health.stopAndUpdate, look: "primary", busy: ui.updateAfterStop };
    }
    case EHealthAction.RestartToUpdate: {
      return { id: "update-now", label: s.health.restartToUpdate, look: "primary", busy: ui.updateAfterStop };
    }
    case EHealthAction.CheckForFix: {
      return { id: "check-for-fix", label: s.health.checkForFix, look: "outline", busy: ui.checking };
    }
    case EHealthAction.GetUpdate: {
      // Where the app cannot update itself, main's update check opens the download page.
      return { id: "get-update", label: s.health.getUpdate, look: "link", busy: ui.checking };
    }
    case EHealthAction.None: {
      return null;
    }
  }
};

export const noticeView = (notice: TNotice, ctx: TNoticeContext): TNoticeView => {
  const { s, ui, capture, update } = ctx;
  switch (notice.kind) {
    case ENotice.Blocked: {
      return blockedView(notice.block, ctx);
    }
    case ENotice.Decoder: {
      const button = healthButton(notice.action, ui, s);
      return {
        kind: notice.kind,
        tone: "alert",
        icon: "alert",
        title: s.health.title,
        body: `${s.health.body} ${healthLine(notice.line, update, s)}`,
        // The held upload, said plainly; and, after "Stop capture and update", main's refusal.
        notes: [s.shell.notices.held, ...(ui.restartRefused ? [s.update.blockedCapturing] : [])],
        details: (capture?.engineBroken ?? []).map((b) => s.health.detailLine(b.handler, b.failures, b.calls)),
        buttons: button == null ? [] : [button],
      };
    }
    case ENotice.LoggerStopping: {
      // While the next relaunch waits, when it comes; once it runs, that it is starting.
      const restarting = capture?.status === ECaptureStatus.Restarting;
      const seconds = Math.ceil((capture?.restartDelayMs ?? 1000) / 1000);
      return {
        kind: notice.kind,
        tone: "quiet",
        icon: "refresh",
        title: s.errors.crashTitle,
        body: restarting ? s.statusHint.restarting(seconds) : s.statusHint.starting,
        notes: [],
        details: [],
        buttons: [],
      };
    }
    case ENotice.UpdateReady: {
      // Quiet: nothing is wrong. While the logger runs, the update waits for it — the notice says
      // so and offers the broken decoder's own flow: stop, install, start again.
      return {
        kind: notice.kind,
        tone: "quiet",
        icon: "download",
        title: s.shell.notices.updateReady,
        body: notice.running ? s.update.blockedCapturing : s.update.ready(update?.version ?? null),
        notes: ui.restartRefused && !notice.running ? [s.update.blockedCapturing] : [],
        details: [],
        buttons: [
          {
            id: "update-now",
            label: notice.running ? s.health.stopAndUpdate : s.update.restartNow,
            look: "outline",
            busy: ui.updateAfterStop,
          },
        ],
      };
    }
  }
};

/** Does the band's notice carry the window's gold button? Then the bar's Start steps back (model.ts). */
export const holdsTheGold = (view: TNoticeView | null): boolean => view?.buttons.some((b) => b.look === "primary") ?? false;
