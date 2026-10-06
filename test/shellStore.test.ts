import { describe, expect, it, vi } from "vitest";

import { createRouter, DEFAULT_ROUTE, hrefOf, nextRoute, type TRoute } from "../src/app/router.js";
import { createShellStore } from "../src/app/store.js";
import { newSession, type TSession } from "../src/shared/session/model.js";
import type { TGbc } from "../src/shared/bridge.js";
import {
  ECaptureStatus,
  initialCaptureState,
  initialPairingStatus,
  initialUpdateStatus,
  type TAppSettings,
  type TCaptureState,
  type TNpcapFixResult,
  type TPairAttempt,
  type TPairingStatus,
  type TPermissionFixResult,
  type TRestartResult,
  type TSetupStatus,
  type TUpdateStatus,
  ECaptureAccess,
  ENpcapInstallOutcome,
  EPermissionFixOutcome,
  EPairFailure,
  ERestartRefusal,
  EUpdatePhase,
} from "../src/shared/captureTypes.js";

/**
 * The v5 shell's two stores (src/app/store.ts, src/app/router.ts), driven without a window: a
 * fake bridge whose answers the test releases by hand, so the order things land in is the test's
 * to choose.
 */

const SETUP: TSetupStatus = {
  platform: "darwin",
  engineEntry: "/engine/src/index.js",
  engineRoot: "/engine",
  engineSource: "bundled",
  captureDir: "/data/captures",
  access: "ok" as TSetupStatus["access"],
  appVersion: "0.8.8",
  builtAt: null,
};

type TDeferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const deferred = <T>(): TDeferred<T> => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const fakeBridge = () => {
  const calls: string[] = [];
  const answers = {
    session: deferred<TSession | null>(),
    state: deferred<TCaptureState>(),
    setup: deferred<TSetupStatus>(),
    pairing: deferred<TPairingStatus>(),
    update: deferred<TUpdateStatus>(),
    settings: deferred<TAppSettings>(),
  };
  const push: {
    session?: (s: TSession | null) => void;
    state?: (s: TCaptureState) => void;
    pairing?: (s: TPairingStatus) => void;
    update?: (s: TUpdateStatus) => void;
  } = {};
  const settings = (patch: Partial<TAppSettings>): TAppSettings => ({
    autoCapture: false,
    language: null,
    theme: "obsidian",
    ...patch,
  });
  const restartAnswer: { value: TRestartResult } = { value: { ok: true } };
  const checkAnswer = deferred<TUpdateStatus>();
  const fixAnswer = deferred<TPermissionFixResult>();
  const npcapAnswer = deferred<TNpcapFixResult>();
  const languageAnswer = deferred<TAppSettings>();
  const themeAnswer = deferred<TAppSettings>();
  const pairAnswer = deferred<TPairAttempt>();
  const uploadAnswer = deferred<TPairingStatus>();
  const copyAnswer = deferred<void>();
  const bridge = {
    platform: "darwin",
    getSession: () => answers.session.promise,
    onSession: (listener: (s: TSession | null) => void) => ((push.session = listener), () => {}),
    newSession: vi.fn(() => Promise.resolve(null)),
    getState: () => (calls.push("getState"), answers.state.promise),
    getSetup: () => (
      calls.push("getSetup"),
      calls.filter((c) => c === "getSetup").length === 1 ? answers.setup.promise : Promise.resolve(SETUP)
    ),
    getPairing: () => (calls.push("getPairing"), answers.pairing.promise),
    getUpdate: () => (calls.push("getUpdate"), answers.update.promise),
    getSettings: () => (calls.push("getSettings"), answers.settings.promise),
    onState: (listener: (s: TCaptureState) => void) => (calls.push("onState"), (push.state = listener), () => {}),
    onPairing: (listener: (s: TPairingStatus) => void) => (
      calls.push("onPairing"),
      (push.pairing = listener),
      () => {}
    ),
    onUpdate: (listener: (s: TUpdateStatus) => void) => (calls.push("onUpdate"), (push.update = listener), () => {}),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    reveal: vi.fn(() => Promise.resolve(true)),
    setAutoCapture: vi.fn((enabled: boolean) => Promise.resolve(settings({ autoCapture: enabled }))),
    setLanguage: vi.fn(() => languageAnswer.promise),
    setTheme: vi.fn(() => themeAnswer.promise),
    openPrivacy: vi.fn(() => Promise.resolve()),
    updateRestart: vi.fn(() => Promise.resolve(restartAnswer.value)),
    updateCheckNow: vi.fn(() => checkAnswer.promise),
    fixMacPermissions: vi.fn(() => fixAnswer.promise),
    installNpcap: vi.fn(() => npcapAnswer.promise),
    openNpcapPage: vi.fn(() => Promise.resolve()),
    pickEnginePath: vi.fn(() => Promise.resolve({ ...SETUP, engineEntry: "/picked/src/index.js" })),
    pair: vi.fn(() => pairAnswer.promise),
    unpair: vi.fn(() => Promise.resolve(initialPairingStatus)),
    setUpload: vi.fn(() => uploadAnswer.promise),
    openLoot: vi.fn(() => Promise.resolve()),
    copyText: vi.fn(() => copyAnswer.promise),
  } as unknown as TGbc & {
    newSession: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setAutoCapture: ReturnType<typeof vi.fn>;
    setLanguage: ReturnType<typeof vi.fn>;
    setTheme: ReturnType<typeof vi.fn>;
    openPrivacy: ReturnType<typeof vi.fn>;
    updateRestart: ReturnType<typeof vi.fn>;
    updateCheckNow: ReturnType<typeof vi.fn>;
    fixMacPermissions: ReturnType<typeof vi.fn>;
    installNpcap: ReturnType<typeof vi.fn>;
    openNpcapPage: ReturnType<typeof vi.fn>;
    pickEnginePath: ReturnType<typeof vi.fn>;
    pair: ReturnType<typeof vi.fn>;
    unpair: ReturnType<typeof vi.fn>;
    setUpload: ReturnType<typeof vi.fn>;
    openLoot: ReturnType<typeof vi.fn>;
    copyText: ReturnType<typeof vi.fn>;
  };
  let onFocus: () => void = () => {};
  const focus = {
    addEventListener: (_type: "focus", listener: () => void) => {
      calls.push("focus listener");
      onFocus = listener;
    },
  };
  return {
    bridge,
    focus,
    calls,
    answers,
    push,
    settings,
    restartAnswer,
    checkAnswer,
    fixAnswer,
    npcapAnswer,
    languageAnswer,
    themeAnswer,
    pairAnswer,
    uploadAnswer,
    copyAnswer,
    focusWindow: () => onFocus(),
  };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

const answerAll = (
  fake: ReturnType<typeof fakeBridge>,
  capture: Partial<TCaptureState>,
  settings: Partial<TAppSettings>,
) => {
  fake.answers.state.resolve({ ...initialCaptureState, ...capture });
  fake.answers.setup.resolve(SETUP);
  fake.answers.pairing.resolve(initialPairingStatus);
  fake.answers.update.resolve(initialUpdateStatus);
  fake.answers.settings.resolve(fake.settings(settings));
};

describe("the shell's store: a mirror of the bridge", () => {
  it("boots with the five get calls, then the three subscriptions, then the focus re-probe", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    expect(fake.calls).toEqual([
      "getState",
      "getSetup",
      "getPairing",
      "getUpdate",
      "getSettings",
      "onState",
      "onPairing",
      "onUpdate",
      "focus listener",
    ]);
    answerAll(fake, {}, {});
    await booting;
    expect(store.getSnapshot()).toMatchObject({
      capture: { status: ECaptureStatus.Idle },
      setup: SETUP,
      pairing: initialPairingStatus,
      update: initialUpdateStatus,
      settings: { autoCapture: false },
    });
  });

  it("boots once: a second boot subscribes nothing more", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const first = store.boot();
    const second = store.boot();
    answerAll(fake, {}, {});
    await Promise.all([first, second]);
    expect(fake.calls.filter((c) => c === "onState")).toHaveLength(1);
  });

  it("a push that lands while the gets are in flight is newer than their answer, and wins", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    fake.push.state?.({ ...initialCaptureState, status: ECaptureStatus.Capturing, character: "Bors" });
    fake.push.pairing?.({ ...initialPairingStatus, paired: true, deviceName: "MacBook" });
    answerAll(fake, { status: ECaptureStatus.Waiting }, {});
    await booting;
    await flush();
    expect(store.getSnapshot().capture).toMatchObject({ status: ECaptureStatus.Capturing, character: "Bors" });
    expect(store.getSnapshot().pairing).toMatchObject({ paired: true, deviceName: "MacBook" });
  });

  it("tells its subscribers on every change, and stops when they leave", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    const booting = store.boot();
    answerAll(fake, {}, {});
    await booting;
    await flush();
    const seen = listener.mock.calls.length;
    expect(seen).toBeGreaterThanOrEqual(5);
    leave();
    fake.push.update?.({ ...initialUpdateStatus });
    expect(listener.mock.calls.length).toBe(seen);
  });

  it("probes the setup again when the window gets focus, as the old window does", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    answerAll(fake, {}, {});
    await booting;
    fake.focusWindow();
    await flush();
    expect(fake.calls.filter((c) => c === "getSetup")).toHaveLength(2);
  });

  it("auto-starts once, after the first state and the settings, only over an idle capture", async () => {
    const run = async (capture: Partial<TCaptureState>, settings: Partial<TAppSettings>) => {
      const fake = fakeBridge();
      const store = createShellStore(fake.bridge, fake.focus);
      const booting = store.boot();
      answerAll(fake, capture, settings);
      await booting;
      await store.boot();
      return fake.bridge.start.mock.calls.length;
    };
    expect(await run({}, { autoCapture: true })).toBe(1);
    expect(await run({}, { autoCapture: false })).toBe(0);
    // a window reopened over a running capture starts nothing
    expect(await run({ status: ECaptureStatus.Capturing }, { autoCapture: true })).toBe(0);
  });

  it("draws the auto-start switch at once, then keeps what main stored", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    answerAll(fake, {}, {});
    await booting;
    store.setAutoCapture(true);
    expect(store.getSnapshot().settings?.autoCapture).toBe(true);
    expect(fake.bridge.setAutoCapture).toHaveBeenCalledWith(true);
    await flush();
    expect(store.getSnapshot().settings?.autoCapture).toBe(true);
  });
});

