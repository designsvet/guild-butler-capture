import { describe, expect, it } from "vitest";

import { formatClock, formatDuration } from "../src/app/format.js";
import { barAction, barStatus, headerMeta, sessionHero, sidebarFoot, WAITING_REASONS_AFTER_MS } from "../src/app/model.js";
import {
  ECaptureStatus,
  EEngineErrorKind,
  initialCaptureState,
  initialPairingStatus,
  type TCaptureState,
  type TPairingStatus,
} from "../src/shared/captureTypes.js";
import { stringsFor } from "../src/shared/strings.js";

/**
 * What the v5 shell says in each state (src/app/model.ts), held to the boards: the title bar's
 * status and button (Fh1), the header's meta line (F1, Fh3), the Session hero before data (Fh3) and
 * the sidebar foot (Fh2). The words are the catalog's, so these read the catalog rather than
 * copying it — except where the board's exact line is the point.
 */

const en = stringsFor("en");
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const clock = (at: number): string => `@${(NOW - at) / MIN}m`;

const state = (patch: Partial<TCaptureState>): TCaptureState => ({ ...initialCaptureState, ...patch });

describe("formatDuration: the bar's lengths of time (Fh1)", () => {
  it("counts seconds for the first minute, then whole minutes, then hours and minutes", () => {
    const u = en.shell.units;
    expect(formatDuration(0, u)).toBe("0 s");
    expect(formatDuration(40_000, u)).toBe("40 s");
    expect(formatDuration(59_999, u)).toBe("59 s");
    expect(formatDuration(MIN, u)).toBe("1 min");
    expect(formatDuration(3 * MIN + 59_000, u)).toBe("3 min");
    expect(formatDuration(80 * MIN, u)).toBe("1 h 20 min");
    expect(formatDuration(120 * MIN + 30_000, u)).toBe("2 h");
  });

  it("never runs backwards: a clock behind the snapshot reads 0", () => {
    expect(formatDuration(-5_000, en.shell.units)).toBe("0 s");
  });

  it("a time of day is the locale's short form: no leading zero on a 12-hour clock", () => {
    const at = new Date(2026, 9, 1, 14, 33).getTime();
    expect(formatClock(at, "de")).toBe("14:33");
    expect(formatClock(at, "en-US")).toMatch(/^2:33\sPM$/);
    expect(formatClock(new Date(2026, 9, 1, 9, 5).getTime(), "en-US")).toMatch(/^9:05\sAM$/);
  });

  it("writes each language's own units", () => {
    expect(formatDuration(80 * MIN, stringsFor("uk").shell.units)).toBe("1 год 20 хв");
    expect(formatDuration(80 * MIN, stringsFor("de").shell.units)).toBe("1 Std. 20 Min.");
  });
});

describe("barStatus: the title bar's status in every capture state (Fh1)", () => {
  it("says nothing before the first snapshot, rather than guess Not capturing", () => {
    expect(barStatus(null, NOW, en)).toBeNull();
    expect(barAction(null)).toBeNull();
  });

  it("idle: a grey dot and Not capturing, nothing after it", () => {
    expect(barStatus(state({}), NOW, en)).toEqual({ tone: "grey", look: "state", label: "Not capturing", details: [], short: [] });
  });

  it("starting: amber, Starting the logger…", () => {
    expect(barStatus(state({ status: ECaptureStatus.Starting }), NOW, en)).toMatchObject({
      tone: "amber",
      label: "Starting the logger…",
      details: [],
    });
  });

  it("waiting: amber, and how long it has listened — from this engine run's start", () => {
    const waiting = state({ status: ECaptureStatus.Waiting, startedAt: NOW - 30 * MIN, runStartedAt: NOW - 40_000 });
    expect(barStatus(waiting, NOW, en)).toEqual({
      tone: "amber",
      look: "state",
      label: "Waiting for Albion…",
      details: ["listening for 40 s"],
      short: ["40 s"],
    });
  });

  it("capturing: green, the character in the first ink, and the session's length", () => {
    const capturing = state({ status: ECaptureStatus.Capturing, character: "Bors", startedAt: NOW - 80 * MIN });
    expect(barStatus(capturing, NOW, en)).toEqual({
      tone: "green",
      look: "name",
      label: "Bors",
      details: ["capturing 1 h 20 min"],
      short: ["1 h 20 min"],
    });
  });

  it("capturing before the character is known: Capturing · detecting… · the time", () => {
    const capturing = state({ status: ECaptureStatus.Capturing, startedAt: NOW - 20_000 });
    expect(barStatus(capturing, NOW, en)).toEqual({
      tone: "green",
      look: "state",
      label: "Capturing",
      details: ["detecting…", "20 s"],
      short: ["20 s"],
    });
  });

  it("restarting: amber, the hiccup, and when it comes back", () => {
    const restarting = state({ status: ECaptureStatus.Restarting, restartDelayMs: 3_200 });
    expect(barStatus(restarting, NOW, en)).toMatchObject({
      tone: "amber",
      label: "The logger hiccupped — restarting it…",
      details: ["in 4 s"],
      short: ["in 4 s"],
    });
  });

  it("stopping: grey; error: a red dot and the words in the danger colour", () => {
    expect(barStatus(state({ status: ECaptureStatus.Stopping }), NOW, en)).toMatchObject({ tone: "grey", label: "Stopping…" });
    expect(barStatus(state({ status: ECaptureStatus.Error }), NOW, en)).toMatchObject({
      tone: "red",
      look: "danger",
      label: "Something needs fixing",
      details: [],
    });
  });

  it("never draws a guild or a zone: the app does not know them yet", () => {
    const capturing = state({ status: ECaptureStatus.Capturing, character: "Bors", startedAt: NOW - MIN });
    expect(barStatus(capturing, NOW, en)?.details).toHaveLength(1);
  });
});

