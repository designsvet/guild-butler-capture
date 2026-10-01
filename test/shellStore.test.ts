import { describe, expect, it, vi } from "vitest";

import { createRouter, DEFAULT_ROUTE, hrefOf, nextRoute, type TRoute } from "../src/app/router.js";
import { createShellStore } from "../src/app/store.js";
import type { TGbc } from "../src/shared/bridge.js";
import {
  ECaptureStatus,
  initialCaptureState,
  initialPairingStatus,
  initialUpdateStatus,
  type TAppSettings,
  type TCaptureState,
  type TPairingStatus,
  type TSetupStatus,
  type TUpdateStatus,
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
    state: deferred<TCaptureState>(),
    setup: deferred<TSetupStatus>(),
    pairing: deferred<TPairingStatus>(),
    update: deferred<TUpdateStatus>(),
    settings: deferred<TAppSettings>(),
  };
  const push: {
    state?: (s: TCaptureState) => void;
    pairing?: (s: TPairingStatus) => void;
    update?: (s: TUpdateStatus) => void;
  } = {};
  const settings = (patch: Partial<TAppSettings>): TAppSettings => ({ autoCapture: false, language: null, theme: "obsidian", ...patch });
  const bridge = {
    platform: "darwin",
    getState: () => (calls.push("getState"), answers.state.promise),
    getSetup: () => (calls.push("getSetup"), calls.filter((c) => c === "getSetup").length === 1 ? answers.setup.promise : Promise.resolve(SETUP)),
    getPairing: () => (calls.push("getPairing"), answers.pairing.promise),
    getUpdate: () => (calls.push("getUpdate"), answers.update.promise),
    getSettings: () => (calls.push("getSettings"), answers.settings.promise),
    onState: (listener: (s: TCaptureState) => void) => (calls.push("onState"), (push.state = listener), () => {}),
    onPairing: (listener: (s: TPairingStatus) => void) => (calls.push("onPairing"), (push.pairing = listener), () => {}),
    onUpdate: (listener: (s: TUpdateStatus) => void) => (calls.push("onUpdate"), (push.update = listener), () => {}),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    reveal: vi.fn(() => Promise.resolve(true)),
    setAutoCapture: vi.fn((enabled: boolean) => Promise.resolve(settings({ autoCapture: enabled }))),
  } as unknown as TGbc & { start: ReturnType<typeof vi.fn>; setAutoCapture: ReturnType<typeof vi.fn> };
  let onFocus: () => void = () => {};
  const focus = {
    addEventListener: (_type: "focus", listener: () => void) => {
      calls.push("focus listener");
      onFocus = listener;
    },
  };
  return { bridge, focus, calls, answers, push, settings, focusWindow: () => onFocus() };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

const answerAll = (fake: ReturnType<typeof fakeBridge>, capture: Partial<TCaptureState>, settings: Partial<TAppSettings>) => {
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
