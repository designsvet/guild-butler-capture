/**
 * The shell's store: a mirror of what the main process says, through the preload bridge
 * (`window.gbc`, typed in src/shared/bridge.ts). It holds no state of its own — every value is the
 * last snapshot main sent — and React reads it through `useSyncExternalStore`.
 *
 * Boot is the old window's, in one place: the five `get*` calls go out, then the three `on*`
 * subscriptions are made, before any answer is back. A push that lands while the gets are in
 * flight is newer than their answer, so once a slice has been pushed its get's answer is dropped.
 * The setup is probed again whenever the window gets focus (the member may have just installed
 * Npcap, or finished the macOS permission fix), as the old window does.
 *
 * Auto-start is the old window's too: once per window, after the first state and the settings,
 * only when they ask for it and only over an idle capture — a window reopened over a running one
 * starts nothing. Without it, the Capture card's switch would do nothing here.
 *
 * Pure of the DOM (the window arrives as `TFocusSource`), so test/shellStore.test.ts drives it with
 * a fake bridge.
 */

import {
  ECaptureStatus,
  type TAppSettings,
  type TCaptureState,
  type TPairingStatus,
  type TSetupStatus,
  type TUpdateStatus,
} from "../shared/captureTypes.js";
import type { TGbc } from "../shared/bridge.js";

export type TShellSnapshot = {
  capture: TCaptureState | null;
  setup: TSetupStatus | null;
  pairing: TPairingStatus | null;
  update: TUpdateStatus | null;
  settings: TAppSettings | null;
};

export type TFocusSource = {
  addEventListener: (type: "focus", listener: () => void) => void;
};

export type TShellStore = {
  getSnapshot: () => TShellSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Once, from main.tsx. Resolves when the first answers are in (and auto-start has had its say). */
  boot: () => Promise<void>;
  start: () => void;
  stop: () => void;
  reveal: () => void;
  setAutoCapture: (enabled: boolean) => void;
};

const EMPTY: TShellSnapshot = { capture: null, setup: null, pairing: null, update: null, settings: null };

/** A bridge call that failed leaves its slice as it was; the app log on main's side has the why. */
const quietly = (promise: Promise<unknown>): void => {
  promise.catch((error: unknown) => {
    console.error("[shell] bridge call failed", error);
  });
};

export const createShellStore = (bridge: TGbc, focus: TFocusSource): TShellStore => {
  let snapshot = EMPTY;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<TShellSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      listener();
    }
  };
  const pushed = { capture: false, pairing: false, update: false };
  let booted = false;

  const refreshSetup = (): void => {
    quietly(bridge.getSetup().then((setup) => set({ setup })));
  };

  const boot = async (): Promise<void> => {
    if (booted) {
      return;
    }
    booted = true;
    const state = bridge.getState();
    const setup = bridge.getSetup();
    const pairing = bridge.getPairing();
    const update = bridge.getUpdate();
    const settings = bridge.getSettings();

    bridge.onState((capture) => {
      pushed.capture = true;
      set({ capture });
    });
    bridge.onPairing((next) => {
      pushed.pairing = true;
      set({ pairing: next });
    });
    bridge.onUpdate((next) => {
      pushed.update = true;
      set({ update: next });
    });
    focus.addEventListener("focus", refreshSetup);

    const firstState = state.then((capture) => {
      if (!pushed.capture) {
        set({ capture });
      }
    });
    quietly(setup.then((next) => set({ setup: next })));
    quietly(
      pairing.then((next) => {
        if (!pushed.pairing) {
          set({ pairing: next });
        }
      }),
    );
    quietly(
      update.then((next) => {
        if (!pushed.update) {
          set({ update: next });
        }
      }),
    );
    const firstSettings = settings.then((next) => set({ settings: next }));

    try {
      await Promise.all([firstState, firstSettings]);
    } catch (error) {
      console.error("[shell] boot: the state or the settings did not arrive", error);
      return;
    }
    // Once per window: boot runs once.
    if (snapshot.settings?.autoCapture === true && snapshot.capture?.status === ECaptureStatus.Idle) {
      quietly(bridge.start());
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    boot,
    start: () => {
      quietly(bridge.start());
    },
    stop: () => {
      quietly(bridge.stop());
    },
    reveal: () => {
      quietly(bridge.reveal());
    },
    setAutoCapture: (enabled) => {
      // Drawn at once, then whatever main stored.
      if (snapshot.settings != null) {
        set({ settings: { ...snapshot.settings, autoCapture: enabled } });
      }
      quietly(bridge.setAutoCapture(enabled).then((settings) => set({ settings })));
    },
  };
};
