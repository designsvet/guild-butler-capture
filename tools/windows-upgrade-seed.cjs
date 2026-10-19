"use strict";
// Native DPAPI fixture preparation, exclusively in disposable hosted Windows CI.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
fs.mkdirSync(input.cryptoProfile, { recursive: true });
app.setPath("userData", input.cryptoProfile);
app.whenReady().then(() => {
  assert.ok(safeStorage.isEncryptionAvailable(), "Windows credential encryption is unavailable");
  const encryptedPairing = safeStorage.encryptString(input.captureToken).toString("base64");
  const encryptedIdentity = safeStorage.encryptString(input.installationSecret).toString("base64");
  for (const directory of input.profiles) {
    fs.mkdirSync(path.join(directory, "captures"), { recursive: true });
    fs.writeFileSync(path.join(directory, "settings.json"), JSON.stringify({
      apiBase: input.apiBase, autoCapture: false, uploadEnabled: true, language: "de", theme: "parchment",
      telemetryEnabled: true, telemetryConsentChosen: true,
      pairing: { tokenEnc: encryptedPairing, guildId: "111111111111111111", userId: "222222222222222222", deviceId: 42, deviceName: "Disposable Windows acceptance", pairedAt: 1_700_000_000_000 },
    }, null, 2));
    fs.writeFileSync(path.join(directory, "desktop-identity.json"), JSON.stringify({ installationId: input.installationId, secretEnc: encryptedIdentity }));
    fs.writeFileSync(path.join(directory, "captures", "loot-events-upgrade-fixture.txt"), "Synthetic fixture. Preserve byte-for-byte; never upload.\n");
    assert.equal(safeStorage.decryptString(Buffer.from(encryptedPairing, "base64")), input.captureToken);
    assert.equal(safeStorage.decryptString(Buffer.from(encryptedIdentity, "base64")), input.installationSecret);
  }
  console.log("DPAPI fixtures encrypted and decrypted successfully.");
  app.exit(0);
}).catch((error) => { console.error(error.message); app.exit(1); });
