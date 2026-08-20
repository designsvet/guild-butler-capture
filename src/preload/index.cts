/**
 * Preload bridge — the ONLY code that touches both worlds.
 *
 * Deliberately self-contained (no relative imports): that is what lets the
 * renderer run with `sandbox: true`, where a preload cannot require anything
 * beyond the electron shim. The channel names are therefore literals here;
 * `test/preloadChannels.test.ts` pins them to `src/shared/ipc.ts` so the two
 * can never drift.
 */

import { contextBridge, ipcRenderer } from "electron";

const CH = {
  captureStart: "capture:start",
  captureStop: "capture:stop",
  captureGetState: "capture:get-state",
  captureReveal: "capture:reveal",
  setupGet: "setup:get",
  setupFixMacPermissions: "setup:fix-mac-permissions",
  setupOpenNpcapPage: "setup:open-npcap-page",
  setupPickEnginePath: "setup:pick-engine-path",
  stateChanged: "capture:state-changed",
} as const;

export type TGbcBridge = {
  platform: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => Promise<unknown>;
  reveal: () => Promise<boolean>;
  getSetup: () => Promise<unknown>;
  fixMacPermissions: () => Promise<unknown>;
  openNpcapPage: () => Promise<void>;
  pickEnginePath: () => Promise<unknown>;
  onState: (listener: (state: unknown) => void) => () => void;
};

const bridge: TGbcBridge = {
  platform: process.platform,
  start: () => ipcRenderer.invoke(CH.captureStart) as Promise<void>,
  stop: () => ipcRenderer.invoke(CH.captureStop) as Promise<void>,
  getState: () => ipcRenderer.invoke(CH.captureGetState),
  reveal: () => ipcRenderer.invoke(CH.captureReveal) as Promise<boolean>,
  getSetup: () => ipcRenderer.invoke(CH.setupGet),
  fixMacPermissions: () => ipcRenderer.invoke(CH.setupFixMacPermissions),
  openNpcapPage: () => ipcRenderer.invoke(CH.setupOpenNpcapPage) as Promise<void>,
  pickEnginePath: () => ipcRenderer.invoke(CH.setupPickEnginePath),
  onState: (listener) => {
    const wrapped = (_event: unknown, state: unknown): void => {
      listener(state);
    };
    ipcRenderer.on(CH.stateChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(CH.stateChanged, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("gbc", bridge);

export const PRELOAD_CHANNELS = CH;
