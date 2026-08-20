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
  /** main → renderer. Full TCaptureState snapshot on every change. */
  stateChanged: "capture:state-changed",
} as const;

export const NPCAP_URL = "https://npcap.com/#download";
