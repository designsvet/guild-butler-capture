import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import type { TTheme } from "../src/shared/captureTypes.js";
import { MIN_WINDOW, TITLE_BAR_HEIGHT, type TWindowState } from "../src/main/windowBounds.js";
import {
  isOwnPage,
  MAC_LIGHT,
  overlayFor,
  SHELL_TRAFFIC_LIGHTS,
  shellOverlayFor,
  windowOptions,
} from "../src/main/windowOptions.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const require = createRequire(import.meta.url);

const PLATFORMS = ["darwin", "win32", "linux"] as const;
const THEMES: readonly TTheme[] = ["obsidian", "parchment"];
const PRELOAD = "/APP/dist/preload/index.cjs";

/** The pre-paint ground exactly as index.ts writes it (the line test/designSystem.test.ts pins). */
const INDEX = read("src/main/index.ts");
const GROUND = /backgroundColor: theme === "parchment" \? "(#[0-9a-fA-F]+)" : "(#[0-9a-fA-F]+)"/.exec(INDEX);
const groundFor = (theme: TTheme): string => {
  const value = theme === "parchment" ? GROUND?.[1] : GROUND?.[2];
  if (value === undefined) {
    throw new Error("index.ts no longer writes the window's ground as one theme ternary");
  }
  return value;
};

/**
 * What 0.8.8 (bf8a49d) passes to `new BrowserWindow`, as JSON — produced by evaluating that
 * commit's own object literal (and its overlayFor) for each platform and theme, not by this
 * module, then pasted here. Key order is part of it: these are the bytes.
 */
const V088: Record<string, string> = {
  "darwin/obsidian":
    '{"width":660,"height":620,"useContentSize":true,"resizable":false,"maximizable":false,"fullscreenable":false,"titleBarStyle":"hiddenInset","trafficLightPosition":{"x":18,"y":18},"backgroundColor":"#0A0A0C","title":"Guild Butler Capture","webPreferences":{"preload":"/APP/dist/preload/index.cjs","contextIsolation":true,"nodeIntegration":false,"sandbox":true}}',
  "darwin/parchment":
    '{"width":660,"height":620,"useContentSize":true,"resizable":false,"maximizable":false,"fullscreenable":false,"titleBarStyle":"hiddenInset","trafficLightPosition":{"x":18,"y":18},"backgroundColor":"#F6F1E6","title":"Guild Butler Capture","webPreferences":{"preload":"/APP/dist/preload/index.cjs","contextIsolation":true,"nodeIntegration":false,"sandbox":true}}',
  "win32/obsidian":
    '{"width":660,"height":620,"useContentSize":true,"resizable":false,"maximizable":false,"fullscreenable":false,"titleBarStyle":"hidden","titleBarOverlay":{"color":"#0c0b0f","symbolColor":"#a7a39b","height":48},"backgroundColor":"#0A0A0C","title":"Guild Butler Capture","webPreferences":{"preload":"/APP/dist/preload/index.cjs","contextIsolation":true,"nodeIntegration":false,"sandbox":true}}',
  "win32/parchment":
    '{"width":660,"height":620,"useContentSize":true,"resizable":false,"maximizable":false,"fullscreenable":false,"titleBarStyle":"hidden","titleBarOverlay":{"color":"#ece3cf","symbolColor":"#6b6353","height":48},"backgroundColor":"#F6F1E6","title":"Guild Butler Capture","webPreferences":{"preload":"/APP/dist/preload/index.cjs","contextIsolation":true,"nodeIntegration":false,"sandbox":true}}',
  "linux/obsidian":
    '{"width":660,"height":620,"useContentSize":true,"resizable":false,"maximizable":false,"fullscreenable":false,"backgroundColor":"#0A0A0C","title":"Guild Butler Capture","webPreferences":{"preload":"/APP/dist/preload/index.cjs","contextIsolation":true,"nodeIntegration":false,"sandbox":true}}',
  "linux/parchment":
    '{"width":660,"height":620,"useContentSize":true,"resizable":false,"maximizable":false,"fullscreenable":false,"backgroundColor":"#F6F1E6","title":"Guild Butler Capture","webPreferences":{"preload":"/APP/dist/preload/index.cjs","contextIsolation":true,"nodeIntegration":false,"sandbox":true}}',
};

