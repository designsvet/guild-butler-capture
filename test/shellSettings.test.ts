import { describe, expect, it } from "vitest";

import {
  LANG_CHOICES,
  langChoiceLabel,
  langChoiceOf,
  moveActive,
  pathParts,
  placeMenu,
  storedLang,
  typeahead,
  updateLine,
} from "../src/app/settings.js";
import { EUpdatePhase, initialUpdateStatus, type TUpdateStatus } from "../src/shared/captureTypes.js";
import { SUPPORTED_LANGS } from "../src/shared/i18n.js";
import { stringsFor } from "../src/shared/strings.js";

/**
 * The settings drawer's words and its language menu's place (src/app/settings.ts; board Fh6,
 * option C), held without a window. How the drawer behaves in the page — the focus, the keys, the
 * fit at every width — is tools/shell-layout-check.cjs's.
 */

const en = stringsFor("en");
const uk = stringsFor("uk");
const status = (patch: Partial<TUpdateStatus>): TUpdateStatus => ({ ...initialUpdateStatus, ...patch });

describe("the drawer's language menu: its rows", () => {
  it("offers System first, then every language the app speaks, each once", () => {
    expect(LANG_CHOICES).toEqual(["system", ...SUPPORTED_LANGS]);
    expect(new Set(LANG_CHOICES).size).toBe(LANG_CHOICES.length);
  });

  it("names each language in itself, in every language, and only System in the app's", () => {
    expect(langChoiceLabel("uk", en)).toBe("Українська");
    expect(langChoiceLabel("uk", uk)).toBe("Українська");
    expect(langChoiceLabel("de", uk)).toBe("Deutsch");
    expect(langChoiceLabel("system", en)).toBe(en.settings.system);
    expect(langChoiceLabel("system", uk)).toBe(uk.settings.system);
  });

  it("reads the stored language as its row, and anything it does not speak as System, as it behaves", () => {
    expect(langChoiceOf("fr")).toBe("fr");
    expect(langChoiceOf(null)).toBe("system");
    expect(langChoiceOf(undefined)).toBe("system");
    expect(langChoiceOf("es")).toBe("system");
  });

  it("stores System as no language at all, so the app follows the OS again", () => {
    expect(storedLang("system")).toBeNull();
    expect(storedLang("pt")).toBe("pt");
  });
});

describe("the drawer's Updates row: the old gear popover's line", () => {
  it("says each phase in the app's own sentences", () => {
    expect(updateLine(status({ phase: EUpdatePhase.UpToDate }), false, en)).toBe("up to date");
    expect(updateLine(status({ phase: EUpdatePhase.Checking }), false, en)).toBe("checking…");
    expect(updateLine(status({ phase: EUpdatePhase.Off }), false, en)).toBe(en.settings.updateOff);
    expect(updateLine(status({ phase: EUpdatePhase.Downloading, version: "0.9.1", percent: 40 }), false, en)).toBe(
      "Downloading update v0.9.1… 40%",
    );
    expect(updateLine(status({ phase: EUpdatePhase.Ready, version: "0.9.1" }), false, en)).toBe(en.update.ready("0.9.1"));
    expect(updateLine(status({ phase: EUpdatePhase.Error, error: "timeout" }), false, en)).toBe(en.update.failed("timeout"));
  });

  it("says checking while a check this window asked for waits for main, whatever the last phase was", () => {
    expect(updateLine(status({ phase: EUpdatePhase.UpToDate }), true, en)).toBe("checking…");
    expect(updateLine(null, true, uk)).toBe(uk.settings.checking);
  });

  it("says nothing before the first status arrives, rather than guess up to date", () => {
    expect(updateLine(null, false, en)).toBeNull();
  });
});

