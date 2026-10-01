/**
 * What the shell says about the capture and the guild connection, decided apart from how it is
 * drawn: the title bar's status and its one button (board Fh1), the page header's meta line (F1,
 * Fh3), the Session page's hero card before there is data (Fh3, Fh7) and the sidebar's foot (Fh2).
 * Pure — the snapshot, the clock and the words in, a plain value out — so test/shellModel.test.ts
 * holds every state to its board without a window.
 *
 * Guild and zone are not here on purpose: the app does not know them yet (slice 1), so the bar
 * draws neither, and the foot names the device alone.
 */

import { ECaptureStatus, EEngineErrorKind, type TCaptureState, type TPairingStatus } from "../shared/captureTypes.js";
import { EBlock } from "../shared/notices.js";
import type { TStrings } from "../shared/strings.js";
import { formatDuration } from "./format.js";

/** The old window's threshold for the waiting reasons (src/renderer/renderer.ts), kept. */
export const WAITING_REASONS_AFTER_MS = 90_000;

/** A status dot's colour: the package's status hues, and its label grey for a resting state. */
export type TTone = "grey" | "amber" | "green" | "red";

export type TBarStatus = {
  tone: TTone;
  /** The words beside the dot: the state in the app's own words, or the character's name. */
  label: string;
  /** A state is set in the second ink, a name in the first, the error in the danger text. */
  look: "state" | "name" | "danger";
  /** What follows the label at full width, each after a "·". */
  details: string[];
  /** What follows it below 1024 px, where the bar keeps the name and the time (board Fh1). */
  short: string[];
};

/** The bar's one button. One gold button per window: in the error state Start is neutral. */
export type TBarAction = {
  kind: "start" | "stop";
  look: "primary" | "neutral" | "danger";
  /** Starting and stopping refuse a press, as the old window's button does. */
  disabled: boolean;
};

/** When the current listen began: the engine run's spawn, or the session's start. */
const listeningSince = (state: TCaptureState): number | null => state.runStartedAt ?? state.startedAt;

const since = (from: number | null, now: number, s: TStrings): string | null => {
  return from == null ? null : formatDuration(now - from, s.shell.units);
};

/**
 * Null until the first snapshot arrives: the bar draws no state rather than guess "Not capturing".
 *
 * `blocked`: capture is blocked (src/shared/notices.ts `captureBlock`) — the error state, or an idle
 * one whose setup probe already knows Start would fail. The dot goes red then, and only then: a
 * broken decoder, a stopping logger, an update are the band's to say, not the bar's (board Fh4).
 */
export const barStatus = (state: TCaptureState | null, now: number, s: TStrings, blocked = false): TBarStatus | null => {
  if (state == null) {
    return null;
  }
  const words = { tone: "grey" as TTone, look: "state" as const, details: [] as string[], short: [] as string[] };
  switch (state.status) {
    case ECaptureStatus.Idle: {
      return blocked ? { ...words, tone: "red", look: "danger", label: s.status.error } : { ...words, label: s.status.idle };
    }
    case ECaptureStatus.Starting: {
      return { ...words, tone: "amber", label: s.status.starting };
    }
    case ECaptureStatus.Stopping: {
      return { ...words, label: s.status.stopping };
    }
    case ECaptureStatus.Error: {
      return { ...words, tone: "red", look: "danger", label: s.status.error };
    }
    case ECaptureStatus.Waiting: {
      const time = since(listeningSince(state), now, s);
      return {
        ...words,
        tone: "amber",
        label: s.status.waiting,
        details: time == null ? [] : [s.shell.bar.listeningFor(time)],
        short: time == null ? [] : [time],
      };
    }
    case ECaptureStatus.Restarting: {
      // The relaunch's delay as the old window says it: fixed at the exit, not a countdown — the
      // snapshot carries the delay, not the moment of the exit.
      const delay = formatDuration(Math.ceil((state.restartDelayMs ?? 1000) / 1000) * 1000, s.shell.units);
      const words2 = [s.shell.bar.restartIn(delay)];
      return { ...words, tone: "amber", label: s.status.restarting, details: words2, short: words2 };
    }
    case ECaptureStatus.Capturing: {
      const time = since(state.startedAt, now, s);
      if (state.character == null) {
        return {
          ...words,
          tone: "green",
          label: s.status.capturing,
          details: [s.stats.characterUnknown, ...(time == null ? [] : [time])],
          short: time == null ? [] : [time],
        };
      }
      return {
        ...words,
        tone: "green",
        look: "name",
        label: state.character,
        details: time == null ? [] : [s.shell.bar.capturingFor(time)],
        short: time == null ? [] : [time],
      };
    }
  }
};