describe("the shell's store: the settings drawer", () => {
  const booted = async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    answerAll(fake, {}, { language: "en", theme: "obsidian" });
    await booting;
    await flush();
    return { fake, store };
  };

  it("draws a picked language at once, then keeps what main stored", async () => {
    const { fake, store } = await booted();
    store.setLanguage("uk");
    expect(store.getSnapshot().settings?.language).toBe("uk");
    expect(fake.bridge.setLanguage).toHaveBeenCalledWith("uk");
    // main has the last word: what it stored is what is drawn
    fake.languageAnswer.resolve(fake.settings({ language: "de" }));
    await flush();
    expect(store.getSnapshot().settings?.language).toBe("de");
  });

  it("System is stored as no language, so the window follows the OS again", async () => {
    const { fake, store } = await booted();
    store.setLanguage(null);
    expect(store.getSnapshot().settings?.language).toBeNull();
    expect(fake.bridge.setLanguage).toHaveBeenCalledWith(null);
  });

  it("draws a picked theme at once, then keeps what main stored", async () => {
    const { fake, store } = await booted();
    store.setTheme("parchment");
    expect(store.getSnapshot().settings?.theme).toBe("parchment");
    expect(fake.bridge.setTheme).toHaveBeenCalledWith("parchment");
    fake.themeAnswer.resolve(fake.settings({ theme: "parchment" }));
    await flush();
    expect(store.getSnapshot().settings?.theme).toBe("parchment");
  });

  it("before the settings arrive a pick is not drawn over nothing: main's answer alone will be", async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    void store.boot();
    store.setTheme("parchment");
    expect(store.getSnapshot().settings).toBeNull();
    expect(fake.bridge.setTheme).toHaveBeenCalledWith("parchment");
  });

  it("the privacy policy is main's to open", async () => {
    const { fake, store } = await booted();
    store.openPrivacy();
    expect(fake.bridge.openPrivacy).toHaveBeenCalledTimes(1);
  });
});

