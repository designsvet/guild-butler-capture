import { describe, expect, it } from "vitest";

import { connectionView, PANEL_GAP, pairFailureSentence, pairHoldsTheGold, placePanel } from "../src/app/connection.js";
import { barAction, sidebarFoot } from "../src/app/model.js";
import { ECaptureStatus, EPairFailure, initialCaptureState, initialPairingStatus, type TPairingStatus } from "../src/shared/captureTypes.js";
import { SUPPORTED_LANGS } from "../src/shared/i18n.js";
import { lootPageUrl } from "../src/shared/pairing.js";
import { stringsFor } from "../src/shared/strings.js";

/**
 * The guild connection's panel (src/app/connection.ts; board Fh2, "What opens from it"), held
 * without a window: what a refused code says, what the connected details say, where the panel goes.
 * How it behaves in the page — the focus, the keys, the fit at every width — is
 * tools/shell-layout-check.cjs's.
 */

const en = stringsFor("en");
const uk = stringsFor("uk");
const NOW = 1_760_000_000_000;

const paired = (upload: Partial<TPairingStatus["upload"]>, patch: Partial<TPairingStatus> = {}): TPairingStatus => ({
  ...initialPairingStatus,
  paired: true,
  deviceName: "MacBook",
  guildId: "42",
  lootUrl: "https://app.guild-butler.com/?guild=42&tab=loot",
  pairedAt: NOW - 86_400_000,
  ...patch,
  upload: { ...initialPairingStatus.upload, state: "up-to-date", sentTotal: 312, lastSentAt: NOW - 60_000, ...upload },
});

describe("a refused code: the old window's sentence for each way it can fail", () => {
  it("says the board's sentence for a code Discord did not accept", () => {
    expect(pairFailureSentence(EPairFailure.Refused, en)).toBe(
      "Discord's code wasn't accepted. Codes work once and expire after about 10 minutes — run /capture pair again for a fresh one.",
    );
  });

  it("has a sentence of its own for every failure, in every language, and none of them empty", () => {
    const failures = Object.values(EPairFailure);
    expect(failures).toHaveLength(7);
    for (const lang of SUPPORTED_LANGS) {
      const s = stringsFor(lang);
      const said = failures.map((failure) => pairFailureSentence(failure, s));
      expect(said.every((sentence) => sentence.trim().length > 0)).toBe(true);
      expect(new Set(said).size).toBe(failures.length);
    }
  });

  it("is the old pairing block's words, not new ones", () => {
    expect(pairFailureSentence(EPairFailure.BadCode, uk)).toBe(uk.pairing.failBadCode);
    expect(pairFailureSentence(EPairFailure.Unreachable, en)).toBe(en.pairing.failUnreachable);
    expect(pairFailureSentence(EPairFailure.BadReply, en)).toBe(en.pairing.failBadReply);
    expect(pairFailureSentence(EPairFailure.NotDeployed, en)).toBe(en.pairing.failNotDeployed);
    expect(pairFailureSentence(EPairFailure.NoEncryption, en)).toBe(en.pairing.failNoEncryption);
    expect(pairFailureSentence(EPairFailure.StoreFailed, en)).toBe(en.pairing.failStoreFailed);
  });
});

describe("the connected details (Fh2's third scene)", () => {
  it("is not there before a pairing: the panel shows the two steps then", () => {
    expect(connectionView(initialPairingStatus, NOW, "darwin", en)).toBeNull();
  });

  it("names the computer and says the upload as the foot does — Fh2's scene, word for word", () => {
    expect(connectionView(paired({}), NOW, "darwin", en)).toEqual({
      title: "Connected as MacBook",
      dot: "green",
      line: "312 lines sent · 1 min ago",
      note: null,
    });
  });

  it("keeps the foot's dot and line in every state, so the door and the panel never disagree", () => {
    for (const state of ["up-to-date", "sending", "retrying", "blocked", "bot-outdated", "held", "unauthorized"]) {
      const pairing = paired({ state });
      const foot = sidebarFoot(pairing, NOW, "darwin", en);
      const view = connectionView(pairing, NOW, "darwin", en);
      expect(view?.dot).toBe(foot?.dot);
      expect([foot?.line1, foot?.line2]).toContain(view?.line);
    }
  });

  it("adds the old window's whole sentence where it says more than the line", () => {
    expect(connectionView(paired({ state: "retrying" }), NOW, "darwin", en)?.note).toBe(en.pairing.upRetrying);
    expect(connectionView(paired({ state: "blocked" }), NOW, "darwin", en)?.note).toBe(en.pairing.upBlocked);
    expect(connectionView(paired({ state: "bot-outdated" }), NOW, "darwin", en)?.note).toBe(en.pairing.upBotOutdated);
    expect(connectionView(paired({ state: "sending" }), NOW, "darwin", en)?.note).toBeNull();
    expect(connectionView(paired({ sentTotal: 0, lastSentAt: null }), NOW, "darwin", en)).toMatchObject({
      line: "Nothing to send yet",
      note: null,
    });
  });

  it("switched off: says so whatever the uploader last said, as the foot does", () => {
    const view = connectionView(paired({ state: "retrying" }, { uploadEnabled: false }), NOW, "darwin", en);
    expect(view).toMatchObject({ dot: "grey", line: "Auto-send off", note: en.pairing.uploadOffHint });
  });

  it("held by a broken decoder: the foot's amber line, then why and what happens to what is logged", () => {
    const view = connectionView(paired({ state: "held" }), NOW, "darwin", en);
    expect(view).toMatchObject({ dot: "amber", line: "Held until the update", note: en.shell.notices.held });
  });

  it("once Discord has disconnected it, the title is the computer's name — never 'Connected as'", () => {
    const view = connectionView(paired({ state: "unauthorized" }), NOW, "darwin", en);
    expect(view).toEqual({ title: "MacBook", dot: "red", line: "Disconnected in Discord", note: en.pairing.upUnauthorized });
  });

  it("speaks the window's language, and names a computer that has no name", () => {
    const view = connectionView(paired({}, { deviceName: null }), NOW, "win32", uk);
    expect(view?.title).toBe(uk.pairing.pairedAs(uk.shell.foot.unnamedDevice));
  });
});

