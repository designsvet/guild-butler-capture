import { describe, expect, it } from "vitest";

import { formatClock, formatDuration } from "../src/app/format.js";
import { barAction, barStatus, headerMeta, sessionHero, sidebarFoot, WAITING_REASONS_AFTER_MS } from "../src/app/model.js";
import { holdsTheGold, noticeView, type TNoticeContext } from "../src/app/notices.js";
import { INITIAL_UI } from "../src/app/store.js";
import {
  ECaptureAccess,
  ECaptureStatus,
  EEngineErrorKind,
  ENpcapInstallOutcome,
  EPermissionFixOutcome,
  EUpdatePhase,
  initialCaptureState,
  initialPairingStatus,
  initialUpdateStatus,
  type TCaptureState,
  type TPairingStatus,
  type TSetupStatus,
} from "../src/shared/captureTypes.js";
import { EHealthAction, EHealthLine } from "../src/shared/engineHealth.js";
import { EBlock, ENotice } from "../src/shared/notices.js";
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
      named: false,
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
      named: true,
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
    // the decoder is broken: the upload waits for the update (Fh2, Fh4 — amber, not a fault of the link)
    expect(line("held")).toBe("amber MacBook / Held until the update");
  });

  it("a name may end in an ellipsis; a state in words may not — it wraps (unauthorized)", () => {
    const named = (state: string) => sidebarFoot(paired({ state }), NOW, "darwin", en)?.named;
    expect(["up-to-date", "sending", "retrying", "bot-outdated", "blocked", "disabled", "held"].map(named)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(named("unauthorized")).toBe(false);
    expect(sidebarFoot(initialPairingStatus, NOW, "darwin", en)?.named).toBe(false);
  });

  it("auto-send switched off wins over whatever the uploader last said", () => {
    const foot = sidebarFoot(paired({ state: "retrying" }, { uploadEnabled: false }), NOW, "darwin", en);
    expect(foot).toMatchObject({ dot: "grey", line2: "Auto-send off" });
  });
});

describe("the bar and the hero when capture is blocked (Fh1, Fh4)", () => {
  it("the dot goes red only when capture is blocked — an idle capture the probe knows cannot start", () => {
    expect(barStatus(state({}), NOW, en, true)).toEqual({ tone: "red", look: "danger", label: "Something needs fixing", details: [], short: [] });
    expect(barStatus(state({}), NOW, en, false)).toMatchObject({ tone: "grey", label: "Not capturing" });
    // a broken decoder is the band's to say, not the bar's
    expect(barStatus(state({ status: ECaptureStatus.Capturing, character: "Bors", engineBroken: [{ handler: "EvAttachItemContainer", failures: 5, calls: 5 }] }), NOW, en)?.tone).toBe("green");
  });

  it("Start steps back to the neutral face while the band holds the next step — one gold button per window", () => {
    expect(barAction(state({}), true)).toEqual({ kind: "start", look: "neutral", disabled: false });
    expect(barAction(state({}), false)).toEqual({ kind: "start", look: "primary", disabled: false });
    expect(barAction(state({ status: ECaptureStatus.Capturing }), true)).toEqual({ kind: "stop", look: "danger", disabled: false });
  });

  it("the hero of a blocked idle capture says what blocks it, as the bar does", () => {
    expect(sessionHero(state({}), NOW, "darwin", en, EBlock.MacPermission)).toMatchObject({
      icon: "alert",
      title: "Something needs fixing",
      lines: [en.errors.permissionTitle],
    });
    expect(sessionHero(state({}), NOW, "win32", en, EBlock.EngineMissing)?.lines).toEqual([en.errors.engineMissingTitle]);
    expect(sessionHero(state({}), NOW, "darwin", en, null)?.title).toBe("Not capturing");
  });
});