describe("the shell's store: the guild connection's panel", () => {
  const PAIRED: TPairingStatus = {
    ...initialPairingStatus,
    paired: true,
    deviceName: "MacBook",
    guildId: "42",
    lootUrl: "https://app.guild-butler.com/?guild=42&tab=loot",
    pairedAt: 1,
  };
  const booted = async () => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    answerAll(fake, {}, {});
    await booting;
    await flush();
    return { fake, store };
  };

  it("Pair: one code at a time, busy until main answers, then main's pairing", async () => {
    const { fake, store } = await booted();
    store.pair("abcd-efgh");
    expect(fake.bridge.pair).toHaveBeenCalledWith("abcd-efgh");
    expect(store.getSnapshot().ui.pairBusy).toBe(true);
    store.pair("abcd-efgh");
    expect(fake.bridge.pair).toHaveBeenCalledTimes(1);
    fake.pairAnswer.resolve({ ok: true, failure: null, detail: null, status: PAIRED });
    await flush();
    expect(store.getSnapshot().ui.pairBusy).toBe(false);
    expect(store.getSnapshot().ui.pairFailure).toBeNull();
    expect(store.getSnapshot().pairing).toEqual(PAIRED);
  });

  it("a refused code is kept until the next try, which forgets it while main checks", async () => {
    const { fake, store } = await booted();
    store.pair("WRONG");
    fake.pairAnswer.resolve({ ok: false, failure: EPairFailure.BadCode, detail: null, status: initialPairingStatus });
    await flush();
    expect(store.getSnapshot().ui.pairFailure).toBe(EPairFailure.BadCode);
    store.pair("again");
    expect(store.getSnapshot().ui.pairFailure).toBeNull();
  });

  it("a call that never comes back is the old window's: the bot could not be reached", async () => {
    const fake = fakeBridge();
    fake.bridge.pair.mockImplementation(() => Promise.reject(new Error("ipc gone")));
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    answerAll(fake, {}, {});
    await booting;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    store.pair("abcd-efgh");
    await flush();
    errors.mockRestore();
    expect(store.getSnapshot().ui).toMatchObject({ pairBusy: false, pairFailure: EPairFailure.Unreachable });
  });

  it("the panel closing forgets a refusal", async () => {
    const { fake, store } = await booted();
    store.pair("x");
    fake.pairAnswer.resolve({ ok: false, failure: EPairFailure.Refused, detail: null, status: initialPairingStatus });
    await flush();
    store.forgetPairFailure();
    expect(store.getSnapshot().ui.pairFailure).toBeNull();
  });

  it("Disconnect forgets a refusal too — the steps it brings back start clean — and keeps main's pairing", async () => {
    const { fake, store } = await booted();
    store.pair("x");
    fake.pairAnswer.resolve({ ok: false, failure: EPairFailure.Refused, detail: null, status: initialPairingStatus });
    await flush();
    // paired since, from elsewhere, with the refusal still held
    fake.push.pairing?.(PAIRED);
    expect(store.getSnapshot().ui.pairFailure).toBe(EPairFailure.Refused);
    store.unpair();
    await flush();
    expect(fake.bridge.unpair).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().ui.pairFailure).toBeNull();
    expect(store.getSnapshot().pairing).toEqual(initialPairingStatus);
  });

  it("draws Send loot automatically at once, then keeps what main stored", async () => {
    const { fake, store } = await booted();
    fake.push.pairing?.(PAIRED);
    store.setUpload(false);
    expect(store.getSnapshot().pairing?.uploadEnabled).toBe(false);
    expect(fake.bridge.setUpload).toHaveBeenCalledWith(false);
    fake.uploadAnswer.resolve({ ...PAIRED, uploadEnabled: true });
    await flush();
    expect(store.getSnapshot().pairing?.uploadEnabled).toBe(true);
  });

  it("View my loot is main's to open; the command copied is Discord's, and says when it is on the clipboard", async () => {
    const { fake, store } = await booted();
    store.openLoot();
    expect(fake.bridge.openLoot).toHaveBeenCalledTimes(1);
    const copied = store.copyPairCommand();
    expect(fake.bridge.copyText).toHaveBeenCalledWith("/capture pair");
    fake.copyAnswer.resolve();
    await expect(copied).resolves.toBe(true);
  });
});