describe("one gold button per window: Pair holds it while the steps show", () => {
  it("holds it over an idle capture, and the bar's Start steps back to its neutral face", () => {
    const gold = pairHoldsTheGold(true, initialPairingStatus, false);
    expect(gold).toBe(true);
    expect(barAction({ ...initialCaptureState, status: ECaptureStatus.Idle }, gold)).toMatchObject({ kind: "start", look: "neutral" });
  });

  it("not while the panel is shut, nor connected (no gold button there), nor before the pairing is known", () => {
    expect(pairHoldsTheGold(false, initialPairingStatus, false)).toBe(false);
    expect(pairHoldsTheGold(true, paired({}), false)).toBe(false);
    expect(pairHoldsTheGold(true, null, false)).toBe(false);
  });

  it("gives way to the band's fix: Pair is outlined under it", () => {
    expect(pairHoldsTheGold(true, initialPairingStatus, true)).toBe(false);
  });
});

describe("where the panel goes: up from the foot, inside the window", () => {
  const viewport = { width: 1440, height: 620 };

  it("stands 8px above the foot's rule and 8px in from its edge (Fh2)", () => {
    const at = placePanel({ foot: { left: 10, top: 560 }, panel: { width: 348, height: 300 }, viewport, barHeight: 48 });
    expect(at).toEqual({ left: 10 + PANEL_GAP, bottom: 620 - 560 + PANEL_GAP, maxHeight: null });
  });

  it("from the rail, over the page", () => {
    const at = placePanel({ foot: { left: 8, top: 575 }, panel: { width: 348, height: 450 }, viewport: { width: 768, height: 620 }, barHeight: 48 });
    expect(at.left).toBe(16);
    expect(at.maxHeight).toBeNull();
  });

  it("never past the window's right edge", () => {
    const at = placePanel({ foot: { left: 300, top: 560 }, panel: { width: 348, height: 300 }, viewport: { width: 500, height: 620 }, barHeight: 48 });
    expect(at.left).toBe(500 - PANEL_GAP - 348);
  });

  it("scrolls in a window too short for it, rather than run under the title bar", () => {
    const at = placePanel({ foot: { left: 10, top: 400 }, panel: { width: 348, height: 450 }, viewport: { width: 1024, height: 460 }, barHeight: 48 });
    // from 8px above the foot up to 8px under the 48px bar
    expect(at.maxHeight).toBe(400 - PANEL_GAP - (48 + PANEL_GAP));
  });

  it("fits exactly: no height of its own", () => {
    const room = 560 - PANEL_GAP - (48 + PANEL_GAP);
    expect(placePanel({ foot: { left: 10, top: 560 }, panel: { width: 348, height: room }, viewport, barHeight: 48 }).maxHeight).toBeNull();
    expect(placePanel({ foot: { left: 10, top: 560 }, panel: { width: 348, height: room + 1 }, viewport, barHeight: 48 }).maxHeight).toBe(room);
  });
});

describe("View my loot: the member's loot page", () => {
  it("lands on the guild's Loot tab", () => {
    expect(lootPageUrl("https://app.guild-butler.com", "1234567890")).toBe("https://app.guild-butler.com/?guild=1234567890&tab=loot");
  });

  it("escapes what it is given", () => {
    expect(lootPageUrl("https://x.test", "a&b")).toBe("https://x.test/?guild=a%26b&tab=loot");
  });

  it("without a guild, the dashboard's root rather than a deep link to nowhere", () => {
    expect(lootPageUrl("https://app.guild-butler.com", null)).toBe("https://app.guild-butler.com");
    expect(lootPageUrl("https://app.guild-butler.com", "")).toBe("https://app.guild-butler.com");
  });
});
