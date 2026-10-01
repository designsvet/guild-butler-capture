/**
 * Where the v5 window opens (Loot Butler, raid-bot ADR 0159): the size and place it remembers,
 * or, the first time, 1280×800 clamped to the screen. Pure — the displays come in as plain
 * rectangles — so every rule here is a unit test (test/windowBounds.test.ts) instead of a guess
 * about whichever monitors the tester happens to own.
 *
 * The old 660×620 window has none of this: it opens where the OS puts it, at its one size.
 */

/** A rectangle in screen points, as Electron's `Rectangle`. */
export type TRect = { x: number; y: number; width: number; height: number };

/**
 * What `window-state.json` holds. `bounds` are always the window's NORMAL bounds — the
 * rectangle it un-maximizes to — so a window closed while maximized reopens maximized AND
 * still knows the size it had before; saving the maximized rectangle would lose that.
 */
export type TWindowState = { bounds: TRect; maximized: boolean };

/** Where the window opened from, for the app log: the support answer to "why did it move?". */
export type TPlacementSource = "remembered" | "first-open" | "off-screen";

export type TPlacement = TWindowState & { source: TPlacementSource };

/** The smallest window (the plan's 768×620; board F1r768 is the narrowest the canvas draws). */
export const MIN_WINDOW = { width: 768, height: 620 } as const;

/** The first open, before there is anything to remember (the plan's "1280×800 on first run"). */
export const FIRST_OPEN = { width: 1280, height: 800 } as const;

/** The shell's title bar (boards Fh1, F1) — the strip that has to stay on a screen. */
export const TITLE_BAR_HEIGHT = 48;

/**
 * How much of the title bar a remembered place must leave on some screen for the window to be
 * reopened there: enough to grab it, or at least to reach Windows' own three buttons (3 × 46 px,
 * plus the board's gap), and half its height. Less than that is a window nobody can reach — most
 * often one remembered on a monitor that has since been unplugged.
 */
export const MIN_VISIBLE_BAR = { width: 160, height: TITLE_BAR_HEIGHT / 2 } as const;

/**
 * Beyond any real desktop, and where Windows' 16-bit message coordinates stop meaning anything.
 * A stored value past it is a corrupt file, not a place.
 */
const MAX_COORD = 32_767;

/**
 * The first open: 1280×800, or as much of it as the screen's work area holds — but never under
 * the minimum, which the OS enforces anyway (the window is then taller than a very small screen,
 * and the top-left alignment below keeps its title bar on it). Centred in the work area; on an
 * axis where it does not fit, it starts at the work area's edge instead, so the title bar is
 * never pushed above or left of the screen.
 */
export const firstOpenBounds = (workArea: TRect): TRect => {
  const width = Math.max(MIN_WINDOW.width, Math.min(FIRST_OPEN.width, workArea.width));
  const height = Math.max(MIN_WINDOW.height, Math.min(FIRST_OPEN.height, workArea.height));
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height,
  };
};

const coord = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORD) {
    return null;
  }
  return Math.round(value);
};

/**
 * Read a stored window state, or nothing. The file is ours, but it is still a file in the
 * user's home directory: anything that is not four finite numbers and a size is dropped (the
 * window then opens at the first-open size), never trusted. A size under the minimum is raised to
 * it — the OS would refuse the smaller window anyway, and the remembered place is still good.
 * `maximized` is true only when it is literally `true`.
 */
export const parseWindowState = (raw: unknown): TWindowState | null => {
  if (typeof raw !== "object" || raw == null) {
    return null;
  }
  const bounds = (raw as Record<string, unknown>).bounds;
  if (typeof bounds !== "object" || bounds == null) {
    return null;
  }
  const b = bounds as Record<string, unknown>;
  const x = coord(b.x);
  const y = coord(b.y);
  const width = coord(b.width);
  const height = coord(b.height);
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
    return null;
  }
  return {
    bounds: {
      x,
      y,
      width: Math.max(MIN_WINDOW.width, width),
      height: Math.max(MIN_WINDOW.height, height),
    },
    maximized: (raw as Record<string, unknown>).maximized === true,
  };
};

/**
 * Whether a window at `bounds` lands on a display: enough of its title bar (MIN_VISIBLE_BAR) on
 * one display's work area. Work areas, not whole displays — the strip under the macOS menu bar or
 * behind the Windows taskbar cannot be grabbed. A window across two monitors passes on either.
 */
export const landsOnADisplay = (bounds: TRect, workAreas: readonly TRect[]): boolean => {
  return workAreas.some((area) => {
    const across = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const down = Math.min(bounds.y + TITLE_BAR_HEIGHT, area.y + area.height) - Math.max(bounds.y, area.y);
    return across >= MIN_VISIBLE_BAR.width && down >= MIN_VISIBLE_BAR.height;
  });
};

/**
 * Where the window opens. The remembered state as it was when it still lands on a display —
 * kept whole, not fitted, so a window placed across two monitors stays there. Otherwise the
 * first-open size on the primary display, and not maximized: maximizing would put the window on
 * whichever display the OS picks, which is not the remembered one either.
 */
export const placeWindow = (input: {
  stored: TWindowState | null;
  workAreas: readonly TRect[];
  primary: TRect;
}): TPlacement => {
  const { stored, workAreas, primary } = input;
  if (stored != null && landsOnADisplay(stored.bounds, workAreas)) {
    return { ...stored, source: "remembered" };
  }
  return {
    bounds: firstOpenBounds(primary),
    maximized: false,
    source: stored == null ? "first-open" : "off-screen",
  };
};

/**
 * What to remember about the window as it is now: its normal bounds (Electron's
 * `getNormalBounds()`, the same rectangle whatever state the window is in) and whether it is
 * maximized over them. Full screen is not remembered: on a Mac it is a Space of its own, and
 * reopening into one is not what "remembers its size and place" means — the window comes back at
 * the bounds it had before.
 *
 * A minimized window says nothing (null): both OSes report it as not maximized, and a Mac also
 * reports the zoomed frame as its normal bounds — measured: quitting from the Dock with a
 * maximized window minimized saved the whole screen as an un-maximized size, and the size it
 * un-maximizes to was gone. Its place is the one it had before it was minimized; the keeper
 * (windowState.ts) writes that instead.
 */
export const windowStateOf = (window: {
  normalBounds: TRect;
  maximized: boolean;
  fullScreen: boolean;
  minimized: boolean;
}): TWindowState | null => {
  if (window.minimized) {
    return null;
  }
  const { x, y, width, height } = window.normalBounds;
  return { bounds: { x, y, width, height }, maximized: window.maximized && !window.fullScreen };
};