/**
 * `fixFirst`: the band holds the next step — capture is blocked, or the band's notice carries the
 * window's gold button. Start then steps back to the neutral face, as in the error state: one gold
 * button per window, and a gold Start over a capture that cannot start invites the press that fails.
 */
export const barAction = (state: TCaptureState | null, fixFirst = false): TBarAction | null => {
  if (state == null) {
    return null;
  }
  switch (state.status) {
    case ECaptureStatus.Idle: {
      return { kind: "start", look: fixFirst ? "neutral" : "primary", disabled: false };
    }
    case ECaptureStatus.Error: {
      return { kind: "start", look: "neutral", disabled: false };
    }
    case ECaptureStatus.Starting:
    case ECaptureStatus.Stopping: {
      return { kind: "stop", look: "danger", disabled: true };
    }
    // Restarting stays pressable: the crash-backoff loop must remain stoppable (the old window's rule).
    case ECaptureStatus.Waiting:
    case ECaptureStatus.Capturing:
    case ECaptureStatus.Restarting: {
      return { kind: "stop", look: "danger", disabled: false };
    }
  }
};

/** The page header's meta line: when this listen or this session began, and for how long. */
export const headerMeta = (
  state: TCaptureState | null,
  now: number,
  s: TStrings,
  clock: (epochMs: number) => string,
): string => {
  if (state == null) {
    return "";
  }
  if (state.status === ECaptureStatus.Waiting) {
    const from = listeningSince(state);
    return from == null ? "" : s.shell.meta.listeningSince(clock(from));
  }
  const running =
    state.status === ECaptureStatus.Capturing ||
    state.status === ECaptureStatus.Restarting ||
    state.status === ECaptureStatus.Stopping;
  if (running && state.startedAt != null) {
    return `${s.shell.meta.started(clock(state.startedAt))} · ${formatDuration(now - state.startedAt, s.shell.units)}`;
  }
  return "";
};

/** Tabler outline icons the hero card picks from (src/app/icons.tsx draws them). */
export type THeroIcon = "radar" | "hourglass" | "chart" | "pause" | "stop" | "refresh" | "alert";

export type THero = {
  icon: THeroIcon;
  title: string;
  /** The app's own sentence first, then the boards' new one where there is one. */
  lines: string[];
  /**
   * The second line sits 4 px closer (the capturing card on Fh3). The waiting card's second line
   * keeps the full gap: there it is a paragraph of its own.
   */
  tight: boolean;
  /** The three waiting reasons, as a bare list under the card's rule — after 90 s of waiting. */
  reasons: boolean;
};

/** What blocks capture, in the old window's words: the title of its fix card. */
export const blockTitle = (block: EBlock, s: TStrings): string => {
  switch (block) {
    case EBlock.MacPermission: {
      return s.errors.permissionTitle;
    }
    case EBlock.NpcapMissing: {
      return s.errors.npcapMissingTitle;
    }
    case EBlock.NpcapAdminOnly: {
      return s.errors.npcapAdminOnlyTitle;
    }
    case EBlock.EngineMissing: {
      return s.errors.engineMissingTitle;
    }
    case EBlock.AbiMismatch: {
      return s.errors.abiMismatchTitle;
    }
    case EBlock.Unknown: {
      return s.errors.crashTitle;
    }
  }
};

const errorTitle = (kind: EEngineErrorKind | null, platform: string, s: TStrings): string => {
  switch (kind) {
    case EEngineErrorKind.Permission: {
      // The same engine error tells two stories: on Windows it means Npcap is admin-only.
      return platform === "win32" ? s.errors.npcapAdminOnlyTitle : s.errors.permissionTitle;
    }
    case EEngineErrorKind.NpcapMissing: {
      return s.errors.npcapMissingTitle;
    }
    case EEngineErrorKind.AbiMismatch: {
      return s.errors.abiMismatchTitle;
    }
    case EEngineErrorKind.EngineMissing: {
      return s.errors.engineMissingTitle;
    }
    default: {
      return s.errors.crashTitle;
    }
  }
};

/**
 * The Session page's card before there is anything to count (boards Fh3, Fh7). `blockedBy`: what
 * blocks capture (src/shared/notices.ts) — an idle capture that cannot start says so, as the bar
 * does, rather than invite a Start; the fix is in the band's notice above.
 */
