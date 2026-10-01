/**
 * What the guild connection's panel says, and where it goes (board Fh2, "What opens from it"),
 * decided apart from how it is drawn. Pure — the pairing, the clock and the words in, a plain value
 * out — so test/shellConnection.test.ts holds it without a window.
 *
 * Every sentence is the old window's (its pairing block, src/renderer/renderer.ts): a refused code
 * says what the old window says for that failure, and the connected details say the upload's state
 * twice — in the sidebar foot's short form beside its dot, as the board draws it, and then, where
 * there is more to say than "312 lines sent", in the old window's whole sentence ("…Your log file
 * is safe."), which the foot has no room for and the panel does.
 */

import { EPairFailure, type TPairingStatus } from "../shared/captureTypes.js";
import type { TStrings } from "../shared/strings.js";
import { sidebarFoot, type TFootDot } from "./model.js";

/** A refused code, in the old window's sentence for each way it can fail (renderer.ts pairFailCopy). */
export const pairFailureSentence = (failure: EPairFailure, s: TStrings): string => {
  const sentences: Record<EPairFailure, string> = {
    [EPairFailure.BadCode]: s.pairing.failBadCode,
    [EPairFailure.Refused]: s.pairing.failRefused,
    [EPairFailure.Unreachable]: s.pairing.failUnreachable,
    [EPairFailure.BadReply]: s.pairing.failBadReply,
    [EPairFailure.NotDeployed]: s.pairing.failNotDeployed,
    [EPairFailure.NoEncryption]: s.pairing.failNoEncryption,
    [EPairFailure.StoreFailed]: s.pairing.failStoreFailed,
  };
  return sentences[failure];
};

export type TConnectionView = {
  /** "Connected as MacBook" — or the device's name alone, once Discord has disconnected it. */
  title: string;
  dot: TFootDot;
  /** The upload's state as the foot says it ("312 lines sent · 1 min ago"). */
  line: string;
  /** The old window's whole sentence, where it says more than the line does. */
  note: string | null;
};

/** The old window's sentence for an upload that is not simply going (renderer.ts uploadLine). */
const noteFor = (pairing: TPairingStatus, s: TStrings): string | null => {
  // As the foot decides it (model.ts sidebarFoot): switched off outranks whatever the uploader last said.
  if (!pairing.uploadEnabled || pairing.upload.state === "disabled") {
    return s.pairing.uploadOffHint;
  }
  switch (pairing.upload.state) {
    case "retrying": {
      return s.pairing.upRetrying;
    }
    case "blocked": {
      return s.pairing.upBlocked;
    }
    case "bot-outdated": {
      return s.pairing.upBotOutdated;
    }
    case "unauthorized": {
      return s.pairing.upUnauthorized;
    }
    // "Held until the update", then why and what happens to what is logged meanwhile.
    case "held": {
      return s.shell.notices.held;
    }
    default: {
      return null;
    }
  }
};

/**
 * The connected details (Fh2's third scene): who this computer is, and how its upload stands. Null
 * when not paired — the panel shows the two steps then.
 *
 * Once Discord has disconnected the device, "Connected as …" would be a lie: the title is the
 * device's name alone, and the line under it says what the foot says, "Disconnected in Discord".
 */
export const connectionView = (pairing: TPairingStatus, now: number, platform: string, s: TStrings): TConnectionView | null => {
  const foot = sidebarFoot(pairing, now, platform, s);
  if (!pairing.paired || foot == null) {
    return null;
  }
  const device = pairing.deviceName ?? s.shell.foot.unnamedDevice;
  return {
    title: foot.named ? s.pairing.pairedAs(device) : device,
    dot: foot.dot,
    line: foot.named ? foot.line2 : foot.line1,
    note: noteFor(pairing, s),
  };
};

/**
 * One gold button per window (model.ts `barAction`). While the panel shows its steps, Pair is the
 * step the member opened it to take, and Fh2 draws it gold: it holds the gold, and the bar's Start
 * steps back to its neutral face, as it does for the band's fix. The band's fix outranks it — a
 * capture that cannot run, a broken decoder, is what the window asks first — so under such a band
 * Pair is outlined. Connected, the panel has no gold button (View my loot is a link).
 */
export const pairHoldsTheGold = (open: boolean, pairing: TPairingStatus | null, bandHoldsTheGold: boolean): boolean =>
  open && pairing != null && !pairing.paired && !bandHoldsTheGold;

/** Fh2: the panel stands 8px above the foot's rule, 8px in from the foot's edge, and 8px under the title bar at most. */
export const PANEL_GAP = 8;

export type TPanelPlace = {
  left: number;
  /** From the window's bottom edge: the panel grows upward from the foot. */
  bottom: number;
  /** Set only when the window is too short for the whole panel: it scrolls then, rather than run under the bar. */
  maxHeight: number | null;
};

/**
 * Where the panel goes: fixed to the window, opening upward from the foot (Fh2: "a panel over the
 * page, anchored to the foot; the window never re-flows"). Fixed rather than placed inside the
 * sidebar, so nothing in the page holds or cuts it; and so it is placed from the foot's box as it
 * is now, and again when the window changes size. It never leaves the window: held inside its
 * right edge (the rail is 60px, so it stands over the page), and given a height it can scroll in
 * when the room between the title bar and the foot is less than it needs.
 */
export const placePanel = ({
  foot,
  panel,
  viewport,
  barHeight,
}: {
  /** The foot's box: its rule is the top. */
  foot: { left: number; top: number };
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  barHeight: number;
}): TPanelPlace => {
  const left = Math.max(PANEL_GAP, Math.min(foot.left + PANEL_GAP, viewport.width - PANEL_GAP - panel.width));
  const room = foot.top - PANEL_GAP - (barHeight + PANEL_GAP);
  return {
    left,
    bottom: viewport.height - foot.top + PANEL_GAP,
    maxHeight: panel.height > room ? Math.max(0, room) : null,
  };
};
