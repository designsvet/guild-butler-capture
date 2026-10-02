/**
 * The preload bridge as the pages see it: `window.gbc`, typed. The preload (src/preload/index.cts)
 * builds it with its answers typed `unknown`, because it cannot import anything (it runs
 * sandboxed); this is the same shape with each answer named, for the two pages that read it — the
 * old window (src/renderer/renderer.ts) and the v5 shell (src/app).
 *
 * Types only, on purpose: both pages `import type` it, which the compiler erases, so moving the
 * type here left the old renderer's emitted JavaScript exactly as it was.
 */

import type {
  TAppSettings,
  TCaptureState,
  TNpcapFixResult,
  TPairAttempt,
  TPairingStatus,
  TPermissionFixResult,
  TRestartResult,
  TSetupStatus,
  TUpdateStatus,
} from "./captureTypes.js";

import type { TSession } from "./session/model.js";

export type TGbc = {
  getSession: () => Promise<TSession | null>;
  newSession: () => Promise<TSession>;
  onSession: (listener: (session: TSession) => void) => () => void;
  platform: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => Promise<TCaptureState>;
  reveal: () => Promise<boolean>;
  getSetup: () => Promise<TSetupStatus>;
  fixMacPermissions: () => Promise<TPermissionFixResult>;
  installNpcap: () => Promise<TNpcapFixResult>;
  openNpcapPage: () => Promise<void>;
  pickEnginePath: () => Promise<TSetupStatus>;
  onState: (listener: (state: TCaptureState) => void) => () => void;
  getPairing: () => Promise<TPairingStatus>;
  pair: (code: string) => Promise<TPairAttempt>;
  unpair: () => Promise<TPairingStatus>;
  setUpload: (enabled: boolean) => Promise<TPairingStatus>;
  openLoot: () => Promise<void>;
  openPrivacy: () => Promise<void>;
  onPairing: (listener: (status: TPairingStatus) => void) => () => void;
  getUpdate: () => Promise<TUpdateStatus>;
  updateRestart: () => Promise<TRestartResult>;
  onUpdate: (listener: (status: TUpdateStatus) => void) => () => void;
  getSettings: () => Promise<TAppSettings>;
  setAutoCapture: (enabled: boolean) => Promise<TAppSettings>;
  setLanguage: (lang: string | null) => Promise<TAppSettings>;
  setTheme: (theme: string) => Promise<TAppSettings>;
  updateCheckNow: () => Promise<TUpdateStatus>;
  copyText: (text: string) => Promise<void>;
};
