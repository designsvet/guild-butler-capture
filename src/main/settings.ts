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
