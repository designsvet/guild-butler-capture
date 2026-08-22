/**
 * Keeping the device token safe on disk (ADR 0092 P2 slice 4).
 *
 * The token is a bearer credential: anything holding it can upload as this
 * member. It is written through Electron's `safeStorage` — Keychain on macOS,
 * DPAPI on Windows — so a copy of `settings.json` on its own is useless.
 *
 * The rule that shapes this module: **where encryption is unavailable, the app
 * stays unpaired and says so.** The tempting fallback is to write the token in
 * cleartext "just this once"; that turns a documented guarantee into a lie
 * nobody can see, on the machines least able to protect the file. A refusal the
 * member can read is strictly better than a silent downgrade.
 *
 * `safeStorage` is injected rather than imported so every branch — including
 * the unavailable one, which is the whole point — is testable without Electron.
 */

import type { TPairing } from "./settings.js";

export type TSafeStorage = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

export enum EStoreOutcome {
  Stored = "stored",
  /** The OS keychain/DPAPI is not usable here — we refuse rather than downgrade. */
  NoEncryption = "no-encryption",
  /** Encryption threw. Rare, and still not a reason to write plaintext. */
  Failed = "failed",
}

export type TStoreResult =
  | { outcome: EStoreOutcome.Stored; pairing: TPairing }
  | { outcome: Exclude<EStoreOutcome, EStoreOutcome.Stored>; detail: string | null };

export type TNewPairing = {
  token: string;
  guildId: string;
  userId: string;
  deviceId: number;
  deviceName: string;
};

export const encryptPairing = (safe: TSafeStorage, input: TNewPairing, now: number): TStoreResult => {
  if (!safe.isEncryptionAvailable()) {
    return { outcome: EStoreOutcome.NoEncryption, detail: null };
  }
  try {
    const tokenEnc = safe.encryptString(input.token).toString("base64");
    return {
      outcome: EStoreOutcome.Stored,
      pairing: {
        tokenEnc,
        guildId: input.guildId,
        userId: input.userId,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        pairedAt: now,
      },
    };
  } catch (err) {
    return { outcome: EStoreOutcome.Failed, detail: err instanceof Error ? err.message : null };
  }
};

/**
 * Recover the token for an upload.
 *
 * Returns null rather than throwing on every failure path, because the callers
 * are a background uploader and a status render — neither has anywhere useful
 * to put an exception. A null here means "treat this device as unpaired", which
 * is the safe reading: the member is shown Pair with Discord again.
 *
 * Decryption genuinely can fail on a machine that has been restored from
 * backup or had its keychain reset, so this is a real path, not defensive
 * padding.
 */
export const decryptToken = (safe: TSafeStorage, pairing: TPairing | undefined): string | null => {
  if (pairing == null || !safe.isEncryptionAvailable()) {
    return null;
  }
  try {
    const token = safe.decryptString(Buffer.from(pairing.tokenEnc, "base64"));
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
};