describe("noticeView: each notice of board Fh5 in the app's own words, and its button", () => {
  const setup = (patch: Partial<TSetupStatus> = {}): TSetupStatus => ({
    platform: "darwin",
    engineEntry: "/engine/src/index.js",
    engineRoot: "/engine",
    engineSource: "bundled",
    captureDir: "/data/captures",
    access: ECaptureAccess.Ok,
    appVersion: "0.8.8",
    builtAt: null,
    ...patch,
  });
  const ATTACH = { handler: "EvOtherGrabbedLoot", failures: 5, calls: 5 };
  const ctx = (patch: Partial<TNoticeContext> = {}): TNoticeContext => ({
    capture: state({}),
    setup: setup(),
    update: { ...initialUpdateStatus },
    ui: INITIAL_UI,
    s: en,
    ...patch,
  });
  const blocked = (block: EBlock, c: Partial<TNoticeContext> = {}) => noticeView({ kind: ENotice.Blocked, block }, ctx(c));

  it("macOS blocking capture: its title and sentence, the fix in gold; after the prompt was closed, the old window's note", () => {
    expect(blocked(EBlock.MacPermission)).toEqual({
      kind: ENotice.Blocked,
      tone: "alert",
      icon: "shield",
      title: "macOS is blocking network capture",
      body: en.errors.permission,
      notes: [],
      details: [],
      buttons: [{ id: "fix-mac", label: "Fix capture permissions…", look: "primary", busy: false }],
    });
    const cancelled = { setup: setup({ access: ECaptureAccess.NoPermission }), outcome: EPermissionFixOutcome.Cancelled, detail: null };
    expect(blocked(EBlock.MacPermission, { setup: cancelled.setup, ui: { ...INITIAL_UI, fixAttempt: cancelled } }).notes).toEqual([
      en.setup.permissionFixCancelled,
    ]);
    // fixed: the note goes
    expect(blocked(EBlock.MacPermission, { ui: { ...INITIAL_UI, fixAttempt: cancelled } }).notes).toEqual([]);
  });

  it("the capture driver: install in gold and the link beside it on Windows; while it fetches, dimmed, and the note says so", () => {
    const win = { setup: setup({ platform: "win32" }) };
    expect(blocked(EBlock.NpcapMissing, win)).toMatchObject({
      icon: "desktop",
      title: "One-time setup: the capture driver",
      body: en.errors.npcapMissing,
      buttons: [
        { id: "install-npcap", label: "Install capture driver", look: "primary", busy: false },
        { id: "get-npcap", label: "Download it myself", look: "link", busy: false },
      ],
    });
    const fetching = blocked(EBlock.NpcapMissing, { ...win, ui: { ...INITIAL_UI, npcapBusy: true } });
    expect(fetching.notes).toEqual(["Fetching the capture driver from npcap.com…"]);
    expect(fetching.buttons[0]?.busy).toBe(true);
    const done = { setup: setup({ platform: "win32" }), install: { outcome: ENpcapInstallOutcome.Installed, version: "1.80", detail: null } };
    expect(blocked(EBlock.NpcapMissing, { ...win, ui: { ...INITIAL_UI, npcapAttempt: done } }).notes).toEqual([en.setup.npcapInstalled("1.80")]);
  });

  it("admin-only Npcap: the link alone; the rarer two the same card — the engine folder in gold, a rebuild with no button", () => {
    expect(blocked(EBlock.NpcapAdminOnly).buttons).toEqual([{ id: "get-npcap", label: "Download it myself", look: "link", busy: false }]);
    expect(blocked(EBlock.EngineMissing)).toMatchObject({
      title: "Capture engine not found",
      buttons: [{ id: "choose-engine", label: "Choose engine folder…", look: "primary", busy: false }],
    });
    expect(blocked(EBlock.AbiMismatch)).toMatchObject({ title: "The capture engine needs a rebuild", buttons: [] });
  });

  it("the broken decoder: the headline, the fix's line, the held line and the technical detail; healthCard's button", () => {
    const broken = state({ status: ECaptureStatus.Capturing, engineBroken: [ATTACH] });
    const ready = { ...initialUpdateStatus, phase: EUpdatePhase.Ready, version: "0.9.1" };
    const view = noticeView(
      { kind: ENotice.Decoder, line: EHealthLine.Ready, action: EHealthAction.StopAndUpdate },
      ctx({ capture: broken, update: ready }),
    );
    expect(view).toEqual({
      kind: ENotice.Decoder,
      tone: "alert",
      icon: "alert",
      title: "A game update broke loot logging",
      body: "Until this app is updated, some of the loot it records is wrong — your guild's loot numbers will be off. The fix is downloaded (v0.9.1). Update now — it takes a few seconds.",
      notes: ["Nothing is sent to your guild until then — what is logged meanwhile stays in the file on this computer."],
      details: ["EvOtherGrabbedLoot failed on 5 of 5 packets in the last 10 minutes."],
      buttons: [{ id: "update-now", label: "Stop capture and update", look: "primary", busy: false }],
    });
    const decoder = (line: EHealthLine, action: EHealthAction, update = initialUpdateStatus) =>
      noticeView({ kind: ENotice.Decoder, line, action }, ctx({ capture: broken, update }));
    expect(decoder(EHealthLine.NotOutYet, EHealthAction.CheckForFix).buttons).toEqual([
      { id: "check-for-fix", label: "Check for the fix", look: "outline", busy: false },
    ]);
    expect(decoder(EHealthLine.Downloading, EHealthAction.None, { ...initialUpdateStatus, version: "0.9.1", percent: 40 })).toMatchObject({
      body: expect.stringContaining("The fix is downloading (v0.9.1)… 40%"),
      buttons: [],
    });
    expect(decoder(EHealthLine.Manual, EHealthAction.GetUpdate).buttons).toEqual([
      { id: "get-update", label: "Get the update", look: "link", busy: false },
    ]);
  });

  it("the logger keeps stopping: quiet, no button; when the next restart comes, then that it is starting", () => {
    const waiting = state({ status: ECaptureStatus.Restarting, restartAttempt: 4, restartDelayMs: 8_000 });
    expect(noticeView({ kind: ENotice.LoggerStopping }, ctx({ capture: waiting }))).toEqual({
      kind: ENotice.LoggerStopping,
      tone: "quiet",
      icon: "refresh",
      title: "The logger keeps stopping",
      body: "The capture engine stopped unexpectedly. It restarts by itself in 8s — your log file and counts are safe.",
      notes: [],
      details: [],
      buttons: [],
    });
    expect(noticeView({ kind: ENotice.LoggerStopping }, ctx({ capture: state({ status: ECaptureStatus.Starting, restartAttempt: 4 }) })).body).toBe(
      en.statusHint.starting,
    );
  });

  it("an update is ready: quiet; while capturing it offers the decoder's own stop-and-update", () => {
    const ready = { ...initialUpdateStatus, phase: EUpdatePhase.Ready, version: "0.9.1" };
    expect(noticeView({ kind: ENotice.UpdateReady, running: false }, ctx({ update: ready }))).toEqual({
      kind: ENotice.UpdateReady,
      tone: "quiet",
      icon: "download",
      title: "An update is ready",
      body: "Update v0.9.1 ready — it installs when you quit the app.",
      notes: [],
      details: [],
      buttons: [{ id: "update-now", label: "Restart and update", look: "outline", busy: false }],
    });
    expect(noticeView({ kind: ENotice.UpdateReady, running: true }, ctx({ update: ready }))).toMatchObject({
      body: "Capture is running — the update installs when you quit, or stop capture first.",
      buttons: [{ id: "update-now", label: "Stop capture and update", look: "outline", busy: false }],
    });
  });

  it("only a gold fix makes Start step back", () => {
    expect(holdsTheGold(blocked(EBlock.MacPermission))).toBe(true);
    expect(holdsTheGold(blocked(EBlock.NpcapAdminOnly))).toBe(false);
    expect(holdsTheGold(noticeView({ kind: ENotice.UpdateReady, running: false }, ctx()))).toBe(false);
    expect(holdsTheGold(null)).toBe(false);
  });

  it("every notice in every language has its words — no slot left empty", () => {
    const kinds = [
      ...Object.values(EBlock).map((block) => ({ kind: ENotice.Blocked, block }) as const),
      { kind: ENotice.Decoder, line: EHealthLine.Ready, action: EHealthAction.StopAndUpdate } as const,
      { kind: ENotice.LoggerStopping } as const,
      { kind: ENotice.UpdateReady, running: true } as const,
    ];
    for (const lang of ["en", "uk", "ru", "de", "fr", "pt"] as const) {
      const s = stringsFor(lang);
      for (const notice of kinds) {
        const view = noticeView(notice, ctx({ s, capture: state({ engineBroken: [ATTACH] }), setup: setup({ platform: "win32" }) }));
        expect(view.title.length, `${lang} ${notice.kind}`).toBeGreaterThan(0);
        for (const button of view.buttons) {
          expect(button.label.length, `${lang} ${notice.kind} ${button.id}`).toBeGreaterThan(0);
        }
      }
      expect(s.shell.notices.held.length).toBeGreaterThan(20);
      expect(s.shell.notices.later.length).toBeGreaterThan(0);
      expect(s.shell.foot.held.length).toBeGreaterThan(0);
    }
  });
});
