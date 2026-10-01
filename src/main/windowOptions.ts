/**
 * The BrowserWindow options — the old window's, exactly as 0.8.8 passes them, and the v5
 * shell's. Pure, so test/windowOptions.test.ts can hold the old window to 0.8.8 byte for byte
 * while the new one is built beside it; index.ts only adds the values that need Electron (the
 * preload path, where the window goes) and wires the events.
 */

import type { BrowserWindowConstructorOptions } from "electron";

import type { TTheme } from "../shared/captureTypes.js";
import { MIN_WINDOW, TITLE_BAR_HEIGHT, type TWindowState } from "./windowBounds.js";

export type TOverlay = { color: string; symbolColor: string; height: number };

/** Windows overlay window-controls, tinted to match the active theme's title bar. */
export const overlayFor = (theme: TTheme): TOverlay => {
  return theme === "parchment"
    ? { color: "#ece3cf", symbolColor: "#6b6353", height: 48 }
    : { color: "#0c0b0f", symbolColor: "#a7a39b", height: 48 };
};

/**
 * The v5 shell's Windows caption buttons, painted by the OS over the right end of its title bar
 * (board Fh1, both themes). The ground is the bar's own `--lb-bar` (src/app/shell.css), the
 * glyphs the package's `--gb-muted`, and the height the bar's 48px. The main process cannot read
 * CSS, so the values are written here; test/windowOptions.test.ts holds them to the stylesheet
 * and the package's tokens.
 */
export const shellOverlayFor = (theme: TTheme): TOverlay => {
  return theme === "parchment"
    ? { color: "#F1EBDD", symbolColor: "#5B5341", height: TITLE_BAR_HEIGHT }
    : { color: "#0C0B0F", symbolColor: "#A7A39B", height: TITLE_BAR_HEIGHT };
};

/**
 * Where a Mac draws its three lights, measured rather than assumed: on macOS 26.6 with Electron
 * 37, each light's 12pt circle sits 1pt right of and 2pt below the `trafficLightPosition` it is
 * given (0.8.8's `{ x: 18, y: 18 }` puts the circles' centres 26pt down a 48pt bar, not 24).
 */
export const MAC_LIGHT = { diameter: 12, insetX: 1, insetY: 2 } as const;

/** Board Fh1's Mac bar: the first circle 18pt in, the circles centred on the 48pt bar. */
export const SHELL_TRAFFIC_LIGHTS = {
  x: 18 - MAC_LIGHT.insetX,
  y: (TITLE_BAR_HEIGHT - MAC_LIGHT.diameter) / 2 - MAC_LIGHT.insetY,
} as const;

export type TWindowInput = {
  platform: string;
  theme: TTheme;
  /**
   * The ground drawn before the first paint (the package's `--gb-bg`, the same in both windows).
   * Passed in rather than chosen here: test/designSystem.test.ts pins it where it is written, in
   * index.ts.
   */
  backgroundColor: string;
  /** The preload script's path, which depends on where the app is installed. */
  preload: string;
  /** Null: the old window. Otherwise the v5 shell, opening at this placement. */
  shell: TWindowState | null;
};

const webPreferences = (preload: string): BrowserWindowConstructorOptions["webPreferences"] => {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
};

/** The old window, exactly as 0.8.8 passes it — keys in the same order, so its JSON is the same. */
const oldWindowOptions = (input: TWindowInput): BrowserWindowConstructorOptions => {
  return {
    // ONE window size for every state (owner ruling, 2026-08-29): the hero
    // zone flexes inside; idle gives its room to the pairing card. Content
    // size, not outer size — the merged title bar is part of the content.
    width: 660,
    height: 620,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // Merged OS chrome: the app's own 48px header IS the title bar. macOS
    // keeps its traffic lights over the app surface; Windows gets overlay
    // window controls in the same strip. Anywhere else (dev on Linux) the
    // normal frame stays — the CSS drag region is inert there.
    ...(input.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 18 } }
      : input.platform === "win32"
        ? { titleBarStyle: "hidden" as const, titleBarOverlay: overlayFor(input.theme) }
        : {}),
    backgroundColor: input.backgroundColor,
    title: "Guild Butler Capture",
    webPreferences: webPreferences(input.preload),
  };
};

/**
 * The v5 window: resizable down to 768×620, maximizable, full-screenable, opening where it was
 * left. Bounds are the OUTER bounds (no `useContentSize`), because that is the rectangle
 * `getNormalBounds()` saves — the size remembered is the size reopened. With the OS chrome merged
 * into the page, outer and content are the same rectangle on a Mac anyway.
 */
const shellWindowOptions = (input: TWindowInput, place: TWindowState): BrowserWindowConstructorOptions => {
  return {
    ...place.bounds,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    // A window remembered maximized is created hidden and shown once maximized (index.ts), so it
    // does not first draw at its normal size.
    ...(place.maximized ? { show: false } : {}),
    ...(input.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { ...SHELL_TRAFFIC_LIGHTS } }
      : input.platform === "win32"
        ? { titleBarStyle: "hidden" as const, titleBarOverlay: shellOverlayFor(input.theme) }
        : {}),
    backgroundColor: input.backgroundColor,
    title: "Guild Butler Capture",
    webPreferences: webPreferences(input.preload),
  };
};

export const windowOptions = (input: TWindowInput): BrowserWindowConstructorOptions => {
  return input.shell == null ? oldWindowOptions(input) : shellWindowOptions(input, input.shell);
};

/**
 * The v5 page's navigation rule: the window only ever shows its own page. Moving between the
 * shell's routes changes the hash, which is not a navigation (Electron does not ask); anything
 * else — a link without a target, a form, `location.href` — would put another page in a window
 * whose preload hands every page the app's bridge. The page itself reloading is still allowed.
 */
export const isOwnPage = (target: string, page: string): boolean => {
  try {
    const to = new URL(target);
    const own = new URL(page);
    return to.protocol === own.protocol && to.host === own.host && to.pathname === own.pathname && to.search === own.search;
  } catch {
    return false;
  }
};
