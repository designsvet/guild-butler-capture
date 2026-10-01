import { describe, expect, it } from "vitest";

import {
  FIRST_OPEN,
  firstOpenBounds,
  landsOnADisplay,
  MIN_VISIBLE_BAR,
  MIN_WINDOW,
  parseWindowState,
  placeWindow,
  windowStateOf,
  type TRect,
} from "../src/main/windowBounds.js";

/** A 27" Mac at 2560×1440 points, under a 25pt menu bar. */
const MAC: TRect = { x: 0, y: 25, width: 2560, height: 1415 };
/** A 1366×768 laptop under a 40px Windows taskbar — narrower than 1280 is not, shorter than 800 is. */
const LAPTOP: TRect = { x: 0, y: 0, width: 1366, height: 728 };
/** A second monitor to the LEFT of the primary: negative coordinates are a real place. */
const LEFT_MONITOR: TRect = { x: -1920, y: 0, width: 1920, height: 1040 };

describe("windowBounds: the first open", () => {
  it("is 1280×800, centred in the work area, when the screen holds it", () => {
    expect(firstOpenBounds(MAC)).toEqual({ x: 640, y: 25 + 307, width: FIRST_OPEN.width, height: FIRST_OPEN.height });
  });

  it("is clamped to a work area shorter than 800 — and starts at its top, not above it", () => {
    expect(firstOpenBounds(LAPTOP)).toEqual({ x: 43, y: 0, width: 1280, height: 728 });
  });

  it("fills a work area of exactly 1280×800", () => {
    expect(firstOpenBounds({ x: 0, y: 0, width: 1280, height: 800 })).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it("never goes under the 768×620 minimum: on a tiny screen it overhangs, title bar on the screen", () => {
    expect(firstOpenBounds({ x: 0, y: 0, width: 1024, height: 600 })).toEqual({ x: 0, y: 0, width: 1024, height: 620 });
    expect(firstOpenBounds({ x: 10, y: 30, width: 700, height: 500 })).toEqual({
      x: 10,
      y: 30,
      width: MIN_WINDOW.width,
      height: MIN_WINDOW.height,
    });
  });

  it("centres within the work area's own origin — a monitor left of the primary, a taskbar on the left", () => {
    expect(firstOpenBounds(LEFT_MONITOR)).toEqual({ x: -1920 + 320, y: 120, width: 1280, height: 800 });
    expect(firstOpenBounds({ x: 62, y: 0, width: 1858, height: 1080 })).toEqual({ x: 62 + 289, y: 140, width: 1280, height: 800 });
  });

  it("lands whole pixels on an odd-sized work area", () => {
    const b = firstOpenBounds({ x: 0, y: 0, width: 1281, height: 801 });
    expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
  });
});

describe("windowBounds: a stored state is validated, never trusted", () => {
  const good = { bounds: { x: 100, y: 80, width: 1400, height: 900 }, maximized: false };

  it("reads a well-formed state back as it was", () => {
    expect(parseWindowState(good)).toEqual(good);
    expect(parseWindowState({ ...good, maximized: true })).toEqual({ ...good, maximized: true });
  });

  it("drops anything that is not an object with a bounds object", () => {
    for (const raw of [null, undefined, "x", 7, [], { maximized: true }, { bounds: null }, { bounds: "0,0,800,600" }]) {
      expect(parseWindowState(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("drops a missing, non-numeric, non-finite or absurd coordinate", () => {
    const withBound = (patch: Record<string, unknown>): unknown => ({ bounds: { ...good.bounds, ...patch }, maximized: false });
    for (const patch of [
      { x: undefined },
      { y: "80" },
      { width: null },
      { height: Number.NaN },
      { x: Number.POSITIVE_INFINITY },
      { width: 1e9 },
      { y: -40_000 },
    ]) {
      expect(parseWindowState(withBound(patch)), JSON.stringify(patch)).toBeNull();
    }
  });

  it("drops a zero or negative size", () => {
    expect(parseWindowState({ bounds: { ...good.bounds, width: 0 } })).toBeNull();
    expect(parseWindowState({ bounds: { ...good.bounds, height: -620 } })).toBeNull();
  });

  it("raises a size under the minimum to it, keeping the place", () => {
    expect(parseWindowState({ bounds: { x: 100, y: 80, width: 500, height: 400 } })).toEqual({
      bounds: { x: 100, y: 80, width: 768, height: 620 },
      maximized: false,
    });
  });

  it("keeps negative coordinates (a monitor left of or above the primary) and rounds fractions", () => {
    expect(parseWindowState({ bounds: { x: -1800.4, y: -12.6, width: 1280.5, height: 800 } })?.bounds).toEqual({
      x: -1800,
      y: -13,
      width: 1281,
      height: 800,
    });
  });

  it("is maximized only when the file says exactly true", () => {
    expect(parseWindowState({ bounds: good.bounds, maximized: "true" })?.maximized).toBe(false);
    expect(parseWindowState({ bounds: good.bounds, maximized: 1 })?.maximized).toBe(false);
    expect(parseWindowState({ bounds: good.bounds })?.maximized).toBe(false);
  });
});

describe("windowBounds: a remembered place that lands on no display is dropped", () => {
  const at = (x: number, y: number, width = 1280, height = 800): { bounds: TRect; maximized: boolean } => ({
    bounds: { x, y, width, height },
    maximized: false,
  });

  it("reopens where it was when it is on a screen", () => {
    expect(placeWindow({ stored: at(300, 200), workAreas: [MAC], primary: MAC })).toEqual({
      ...at(300, 200),
      source: "remembered",
    });
  });

  it("opens at the first-open size when nothing is stored", () => {
    expect(placeWindow({ stored: null, workAreas: [MAC], primary: MAC })).toEqual({
      bounds: firstOpenBounds(MAC),
      maximized: false,
      source: "first-open",
    });
  });

  it("drops a place on a monitor that has been unplugged — and its maximized flag with it", () => {
    const onSecond = { bounds: { x: 2700, y: 100, width: 1280, height: 800 }, maximized: true };
    expect(placeWindow({ stored: onSecond, workAreas: [MAC], primary: MAC })).toEqual({
      bounds: firstOpenBounds(MAC),
      maximized: false,
      source: "off-screen",
    });
  });

  it("keeps the same place while that monitor is still plugged in", () => {
    const second: TRect = { x: 2560, y: 0, width: 1920, height: 1080 };
    const onSecond = { bounds: { x: 2700, y: 100, width: 1280, height: 800 }, maximized: true };
    expect(placeWindow({ stored: onSecond, workAreas: [MAC, second], primary: MAC })).toEqual({
      ...onSecond,
      source: "remembered",
    });
  });

  it("keeps a window that spans two monitors whole, not fitted to either", () => {
    const span = at(-600, 100, 1600, 900);
    expect(placeWindow({ stored: span, workAreas: [LEFT_MONITOR, LAPTOP], primary: LAPTOP })).toEqual({
      ...span,
      source: "remembered",
    });
  });

  it("needs MIN_VISIBLE_BAR of the title bar across on one work area", () => {
    const area: TRect = { x: 0, y: 0, width: 1920, height: 1080 };
    // hanging off the right edge: only the left end of the bar is on the screen
    expect(landsOnADisplay({ x: 1920 - MIN_VISIBLE_BAR.width, y: 100, width: 1280, height: 800 }, [area])).toBe(true);
    expect(landsOnADisplay({ x: 1920 - MIN_VISIBLE_BAR.width + 1, y: 100, width: 1280, height: 800 }, [area])).toBe(false);
    // hanging off the left edge
    expect(landsOnADisplay({ x: MIN_VISIBLE_BAR.width - 1280, y: 100, width: 1280, height: 800 }, [area])).toBe(true);
    expect(landsOnADisplay({ x: MIN_VISIBLE_BAR.width - 1281, y: 100, width: 1280, height: 800 }, [area])).toBe(false);
  });

  it("needs half the bar's height on the screen: a bar pushed above the work area is dropped", () => {
    const area: TRect = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(landsOnADisplay({ x: 100, y: -24, width: 1280, height: 800 }, [area])).toBe(true);
    expect(landsOnADisplay({ x: 100, y: -25, width: 1280, height: 800 }, [area])).toBe(false);
    // the body on screen does not save it: the bar is what you grab
    expect(landsOnADisplay({ x: 100, y: -200, width: 1280, height: 800 }, [area])).toBe(false);
    // and a bar below the bottom edge is just as lost
    expect(landsOnADisplay({ x: 100, y: 1080 - 23, width: 1280, height: 800 }, [area])).toBe(false);
  });

  it("measures against work areas, not whole displays: a bar under the macOS menu bar is lost", () => {
    expect(landsOnADisplay({ x: 100, y: 0, width: 1280, height: 800 }, [MAC])).toBe(false);
    expect(landsOnADisplay({ x: 100, y: 1, width: 1280, height: 800 }, [MAC])).toBe(true);
  });

  it("drops everything when there are no displays at all", () => {
    expect(landsOnADisplay({ x: 0, y: 0, width: 1280, height: 800 }, [])).toBe(false);
  });
});

describe("windowBounds: maximized is remembered over the normal bounds", () => {
  const normal: TRect = { x: 200, y: 150, width: 1300, height: 860 };

  it("a normal window saves its bounds, not maximized", () => {
    expect(windowStateOf({ normalBounds: normal, maximized: false, fullScreen: false, minimized: false })).toEqual({
      bounds: normal,
      maximized: false,
    });
  });

  it("a maximized window saves the size it un-maximizes to, and the flag", () => {
    const state = windowStateOf({ normalBounds: normal, maximized: true, fullScreen: false, minimized: false });
    expect(state).toEqual({ bounds: normal, maximized: true });
    // and reopens at those bounds, maximized over them
    expect(placeWindow({ stored: parseWindowState(JSON.parse(JSON.stringify(state))), workAreas: [MAC], primary: MAC })).toEqual(
      { bounds: normal, maximized: true, source: "remembered" },
    );
  });

  it("full screen is not remembered: the window comes back at its normal bounds", () => {
    expect(windowStateOf({ normalBounds: normal, maximized: true, fullScreen: true, minimized: false })).toEqual({
      bounds: normal,
      maximized: false,
    });
  });

  it("a minimized window says nothing: a Mac reports its zoomed frame as normal, both OSes say not maximized", () => {
    // what a Mac reported for a maximized window minimized to the Dock (measured, macOS 26.6)
    const zoomed: TRect = { x: 0, y: 30, width: 2560, height: 1325 };
    expect(windowStateOf({ normalBounds: zoomed, maximized: false, fullScreen: false, minimized: true })).toBeNull();
    expect(windowStateOf({ normalBounds: normal, maximized: false, fullScreen: false, minimized: true })).toBeNull();
  });

  it("saves only the four numbers, whatever else the rectangle carries", () => {
    const extra = { ...normal, scale: 2 } as TRect;
    expect(Object.keys(windowStateOf({ normalBounds: extra, maximized: false, fullScreen: false, minimized: false })?.bounds ?? {})).toEqual([
      "x",
      "y",
      "width",
      "height",
    ]);
  });
});
