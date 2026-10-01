import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadSettings,
  saveSettings,
  settingsFilePath,
  wantsV5Shell,
  withLanguage,
  withTheme,
} from "../src/main/settings.js";

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

describe("settings: the v5 shell flag", () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), "gbc-settings-"));

  it("opens the old window unless the env or the stored setting asks for v5", () => {
    expect(wantsV5Shell({}, {})).toBe(false);
    expect(wantsV5Shell({ GBC_SHELL: "v5" }, {})).toBe(true);
    expect(wantsV5Shell({}, { shell: "v5" })).toBe(true);
    // anything else is the old window: a typo must not strand a member on a half-built screen
    expect(wantsV5Shell({ GBC_SHELL: "V5" }, {})).toBe(false);
    expect(wantsV5Shell({ GBC_SHELL: "1" }, {})).toBe(false);
  });

  it("keeps only a value this build knows", () => {
    const file = settingsFilePath(dir());
    writeFileSync(file, JSON.stringify({ shell: "v6" }), "utf8");
    expect(loadSettings(file).shell).toBeUndefined();
    writeFileSync(file, JSON.stringify({ shell: true }), "utf8");
    expect(loadSettings(file).shell).toBeUndefined();
    writeFileSync(file, JSON.stringify({ shell: "v5" }), "utf8");
    expect(loadSettings(file).shell).toBe("v5");
  });

  // The IPC handlers read the file whole and write it back whole (src/main/index.ts), through
  // these two updaters — so a flag the reader dropped, or an updater that rebuilt the object,
  // would switch the shell off the first time a member picked a theme or a language.
  it("survives a theme change and both kinds of language change", () => {
    const file = settingsFilePath(dir());
    saveSettings(file, { shell: "v5", autoCapture: false, language: "de" });

    saveSettings(file, withTheme(loadSettings(file), "parchment"));
    expect(loadSettings(file)).toEqual({ shell: "v5", autoCapture: false, language: "de", theme: "parchment" });

    saveSettings(file, withLanguage(loadSettings(file), "uk"));
    expect(loadSettings(file)).toEqual({ shell: "v5", autoCapture: false, language: "uk", theme: "parchment" });

    saveSettings(file, withLanguage(loadSettings(file), null));
    expect(loadSettings(file)).toEqual({ shell: "v5", autoCapture: false, theme: "parchment" });
    expect(wantsV5Shell({}, loadSettings(file))).toBe(true);
  });
});