export const sessionHero = (
  state: TCaptureState | null,
  now: number,
  platform: string,
  s: TStrings,
  blockedBy: EBlock | null = null,
): THero | null => {
  if (state == null) {
    return null;
  }
  const card = { tight: false, reasons: false };
  if (state.status === ECaptureStatus.Idle && blockedBy != null) {
    return { ...card, icon: "alert", title: s.status.error, lines: [blockTitle(blockedBy, s)] };
  }
  switch (state.status) {
    case ECaptureStatus.Waiting: {
      const from = state.runStartedAt;
      return {
        ...card,
        icon: "radar",
        title: s.status.waiting,
        lines: [s.statusHint.waiting, s.shell.session.waitingMore],
        reasons: from != null && now - from > WAITING_REASONS_AFTER_MS,
      };
    }
    case ECaptureStatus.Starting: {
      return { ...card, icon: "hourglass", title: s.status.starting, lines: [s.statusHint.starting] };
    }
    case ECaptureStatus.Capturing: {
      const hint = state.character != null ? s.statusHint.capturingAs(state.character) : s.statusHint.capturing;
      return { ...card, icon: "chart", title: s.status.capturing, lines: [hint, s.shell.session.capturingMore], tight: true };
    }
    case ECaptureStatus.Idle: {
      return { ...card, icon: "pause", title: s.status.idle, lines: [s.statusHint.idle] };
    }
    // Three states no board draws a card for yet; each says what the old window says.
    case ECaptureStatus.Stopping: {
      return { ...card, icon: "stop", title: s.status.stopping, lines: [s.statusHint.stopping] };
    }
    case ECaptureStatus.Restarting: {
      const seconds = Math.ceil((state.restartDelayMs ?? 1000) / 1000);
      return { ...card, icon: "refresh", title: s.status.restarting, lines: [s.statusHint.restarting(seconds)] };
    }
    case ECaptureStatus.Error: {
      // The fix lives in the band's notice above (src/app/Notice.tsx); the card names what is wrong
      // in the old window's words.
      return { ...card, icon: "alert", title: s.status.error, lines: [errorTitle(state.errorKind, platform, s)] };
    }
  }
};

/** The foot's dot: hollow while there is no guild to send to (board Fh2). */
export type TFootDot = "hollow" | "green" | "amber" | "red" | "grey";

export type TFoot = {
  dot: TFootDot;
  /** The device's name, or "Connect a guild" — set in gold, since it is the way in. */
  line1: string;
  connect: boolean;
  /**
   * Whether line 1 is the device's name. A name too long for the 208px sidebar ends in "…" (the
   * foot's tooltip keeps it whole); words — "Connect a guild", "Disconnected in Discord" — wrap
   * instead, because a state cut to "Disconnected in Di…" no longer says what is wrong.
   */
  named: boolean;
  /** The quieter line: a short form of the old window's upload sentence. */
  line2: string;
};

/** Null until the pairing is known: a paired member should not see "Connect a guild" flash past. */
export const sidebarFoot = (
  pairing: TPairingStatus | null,
  now: number,
  platform: string,
  s: TStrings,
): TFoot | null => {
  if (pairing == null) {
    return null;
  }
  const f = s.shell.foot;
  if (!pairing.paired) {
    return {
      dot: "hollow",
      line1: f.connect,
      connect: true,
      named: false,
      line2: platform === "darwin" ? f.localMac : f.local,
    };
  }
  const device = pairing.deviceName ?? f.unnamedDevice;
  const on = (dot: TFootDot, line2: string): TFoot => ({ dot, line1: device, connect: false, named: true, line2 });
  if (!pairing.uploadEnabled || pairing.upload.state === "disabled") {
    return on("grey", f.off);
  }
  switch (pairing.upload.state) {
    case "sending": {
      return on("green", f.sending);
    }
    case "retrying": {
      return on("amber", f.retrying);
    }
    case "bot-outdated": {
      return on("amber", f.outdated);
    }
    // The decoder is broken where loot is concerned: nothing is sent until the app updates, and what
    // is logged meanwhile never is (src/main/uploader.ts). Amber: not a fault of the connection.
    case "held": {
      return on("amber", f.held);
    }
    case "blocked": {
      return on("red", f.blocked);
    }
    case "unauthorized": {
      // The one state that is not about this device's sending but about the pairing itself.
      return { dot: "red", line1: f.unauthorized, connect: false, named: false, line2: f.pairAgain };
    }
    default: {
      const { sentTotal, lastSentAt } = pairing.upload;
      if (sentTotal <= 0) {
        return on("green", f.nothingYet);
      }
      const sent = f.linesSent(sentTotal);
      if (lastSentAt == null) {
        return on("green", sent);
      }
      const ago = now - lastSentAt < 60_000 ? f.justNow : f.ago(formatDuration(now - lastSentAt, s.shell.units));
      return on("green", `${sent} · ${ago}`);
    }
  }
};
