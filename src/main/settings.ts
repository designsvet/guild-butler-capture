/**
 * App settings — one tiny JSON file in Electron's userData dir. Tolerant of
 * absence and corruption (a broken file means defaults, never a crash).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A paired device, as stored on disk (ADR 0092 P2 slice 4).
 *
 * `token` is the bearer credential for uploads and is written ENCRYPTED via
 * Electron's safeStorage (Keychain on macOS, DPAPI on Windows) — see
 * `pairingStore.ts`. It is never written in cleartext: where safeStorage is
 * unavailable the app says so and stays unpaired, rather than quietly leaving a
 * live token in a JSON file inside the user's home directory.
 *
 * guildId/userId are NOT secret — they are stored plainly so the UI can say
 * which account this computer is connected to without decrypting anything.
 */
export type TPairing = {
  /** base64 of the safeStorage-encrypted token. */
  tokenEnc: string;
  guildId: string;
  userId: string;
  deviceId: number;
  deviceName: string;
  pairedAt: number;
};

export type TSettings = {
  /** User-chosen engine folder (Advanced). Empty/absent = auto-discover. */
  enginePath?: string;
  /** Bot base URL override (Advanced) — staging points somewhere else. */
  apiBase?: string;
  /** Absent = not paired. */
  pairing?: TPairing;
  /** Auto-upload while capturing. Default ON (owner ruling, 2026-08-20). */
  uploadEnabled?: boolean;
  /**
   * Start capture as soon as the app opens. Default ON (owner ask,
   * 2026-08-29): the app exists to be forgotten about — open it, play. Read
   * as `!== false` at use sites so absence means on, like uploadEnabled.
   */
  autoCapture?: boolean;
  /** Language override (gear popover). Absent = follow the OS. */
  language?: string;
  /** Window look (gear popover). Absent = obsidian. */
  theme?: string;
  /** Which window opens: absent = the old one; "v5" = the shell preview. See `wantsV5Shell`. */
  shell?: typeof SHELL_V5;
};

/**
 * The v5 shell (Loot Butler, raid-bot ADR 0159) is built beside the old window and is reached
 * only on purpose: `GBC_SHELL=v5` in the environment, or `"shell": "v5"` in settings.json. Any
 * other value — absent, misspelt, a name a later build will use — opens the old window, so a
 * stray value can never strand a member on a half-built screen. The old window stays the default
 * until the first beta.
 */
export const SHELL_V5 = "v5";

export const wantsV5Shell = (env: Readonly<Record<string, string | undefined>>, settings: TSettings): boolean => {
  return env.GBC_SHELL === SHELL_V5 || settings.shell === SHELL_V5;
};

/**
 * The gear's two picks, as written back to disk. Pure, so the test can hold what the IPC
 * handlers rely on: every field the pick does not touch rides along — the pairing, the engine
 * path, and the shell flag, which a whole-file rewrite would otherwise be one forgotten field
 * away from dropping.
 */
export const withTheme = (settings: TSettings, theme: string): TSettings => {
  return { ...settings, theme };
};

/** A language overrides the OS; null ("System", or anything unrecognised) drops the override. */
export const withLanguage = (settings: TSettings, language: string | null): TSettings => {
  const next: TSettings = { ...settings };
  if (language == null) {
    delete next.language;
  } else {
    next.language = language;
  }
  return next;
};

/**
 * Read a stored pairing, or nothing.
 *
 * All-or-nothing on purpose: a half-written record would render as "connected"
 * in the UI while being unusable for upload, which is the most confusing state
 * available. A dropped record just shows Pair with Discord again.
 */
const readPairing = (value: unknown): TPairing | undefined => {
  if (typeof value !== "object" || value == null) {
    return undefined;
  }
  const p = value as Record<string, unknown>;
  if (
    typeof p.tokenEnc !== "string" ||
    p.tokenEnc.length === 0 ||
    typeof p.guildId !== "string" ||
    typeof p.userId !== "string" ||
    typeof p.deviceName !== "string"
  ) {
    return undefined;
  }
  return {
    tokenEnc: p.tokenEnc,
    guildId: p.guildId,
    userId: p.userId,
    deviceId: typeof p.deviceId === "number" ? p.deviceId : 0,
    deviceName: p.deviceName,
    pairedAt: typeof p.pairedAt === "number" ? p.pairedAt : 0,
  };
};

export const settingsFilePath = (userDataDir: string): string => {
  return join(userDataDir, "settings.json");
};

export const loadSettings = (file: string): TSettings => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed == null) {
      return {};
    }
    const raw = parsed as Record<string, unknown>;
    const out: TSettings = {};
    if (typeof raw.enginePath === "string" && raw.enginePath.trim().length > 0) {
      out.enginePath = raw.enginePath;
    }
    if (typeof raw.apiBase === "string" && raw.apiBase.trim().length > 0) {
      out.apiBase = raw.apiBase.trim();
    }
    if (typeof raw.uploadEnabled === "boolean") {
      out.uploadEnabled = raw.uploadEnabled;
    }
    if (typeof raw.autoCapture === "boolean") {
      out.autoCapture = raw.autoCapture;
    }
    // Narrowed by the shared validators at the read sites; here only the
    // string survives — a number or object is corruption, not a choice.
    if (typeof raw.language === "string" && raw.language.length > 0) {
      out.language = raw.language;
    }
    if (typeof raw.theme === "string" && raw.theme.length > 0) {
      out.theme = raw.theme;
    }
    // Whitelisted, not merely a string: this file is read whole and written back whole, so only
    // a value this build knows survives the round trip.
    if (raw.shell === SHELL_V5) {
      out.shell = SHELL_V5;
    }
    const pairing = readPairing(raw.pairing);
    if (pairing != null) {
      out.pairing = pairing;
    }
    return out;
  } catch {
    return {};
  }
};

export const saveSettings = (file: string, settings: TSettings): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
};