describe("a folder's path, in the pieces it may break between", () => {
  it("ends each piece with its separator, on a Mac and on Windows, and joins back to the path", () => {
    const mac = "/Users/Bors/Library/Application Support/guild-butler-capture/captures";
    expect(pathParts(mac)).toEqual(["/", "Users/", "Bors/", "Library/", "Application Support/", "guild-butler-capture/", "captures"]);
    expect(pathParts(mac).join("")).toBe(mac);
    const win = "C:\\Users\\Bors\\AppData\\Roaming\\guild-butler-capture\\captures";
    expect(pathParts(win)).toEqual(["C:\\", "Users\\", "Bors\\", "AppData\\", "Roaming\\", "guild-butler-capture\\", "captures"]);
    expect(pathParts(win).join("")).toBe(win);
  });

  it("keeps a trailing separator, a path with none, and an empty one", () => {
    expect(pathParts("C:\\engine\\")).toEqual(["C:\\", "engine\\"]);
    expect(pathParts("engine")).toEqual(["engine"]);
    expect(pathParts("")).toEqual([""]);
  });
});

describe("where the language menu goes", () => {
  // the drawer at 768×620: under the title bar and its 16px inset, 440 wide at the right
  const drawer = { top: 64, bottom: 604, left: 312, right: 752 };
  const button = (top: number) => ({ top, bottom: top + 34, left: 507, width: 224 });

  it("opens below its button when it fits, the button's width, at its left", () => {
    expect(placeMenu({ trigger: button(150), menuHeight: 232, bounds: drawer })).toEqual({
      top: 188,
      left: 507,
      width: 224,
      maxHeight: null,
      up: false,
    });
  });

  it("opens above it when below is too short and above is roomier — the smallest window's case", () => {
    const at = placeMenu({ trigger: button(352), menuHeight: 232, bounds: drawer });
    expect(at).toMatchObject({ up: true, maxHeight: null });
    expect(at.top + 232).toBe(352 - 4);
    expect(at.top).toBeGreaterThanOrEqual(drawer.top + 8);
  });

  it("scrolls in the larger room when it fits neither, and never leaves the drawer", () => {
    const at = placeMenu({ trigger: button(300), menuHeight: 400, bounds: drawer });
    expect(at.maxHeight).not.toBeNull();
    expect(at.top).toBeGreaterThanOrEqual(drawer.top + 8);
    expect(at.top + (at.maxHeight ?? 0)).toBeLessThanOrEqual(drawer.bottom - 8);
  });

  it("stays inside the drawer sideways", () => {
    const at = placeMenu({ trigger: { top: 150, bottom: 184, left: 600, width: 224 }, menuHeight: 100, bounds: drawer });
    expect(at.left + at.width).toBeLessThanOrEqual(drawer.right - 8);
  });
});

describe("the language menu's keys", () => {
  it("move with the arrows, Home and End, and stop at the ends", () => {
    expect(moveActive("ArrowDown", 0, 7)).toBe(1);
    expect(moveActive("ArrowDown", 6, 7)).toBe(6);
    expect(moveActive("ArrowUp", 0, 7)).toBe(0);
    expect(moveActive("Home", 4, 7)).toBe(0);
    expect(moveActive("End", 1, 7)).toBe(6);
    expect(moveActive("Enter", 1, 7)).toBeNull();
    expect(moveActive("ArrowDown", 0, 0)).toBeNull();
  });

  it("jump to the next row a typed letter starts, wrapping, in any script", () => {
    const labels = LANG_CHOICES.map((choice) => langChoiceLabel(choice, en));
    // System, English, Українська, Русский, Deutsch, Français, Português
    expect(typeahead(labels, 0, "d")).toBe(4);
    expect(typeahead(labels, 0, "Р")).toBe(3);
    expect(typeahead(labels, 3, "у")).toBe(2);
    // pressed again it walks on, round to the top
    expect(typeahead(labels, 1, "s")).toBe(0);
    expect(typeahead(labels, 0, "x")).toBeNull();
    expect(typeahead(labels, 0, "Enter")).toBeNull();
    expect(typeahead(labels, 0, " ")).toBeNull();
  });
});
