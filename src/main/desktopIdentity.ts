import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

export type TDesktopIdentity = { installationId: string; secret: string };
export type TDesktopCrypto = { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string; getSelectedStorageBackend?: () => string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Separate from pairing/settings so an update keeps identity and never changes Discord credentials. */
export const loadOrCreateDesktopIdentity = (file: string, crypto: TDesktopCrypto): TDesktopIdentity | null => {
  if (!crypto.isEncryptionAvailable() || crypto.getSelectedStorageBackend?.() === "basic_text") return null;
  try {
    let stored: { installationId?: unknown; secretEnc?: unknown };
    try { stored = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) {
      // A corrupt existing identity or unreadable file must not silently count a new installation.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      const identity = { installationId: randomUUID(), secret: randomBytes(32).toString("base64url") };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ installationId: identity.installationId, secretEnc: crypto.encryptString(identity.secret).toString("base64") }), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return identity;
    }
    if (typeof stored.installationId !== "string" || !UUID.test(stored.installationId) || typeof stored.secretEnc !== "string") return null;
    const secret = crypto.decryptString(Buffer.from(stored.secretEnc, "base64"));
    return /^[A-Za-z0-9_-]{43}$/.test(secret) ? { installationId: stored.installationId, secret } : null;
  } catch { return null; }
};
