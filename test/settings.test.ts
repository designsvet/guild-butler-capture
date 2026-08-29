import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSettings, saveSettings, settingsFilePath } from "../src/main/settings.js";

describe("settings: autoCapture", () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), "gbc-settings-"));

  it("absent means ON at the read site (the `!== false` convention)", () => {
    const file = settingsFilePath(dir());
    const loaded = loadSettings(file); // no file at all
    expect(loaded.autoCapture).toBeUndefined();
    expect(loaded.autoCapture !== false).toBe(true);
  });

  it("a persisted OFF survives a round-trip", () => {
    const file = settingsFilePath(dir());
    saveSettings(file, { autoCapture: false });
    expect(loadSettings(file).autoCapture).toBe(false);
    expect(loadSettings(file).autoCapture !== false).toBe(false);
  });

  it("a corrupt value is dropped rather than trusted", () => {
    const file = settingsFilePath(dir());
    writeFileSync(file, JSON.stringify({ autoCapture: "yes" }), "utf8");
    expect(loadSettings(file).autoCapture).toBeUndefined();
  });
});

describe("settings: language + theme", () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), "gbc-settings-"));

  it("round-trips a stored override and theme", () => {
    const file = settingsFilePath(dir());
    saveSettings(file, { language: "uk", theme: "parchment" });
    const loaded = loadSettings(file);
    expect(loaded.language).toBe("uk");
    expect(loaded.theme).toBe("parchment");
  });

  it("drops corrupt values rather than trusting them", () => {
    const file = settingsFilePath(dir());
    writeFileSync(file, JSON.stringify({ language: 7, theme: { deep: true } }), "utf8");
    const loaded = loadSettings(file);
    expect(loaded.language).toBeUndefined();
    expect(loaded.theme).toBeUndefined();
  });

  it("absence means follow-the-OS and obsidian at the read sites", () => {
    const file = settingsFilePath(dir());
    const loaded = loadSettings(file);
    expect(loaded.language).toBeUndefined();
    expect(loaded.theme).toBeUndefined();
  });
});