describe("windowOptions: with the flag off, the old window is 0.8.8's, byte for byte", () => {
  for (const platform of PLATFORMS) {
    for (const theme of THEMES) {
      it(`${platform} · ${theme}`, () => {
        const options = windowOptions({ platform, theme, backgroundColor: groundFor(theme), preload: PRELOAD, shell: null });
        expect(JSON.stringify(options)).toBe(V088[`${platform}/${theme}`]);
        // JSON drops an undefined key; the object itself must not carry one either
        expect(options).toStrictEqual(JSON.parse(V088[`${platform}/${theme}`] ?? "null"));
      });
    }
  }

  it("index.ts still feeds it 0.8.8's grounds, and builds its one window from it", () => {
    expect([groundFor("parchment"), groundFor("obsidian")]).toEqual(["#F6F1E6", "#0A0A0C"]);
    expect(INDEX.match(/new BrowserWindow\(/g)).toHaveLength(1);
    expect(INDEX).toMatch(/new BrowserWindow\(\s*windowOptions\(/);
    // the old window unless the flag asks for the shell
    expect(INDEX).toMatch(/const placement = v5 \? placeShellWindow\(\) : null;/);
    expect(INDEX).toMatch(/shell: placement,/);
  });

  it("the old overlay keeps 0.8.8's colours for the theme switch's retint", () => {
    expect(overlayFor("obsidian")).toEqual({ color: "#0c0b0f", symbolColor: "#a7a39b", height: 48 });
    expect(overlayFor("parchment")).toEqual({ color: "#ece3cf", symbolColor: "#6b6353", height: 48 });
  });
});

describe("windowOptions: the v5 window", () => {
  const place: TWindowState = { bounds: { x: 320, y: 140, width: 1280, height: 800 }, maximized: false };
  const shellOptions = (platform: string, theme: TTheme, shell: TWindowState = place) =>
    windowOptions({ platform, theme, backgroundColor: groundFor(theme), preload: PRELOAD, shell });

  it("is resizable down to 768×620, maximizable and full-screenable, at the placement's outer bounds", () => {
    for (const platform of PLATFORMS) {
      const o = shellOptions(platform, "obsidian");
      expect(o).toMatchObject({
        x: 320,
        y: 140,
        width: 1280,
        height: 800,
        minWidth: MIN_WINDOW.width,
        minHeight: MIN_WINDOW.height,
        resizable: true,
        maximizable: true,
        fullscreenable: true,
      });
      expect([MIN_WINDOW.width, MIN_WINDOW.height]).toEqual([768, 620]);
      // outer bounds: the rectangle getNormalBounds() saves is the one reopened
      expect(o.useContentSize).toBeUndefined();
    }
  });

  it("is created hidden only when it reopens maximized", () => {
    expect("show" in shellOptions("win32", "obsidian")).toBe(false);
    expect(shellOptions("win32", "obsidian", { ...place, maximized: true }).show).toBe(false);
  });

  it("keeps the old window's web preferences: sandboxed, isolated, no Node", () => {
    const old = windowOptions({ platform: "darwin", theme: "obsidian", backgroundColor: "#000", preload: PRELOAD, shell: null });
    for (const platform of PLATFORMS) {
      expect(shellOptions(platform, "parchment").webPreferences).toStrictEqual(old.webPreferences);
    }
  });

  it("on a Mac, puts the lights' circles where board Fh1 draws them: 18pt in, centred on the 48pt bar", () => {
    const o = shellOptions("darwin", "obsidian");
    expect(o.titleBarStyle).toBe("hiddenInset");
    expect(o.trafficLightPosition).toEqual(SHELL_TRAFFIC_LIGHTS);
    const circleTop = SHELL_TRAFFIC_LIGHTS.y + MAC_LIGHT.insetY;
    expect(circleTop + MAC_LIGHT.diameter / 2).toBe(TITLE_BAR_HEIGHT / 2);
    expect(circleTop).toBe(18);
    expect(SHELL_TRAFFIC_LIGHTS.x + MAC_LIGHT.insetX).toBe(18);
    expect(o.titleBarOverlay).toBeUndefined();
  });

  it("on Windows, asks the OS for caption buttons over the shell's own 48px bar, in both themes", () => {
    for (const theme of THEMES) {
      const o = shellOptions("win32", theme);
      expect(o.titleBarStyle).toBe("hidden");
      expect(o.titleBarOverlay).toEqual(shellOverlayFor(theme));
      expect(o.trafficLightPosition).toBeUndefined();
    }
  });

  it("elsewhere keeps the OS frame, as the old window does", () => {
    const o = shellOptions("linux", "obsidian");
    expect(o.titleBarStyle).toBeUndefined();
    expect(o.titleBarOverlay).toBeUndefined();
    expect(o.trafficLightPosition).toBeUndefined();
  });
});

describe("windowOptions: the Windows overlay is the shell's title bar", () => {
  /** A custom property's value in the stylesheet's rule for exactly these selectors. */
  const declared = (css: string, selectors: string[], prop: string): string => {
    const found: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (rule.selectors.join("|") === selectors.join("|")) {
        rule.walkDecls(prop, (decl) => {
          found.push(decl.value.trim());
        });
      }
    });
    const [value, ...more] = found;
    if (value === undefined || more.length > 0) {
      throw new Error(`${prop} is declared ${found.length} times for ${selectors.join(", ")}, not once`);
    }
    return value;
  };

  const SHELL_CSS = read("src/app/shell.css");
  const TOKENS = readFileSync(require.resolve("@guild-butler/design-system/tokens.css"), "utf8");
  const DARK = [":root", '[data-theme="dark"]'];
  const LIGHT = ['[data-theme="light"]'];

  it("its ground is --lb-bar, the bar's own colour, in each theme", () => {
    expect(shellOverlayFor("obsidian").color.toLowerCase()).toBe(declared(SHELL_CSS, DARK, "--lb-bar").toLowerCase());
    expect(shellOverlayFor("parchment").color.toLowerCase()).toBe(declared(SHELL_CSS, LIGHT, "--lb-bar").toLowerCase());
  });

  it("its glyphs are the package's --gb-muted, as board Fh1 draws the three buttons", () => {
    expect(shellOverlayFor("obsidian").symbolColor.toLowerCase()).toBe(declared(TOKENS, DARK, "--gb-muted").toLowerCase());
    expect(shellOverlayFor("parchment").symbolColor.toLowerCase()).toBe(declared(TOKENS, LIGHT, "--gb-muted").toLowerCase());
  });

  it("its height is the bar's", () => {
    expect(declared(SHELL_CSS, [".lb-titlebar"], "height")).toBe(`${TITLE_BAR_HEIGHT}px`);
    for (const theme of THEMES) {
      expect(shellOverlayFor(theme).height).toBe(TITLE_BAR_HEIGHT);
    }
  });
});

describe("windowOptions: the v5 page is the only page its window shows", () => {
  const PAGE = "file:///Applications/Loot%20Butler.app/Contents/Resources/app.asar/dist/web/app/index.html";

  it("lets the page move between its own routes, or reload itself", () => {
    expect(isOwnPage(`${PAGE}#/session`, PAGE)).toBe(true);
    expect(isOwnPage(PAGE, `${PAGE}#/session`)).toBe(true);
    expect(isOwnPage(PAGE, PAGE)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const target of [
      "https://guild-butler.com/",
      "http://localhost:5173/index.html",
      "file:///etc/passwd",
      PAGE.replace("/app/", "/renderer/"),
      `${PAGE}?debug=1`,
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(isOwnPage(target, PAGE), target).toBe(false);
    }
  });

  it("refuses everything while the window has no page of its own yet", () => {
    expect(isOwnPage(PAGE, "")).toBe(false);
  });
});
