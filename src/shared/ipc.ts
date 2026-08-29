/**
 * IPC channel names — one constant per channel so main, preload and renderer
 * can never drift on a string. Platform-pure (see captureTypes.ts).
 */

export const IPC = {
  /** invoke → void. Resolve the engine, start the supervisor. */
  captureStart: "capture:start",
  /** invoke → void. Graceful stop (SIGINT, escalating). */
  captureStop: "capture:stop",
  /** invoke → TCaptureState. */
  captureGetState: "capture:get-state",
  /** invoke → boolean. Reveal the current log file in Finder / Explorer. */
  captureReveal: "capture:reveal",
  /** invoke → TSetupStatus. Re-probes engine + permissions. */
  setupGet: "setup:get",
  /** invoke → TSetupStatus. macOS: run the one-time admin helper install, then re-probe. */
  setupFixMacPermissions: "setup:fix-mac-permissions",
  /** invoke → TNpcapFixResult. Windows: fetch + verify + run Npcap's own installer. */
  setupInstallNpcap: "setup:install-npcap",
  /** invoke → void. Open the official Npcap download page in the browser. */
  setupOpenNpcapPage: "setup:open-npcap-page",
  /** invoke → TSetupStatus. Directory picker for the engine folder (Advanced). */
  setupPickEnginePath: "setup:pick-engine-path",
  /** invoke → TPairingStatus. Who this computer is connected to, if anyone. */
  pairingGet: "pairing:get",
  /** invoke(code) → TPairAttempt. Trade a Discord pairing code for a device token. */
  pairingPair: "pairing:pair",
  /** invoke → TPairingStatus. Forget the token on THIS computer (the server keeps the row). */
  pairingUnpair: "pairing:unpair",
  /** invoke(enabled) → TPairingStatus. Auto-upload on/off. */
  pairingSetUpload: "pairing:set-upload",
  /** invoke → void. Open the member's loot page in the browser. */
  pairingOpenLoot: "pairing:open-loot",
  /** main → renderer. Full TCaptureState snapshot on every change. */
  stateChanged: "capture:state-changed",
  /** main → renderer. Upload status changed (paired, sent, retrying…). */
  pairingChanged: "pairing:changed",
  /** invoke → TUpdateStatus. Auto-update state (Windows only for now). */
  updateGet: "update:get",
  /** invoke → TRestartResult. Install the downloaded update now — refused while capturing. */
  updateRestart: "update:restart",
  /** main → renderer. TUpdateStatus on every change. */
  updateChanged: "update:changed",
  /** invoke → TAppSettings. The renderer-visible settings (auto-capture, language, theme). */
  settingsGet: "settings:get",
  /** invoke(enabled) → TAppSettings. Persist the auto-capture toggle. */
  settingsSetAutoCapture: "settings:set-auto-capture",
  /** invoke(lang|null) → TAppSettings. Persist the language override; null = follow the OS. */
  settingsSetLanguage: "settings:set-language",
  /** invoke(theme) → TAppSettings. Persist the window look (obsidian/parchment). */
  settingsSetTheme: "settings:set-theme",
  /** invoke → TUpdateStatus. Manual "Check for updates"; where auto-update is off it opens the download page. */
  updateCheck: "update:check",
  /** invoke(text) → void. Copy a short string to the OS clipboard (the /capture pair chip). */
  appCopyText: "app:copy-text",
} as const;

export const NPCAP_URL = "https://npcap.com/#download";

/** The Discord command the pairing card offers to copy — never localized. */
export const PAIR_COMMAND = "/capture pair";
