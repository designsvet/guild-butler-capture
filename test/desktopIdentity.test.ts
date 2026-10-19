import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateDesktopIdentity } from "../src/main/desktopIdentity.js";

const crypto = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")), decryptString: (value: Buffer) => value.toString().split("").reverse().join("") };

describe("desktop installation identity", () => {
  it("survives relaunch and stores an encrypted credential in its own file", () => {
    const dir = mkdtempSync(join(tmpdir(), "desktop-identity-"));
    try {
      const file = join(dir, "desktop-identity.json");
      const identity = loadOrCreateDesktopIdentity(file, crypto)!;
      expect(identity.installationId).toMatch(/^[0-9a-f-]{36}$/); expect(identity.secret).toHaveLength(43);
      expect(readFileSync(file, "utf8")).not.toContain(identity.secret);
      expect(loadOrCreateDesktopIdentity(file, crypto)).toEqual(identity);
      writeFileSync(file, "corrupt");
      expect(loadOrCreateDesktopIdentity(file, crypto)).toBeNull();
      expect(readFileSync(file, "utf8")).toBe("corrupt");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("refuses unavailable encryption and Linux basic_text", () => {
    expect(loadOrCreateDesktopIdentity("/not-used", { ...crypto, isEncryptionAvailable: () => false })).toBeNull();
    expect(loadOrCreateDesktopIdentity("/not-used", { ...crypto, getSelectedStorageBackend: () => "basic_text" })).toBeNull();
  });
});