describe("the shell's store: the notices' buttons", () => {
  const booted = async (capture: Partial<TCaptureState> = {}) => {
    const fake = fakeBridge();
    const store = createShellStore(fake.bridge, fake.focus);
    const booting = store.boot();
    answerAll(fake, capture, {});
    await booting;
    await flush();
    return { fake, store };
  };

  it("Stop capture and update: stops, and asks for the install only once the engine is down", async () => {
    const { fake, store } = await booted({ status: ECaptureStatus.Capturing });
    store.updateNow();
    expect(fake.bridge.stop).toHaveBeenCalledTimes(1);
    expect(fake.bridge.updateRestart).not.toHaveBeenCalled();
    expect(store.getSnapshot().ui.updateAfterStop).toBe(true);
    // a second press while it waits does nothing more
    store.updateNow();
    expect(fake.bridge.stop).toHaveBeenCalledTimes(1);

    fake.push.state?.({ ...initialCaptureState, status: ECaptureStatus.Stopping, stopRequested: true });
    expect(fake.bridge.updateRestart).not.toHaveBeenCalled();
    fake.push.state?.({ ...initialCaptureState });
    expect(fake.bridge.updateRestart).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().ui.updateAfterStop).toBe(false);
    // and only once
    fake.push.state?.({ ...initialCaptureState });
    expect(fake.bridge.updateRestart).toHaveBeenCalledTimes(1);
  });

  it("with nothing running it installs at once; a refusal is said, and cleared by the next press", async () => {
    const { fake, store } = await booted({});
    fake.restartAnswer.value = { ok: false, reason: ERestartRefusal.Capturing };
    store.updateNow();
    expect(fake.bridge.stop).not.toHaveBeenCalled();
    expect(fake.bridge.updateRestart).toHaveBeenCalledTimes(1);
    await flush();
    expect(store.getSnapshot().ui.restartRefused).toBe(true);
    fake.restartAnswer.value = { ok: true };
    store.updateNow();
    expect(store.getSnapshot().ui.restartRefused).toBe(false);
  });

  it("Check for the fix: one at a time, and main's answer is the update shown", async () => {
    const { fake, store } = await booted({});
    store.checkForUpdate();
    store.checkForUpdate();
    expect(fake.bridge.updateCheckNow).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().ui.checking).toBe(true);
    fake.checkAnswer.resolve({ ...initialUpdateStatus, phase: EUpdatePhase.Checking });
    await flush();
    expect(store.getSnapshot().ui.checking).toBe(false);
    expect(store.getSnapshot().update?.phase).toBe(EUpdatePhase.Checking);
  });

  it("the driver install: one at a time, busy until it answers, then what happened and the probe again", async () => {
    const { fake, store } = await booted({ status: ECaptureStatus.Error });
    store.installNpcap();
    store.installNpcap();
    expect(fake.bridge.installNpcap).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().ui.npcapBusy).toBe(true);
    const setup = { ...SETUP, platform: "win32", access: ECaptureAccess.Ok };
    fake.npcapAnswer.resolve({
      setup,
      install: { outcome: ENpcapInstallOutcome.Installed, version: "1.80", detail: null },
    });
    await flush();
    expect(store.getSnapshot().ui).toMatchObject({
      npcapBusy: false,
      npcapAttempt: { install: { outcome: ENpcapInstallOutcome.Installed } },
    });
    expect(store.getSnapshot().setup).toEqual(setup);
  });

  it("the macOS fix keeps what happened and the probe that follows it; the link and the folder go to main", async () => {
    const { fake, store } = await booted({});
    store.fixMacPermissions();
    const result = {
      setup: { ...SETUP, access: ECaptureAccess.NoPermission },
      outcome: EPermissionFixOutcome.Cancelled,
      detail: null,
    };
    fake.fixAnswer.resolve(result);
    await flush();
    expect(store.getSnapshot().ui.fixAttempt).toEqual(result);
    expect(store.getSnapshot().setup?.access).toBe(ECaptureAccess.NoPermission);
    store.openNpcapPage();
    expect(fake.bridge.openNpcapPage).toHaveBeenCalledTimes(1);
    store.pickEnginePath();
    await flush();
    expect(store.getSnapshot().setup?.engineEntry).toBe("/picked/src/index.js");
  });

  it("Later answers the dialog's event in this window, once", async () => {
    const { store } = await booted({});
    store.dismissDialog("broken");
    store.dismissDialog("broken");
    store.dismissDialog("fix-ready:0.9.1");
    expect(store.getSnapshot().ui.dismissed).toEqual(["broken", "fix-ready:0.9.1"]);
  });
});