describe("barAction: the bar's one button (Fh1)", () => {
  it("Start in gold when idle, Start in the neutral lift in the error state — one gold button per window", () => {
    expect(barAction(state({}))).toEqual({ kind: "start", look: "primary", disabled: false });
    expect(barAction(state({ status: ECaptureStatus.Error }))).toEqual({ kind: "start", look: "neutral", disabled: false });
  });

  it("Stop while the logger runs — restarting included, so the backoff loop can be stopped", () => {
    for (const status of [ECaptureStatus.Waiting, ECaptureStatus.Capturing, ECaptureStatus.Restarting]) {
      expect(barAction(state({ status })), status).toEqual({ kind: "stop", look: "danger", disabled: false });
    }
  });

  it("a dimmed Stop that refuses the press while the logger starts or stops", () => {
    for (const status of [ECaptureStatus.Starting, ECaptureStatus.Stopping]) {
      expect(barAction(state({ status })), status).toEqual({ kind: "stop", look: "danger", disabled: true });
    }
  });
});

describe("headerMeta: the line beside the range tabs", () => {
  it("waiting: Listening since, from this engine run's start (Fh3)", () => {
    const waiting = state({ status: ECaptureStatus.Waiting, startedAt: NOW - 30 * MIN, runStartedAt: NOW - 3 * MIN });
    expect(headerMeta(waiting, NOW, en, clock)).toBe("Listening since @3m");
  });

  it("capturing: when the session started and how long it has run (F1)", () => {
    const capturing = state({ status: ECaptureStatus.Capturing, character: "Bors", startedAt: NOW - 80 * MIN });
    expect(headerMeta(capturing, NOW, en, clock)).toBe("Started @80m · 1 h 20 min");
  });

  it("nothing when there is no session to describe", () => {
    expect(headerMeta(state({}), NOW, en, clock)).toBe("");
    expect(headerMeta(state({ status: ECaptureStatus.Starting }), NOW, en, clock)).toBe("");
    expect(headerMeta(null, NOW, en, clock)).toBe("");
  });
});

