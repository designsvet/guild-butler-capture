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
 * The notices' buttons (src/app/Notice.tsx) are here too, with the little the page must remember
 * about them that main does not: a fix attempt's outcome, for the sentence under the fix (the old
 * window's notes); the Npcap install and an update check while they run, so their buttons refuse a
 * second press; "Stop capture and update" — the old window's flow: stop, and once the engine is down
 * ask main to install (it refuses while a capture runs), saying so if it still refuses; and the
 * broken decoder's dialog events this window has answered "Later" to (src/shared/notices.ts).
 *
 * Pure of the DOM (the window arrives as `TFocusSource`), so test/shellStore.test.ts drives it with
 * a fake bridge.
 */

import {
  ECaptureStatus,
  type TAppSettings,
  type TCaptureState,
  type TNpcapFixResult,
  type TPairingStatus,
  type TPermissionFixResult,
  type TSetupStatus,
  type TUpdateStatus,
} from "../shared/captureTypes.js";
import type { TGbc } from "../shared/bridge.js";
import { engineRunning } from "../shared/engineHealth.js";

/** What the page remembers about the notices' buttons — nothing main keeps for it. */
export type TShellUi = {
  /** The last "Fix capture permissions…": what happened (its sentence sits under the fix). */
  fixAttempt: TPermissionFixResult | null;
  /** The last "Install capture driver": what happened. */
  npcapAttempt: TNpcapFixResult | null;
  /** The install is running: its button refuses, and the note says it is fetching. */
  npcapBusy: boolean;
  /** "Check for the fix" / "Get the update" is waiting for main's answer. */
  checking: boolean;
  /** "Stop capture and update" was pressed: the install waits for the engine to be down. */
  updateAfterStop: boolean;
  /** Main refused the install (a capture was still running); the notice says so. */
  restartRefused: boolean;
  /** The broken decoder's dialog events answered "Later" in this window (notices.ts). */
  dismissed: readonly string[];
};

export type TShellSnapshot = {
  capture: TCaptureState | null;
  setup: TSetupStatus | null;
  pairing: TPairingStatus | null;
  update: TUpdateStatus | null;
  settings: TAppSettings | null;
  ui: TShellUi;
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
  /** macOS: the one-time admin helper, then the probe again (the old window's Fix capture permissions…). */
  fixMacPermissions: () => void;
  /** Windows: fetch, verify and start Npcap's own installer. One at a time. */
  installNpcap: () => void;
  /** Windows: the Npcap download page, in the browser. */
  openNpcapPage: () => void;
  /** The engine folder picker. */
  pickEnginePath: () => void;
  /** "Check for the fix" / "Get the update": where the app cannot update itself, main opens the download page. */
  checkForUpdate: () => void;
  /** "Stop capture and update" / "Update now" / "Restart and update": stop first if the logger runs, then install. */
  updateNow: () => void;
  /** "Later" on the broken decoder's dialog: this event is answered, the notice stays. */
  dismissDialog: (event: string) => void;
};

export const INITIAL_UI: TShellUi = {
  fixAttempt: null,
  npcapAttempt: null,
  npcapBusy: false,
  checking: false,
  updateAfterStop: false,
  restartRefused: false,
  dismissed: [],
};

const EMPTY: TShellSnapshot = { capture: null, setup: null, pairing: null, update: null, settings: null, ui: INITIAL_UI };

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
  const setUi = (patch: Partial<TShellUi>): void => {
    set({ ui: { ...snapshot.ui, ...patch } });
  };

  /**
   * "Stop capture and update", once the engine is down: main refuses to cut a live capture, so the
   * install is asked for only then — on the press when nothing runs, else on the state push that
   * says it stopped (the old window's maybeUpdateAfterStop). An answer of ok never arrives: the app
   * is quitting into the new version.
   */
  const maybeUpdateAfterStop = (): void => {
    const capture = snapshot.capture;
    if (!snapshot.ui.updateAfterStop || capture == null || engineRunning(capture.status)) {
      return;
    }
    setUi({ updateAfterStop: false });
    quietly(
      bridge.updateRestart().then((result) => {
        if (!result.ok) {
          setUi({ restartRefused: true });
        }
      }),
    );
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
      maybeUpdateAfterStop();
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
    fixMacPermissions: () => {
      quietly(
        bridge.fixMacPermissions().then((result) => {
          set({ setup: result.setup, ui: { ...snapshot.ui, fixAttempt: result } });
        }),
      );
    },
    installNpcap: () => {
      if (snapshot.ui.npcapBusy) {
        return;
      }
      setUi({ npcapBusy: true });
      quietly(
        bridge
          .installNpcap()
          .then((result) => {
            set({ setup: result.setup, ui: { ...snapshot.ui, npcapAttempt: result } });
          })
          .finally(() => {
            setUi({ npcapBusy: false });
          }),
      );
    },
    openNpcapPage: () => {
      quietly(bridge.openNpcapPage());
    },
    pickEnginePath: () => {
      quietly(bridge.pickEnginePath().then((setup) => set({ setup })));
    },
    checkForUpdate: () => {
      if (snapshot.ui.checking) {
        return;
      }
      setUi({ checking: true });
      quietly(
        bridge
          .updateCheckNow()
          .then((update) => set({ update }))
          .finally(() => {
            setUi({ checking: false });
          }),
      );
    },
    updateNow: () => {
      if (snapshot.ui.updateAfterStop) {
        return;
      }
      setUi({ updateAfterStop: true, restartRefused: false });
      const capture = snapshot.capture;
      if (capture != null && engineRunning(capture.status)) {
        quietly(bridge.stop());
        return;
      }
      maybeUpdateAfterStop();
    },
    dismissDialog: (event) => {
      if (!snapshot.ui.dismissed.includes(event)) {
        setUi({ dismissed: [...snapshot.ui.dismissed, event] });
      }
    },
  };
};