describe("the shell's router: the page lives in the hash", () => {
  it("reads #/session as Session", () => {
    expect(hrefOf("session")).toBe("#/session");
    expect(nextRoute("#/session", DEFAULT_ROUTE)).toBe("session");
  });

  it("ignores a hash that is not a route, so the skip link's #main leaves the page where it was", () => {
    expect(nextRoute("#main", "session")).toBe("session");
    expect(nextRoute("", "session")).toBe("session");
    // With Session the only page, "where it was" and the default coincide; a page of another name
    // tells the two apart, as the second page will.
    const elsewhere = "history" as TRoute;
    expect(nextRoute("#main", elsewhere)).toBe(elsewhere);
  });

  it("sends an unknown route to Session rather than to a blank page", () => {
    expect(nextRoute("#/history", "session")).toBe("session");
    expect(nextRoute("#/", "session")).toBe("session");
  });

  it("tells its subscribers only when the route changes", () => {
    let onHash: () => void = () => {};
    const source = {
      location: { hash: "" },
      addEventListener: (_type: "hashchange", listener: () => void) => {
        onHash = listener;
      },
    };
    const router = createRouter(source);
    const listener = vi.fn();
    router.subscribe(listener);
    expect(router.getSnapshot()).toBe("session");
    source.location.hash = "#main";
    onHash();
    source.location.hash = "#/session";
    onHash();
    expect(listener).not.toHaveBeenCalled();
    expect(router.getSnapshot()).toBe("session");
  });
});

describe("Session snapshot bridge", () => {
  it("keeps a pushed snapshot when the initial get arrives late", async () => {
    const h = fakeBridge();
    const store = createShellStore(h.bridge, h.focus);
    void store.boot();
    const latest = newSession("latest", 200);
    h.push.session?.(latest);
    h.answers.session.resolve(newSession("stale", 100));
    await Promise.resolve();
    expect(store.getSnapshot().session).toBe(latest);
  });
  it("refuses duplicate New session requests and preserves the pushed answer", async () => {
    const h = fakeBridge();
    const answer = deferred<TSession>();
    h.bridge.newSession.mockReturnValue(answer.promise);
    const store = createShellStore(h.bridge, h.focus);
    void store.boot();
    store.newSession();
    store.newSession();
    expect(h.bridge.newSession).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().ui.newSessionBusy).toBe(true);
    const next = newSession("next", 200);
    h.push.session?.(next);
    answer.resolve(next);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getSnapshot().session).toBe(next);
    expect(store.getSnapshot().ui.newSessionBusy).toBe(false);
  });
});