describe("sessionHero: the Session page before data (Fh3, Fh7)", () => {
  it("waiting: the app's own hint, then the new line about what appears", () => {
    const waiting = state({ status: ECaptureStatus.Waiting, runStartedAt: NOW - 40_000 });
    expect(sessionHero(waiting, NOW, "darwin", en)).toEqual({
      icon: "radar",
      title: en.status.waiting,
      lines: [en.statusHint.waiting, en.shell.session.waitingMore],
      tight: false,
      reasons: false,
    });
  });

  it("the three waiting reasons arrive after 90 s of waiting, as the old window's do", () => {
    const at = (ms: number) => sessionHero(state({ status: ECaptureStatus.Waiting, runStartedAt: NOW - ms }), NOW, "darwin", en);
    expect(at(WAITING_REASONS_AFTER_MS)?.reasons).toBe(false);
    expect(at(WAITING_REASONS_AFTER_MS + 1_000)?.reasons).toBe(true);
  });

  it("capturing with nothing to count yet: Capturing, the character's line, then the promise", () => {
    const capturing = state({ status: ECaptureStatus.Capturing, character: "Bors" });
    expect(sessionHero(capturing, NOW, "darwin", en)).toMatchObject({
      icon: "chart",
      title: "Capturing",
      lines: ["Loot events near Bors are being written to the log.", "Numbers appear as soon as there is something to count."],
      tight: true,
    });
  });

  it("starting and not capturing: the app's own sentence alone", () => {
    expect(sessionHero(state({ status: ECaptureStatus.Starting }), NOW, "darwin", en)).toMatchObject({
      title: en.status.starting,
      lines: [en.statusHint.starting],
    });
    expect(sessionHero(state({}), NOW, "darwin", en)).toMatchObject({ icon: "pause", title: "Not capturing", lines: [en.statusHint.idle] });
  });

  it("an error names what is wrong in the platform's own story, and offers no fix it cannot make", () => {
    const blocked = state({ status: ECaptureStatus.Error, errorKind: EEngineErrorKind.Permission });
    expect(sessionHero(blocked, NOW, "darwin", en)?.lines).toEqual([en.errors.permissionTitle]);
    expect(sessionHero(blocked, NOW, "win32", en)?.lines).toEqual([en.errors.npcapAdminOnlyTitle]);
  });
});

describe("sidebarFoot: the guild connection, one line and a quieter one (Fh2)", () => {
  const paired = (upload: Partial<TPairingStatus["upload"]>, patch: Partial<TPairingStatus> = {}): TPairingStatus => ({
    ...initialPairingStatus,
    paired: true,
    deviceName: "MacBook",
    guildId: "1",
    ...patch,
    upload: { ...initialPairingStatus.upload, state: "up-to-date", ...upload },
  });

  it("waits for the pairing rather than flash Connect a guild past a paired member", () => {
    expect(sidebarFoot(null, NOW, "darwin", en)).toBeNull();
  });

  it("not connected: a hollow dot, Connect a guild, and where the sessions stay", () => {
    expect(sidebarFoot(initialPairingStatus, NOW, "darwin", en)).toEqual({
      dot: "hollow",
      line1: "Connect a guild",
      connect: true,
      line2: "Sessions stay on this Mac",
    });
    expect(sidebarFoot(initialPairingStatus, NOW, "win32", en)?.line2).toBe("Sessions stay on this computer");
  });

  it("names the device alone — the app knows no guild name", () => {
    expect(sidebarFoot(paired({}), NOW, "darwin", en)?.line1).toBe("MacBook");
    expect(sidebarFoot(paired({}, { deviceName: null }), NOW, "darwin", en)?.line1).toBe("This computer");
  });

  it("up to date: how many lines went, and when", () => {
    expect(sidebarFoot(paired({ sentTotal: 312, lastSentAt: NOW - 70_000 }), NOW, "darwin", en)).toEqual({
      dot: "green",
      line1: "MacBook",
      connect: false,
      line2: "312 lines sent · 1 min ago",
    });
    expect(sidebarFoot(paired({ sentTotal: 1, lastSentAt: NOW - 5_000 }), NOW, "darwin", en)?.line2).toBe("1 line sent · just now");
    expect(sidebarFoot(paired({ sentTotal: 0 }), NOW, "darwin", en)?.line2).toBe("Nothing to send yet");
  });

  it("each sending state its short line and its dot", () => {
    const line = (state: string) => {
      const foot = sidebarFoot(paired({ state, sentTotal: 9, lastSentAt: NOW }), NOW, "darwin", en);
      return `${foot?.dot} ${foot?.line1} / ${foot?.line2}`;
    };
    expect(line("sending")).toBe("green MacBook / Sending…");
    expect(line("retrying")).toBe("amber MacBook / Couldn't send — retrying");
    expect(line("bot-outdated")).toBe("amber MacBook / Bot needs an update");
    expect(line("blocked")).toBe("red MacBook / Stuck — tell your officer");
    expect(line("unauthorized")).toBe("red Disconnected in Discord / Pair again to resume");
    expect(line("disabled")).toBe("grey MacBook / Auto-send off");
  });

  it("auto-send switched off wins over whatever the uploader last said", () => {
    const foot = sidebarFoot(paired({ state: "retrying" }, { uploadEnabled: false }), NOW, "darwin", en);
    expect(foot).toMatchObject({ dot: "grey", line2: "Auto-send off" });
  });
});
