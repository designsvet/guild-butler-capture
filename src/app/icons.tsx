/**
 * The shell's icons: Tabler Icons, outline (MIT), the set the boards draw with, inline so the page
 * loads nothing (Q58: the crest is the only image). Each is decorative — what it stands for is
 * always in the words beside it — so every one is aria-hidden.
 */

type TIconProps = {
  /** The path data, one string per <path>, exactly as Tabler writes them. */
  paths: readonly string[];
  size?: number;
  /**
   * The sidebar's current view: each stroke drawn once on arrival, then the glow (shell.css,
   * `.lb-lit`). `pathLength` makes every stroke 1 long, so one dash draws any path.
   */
  lit?: boolean;
};

export const Icon = ({ paths, size = 15, lit = false }: TIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={lit ? "lb-lit" : undefined}
  >
    {paths.map((d) => (
      <path key={d} d={d} pathLength={lit ? 1 : undefined} />
    ))}
  </svg>
);

/** "settings" — the gear (board Fh1). */
export const GEAR = [
  "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z",
  "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
] as const;

/** "player-play" — Start capture, and the Capture card's tile. */
export const PLAY = ["M7 4v16l13 -8z"] as const;

/** "chevron-right" — the sidebar foot's door. */
export const CHEVRON = ["M9 6l6 6l-6 6"] as const;

/** "circle-dot" — Session in the sidebar. */
export const SESSION = ["M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"] as const;

/** The hero card's icon for each state (src/app/model.ts `THeroIcon`). */
export const HERO = {
  /** "radar-2" — waiting for Albion. */
  radar: [
    "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M15.51 15.56a5 5 0 1 0 -3.51 1.44",
    "M18.832 17.86a9 9 0 1 0 -6.832 3.14",
    "M12 12v9",
  ],
  /** "hourglass" — starting. */
  hourglass: [
    "M6.5 7h11",
    "M6.5 17h11",
    "M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1z",
    "M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1z",
  ],
  /** "chart-bar-popular" — capturing, nothing to count yet. */
  chart: ["M6 18l0 -3", "M10 18l0 -6", "M14 18l0 -9", "M18 18l0 -12"],
  /** "player-pause" — not capturing. */
  pause: [
    "M6 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z",
    "M14 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z",
  ],
  /** "player-stop" — stopping. */
  stop: ["M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"],
  /** "refresh" — restarting. */
  refresh: ["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4", "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"],
  /** "alert-triangle" — something needs fixing. */
  alert: [
    "M12 9v4",
    "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z",
    "M12 16h.01",
  ],
} as const;

/** "info-circle" — What appears here. */
export const INFO = ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 9h.01", "M11 12h1v4h1"] as const;

/** The four rows of What appears here, in order (board Fh3). */
export const APPEARS = [
  /** "bolt" — fame, silver, respec, might and favor. */
  ["M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"],
  /** "backpack" — loot. */
  [
    "M5 18v-6a6 6 0 0 1 6 -6h2a6 6 0 0 1 6 6v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z",
    "M10 6v-1a2 2 0 1 1 4 0v1",
    "M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4",
    "M11 10h2",
  ],
  /** "skull" — mobs and chests. */
  [
    "M12 4c4.418 0 8 3.358 8 7.5c0 1.901 -.755 3.637 -2 4.96l0 2.54a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-2.54c-1.245 -1.322 -2 -3.058 -2 -4.96c0 -4.142 3.582 -7.5 8 -7.5z",
    "M10 17v3",
    "M14 17v3",
    "M9 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M15 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  ],
  /** "history" — history. */
  ["M12 8l0 4l2 2", "M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"],
] as const;

/** "plug-connected" — Send loot to your guild. */
export const PLUG = [
  "M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z",
  "M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z",
  "M3 21l2.5 -2.5",
  "M18.5 5.5l2.5 -2.5",
  "M10 11l-2 2",
  "M13 14l-2 2",
] as const;

/** "folder" — On this Mac, and its Open folder button. */
export const FOLDER = ["M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"] as const;

/** The notices' icons (board Fh5; src/app/notices.ts `TNoticeIcon`). */
export const NOTICE = {
  /** "shield-lock" — macOS is blocking network capture. */
  shield: [
    "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3",
    "M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M12 12l0 2.5",
  ],
  /** "device-desktop" — the capture driver, and the engine on this computer. */
  desktop: [
    "M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10z",
    "M7 20h10",
    "M9 16v4",
    "M15 16v4",
  ],
  /** "alert-triangle" — a game update broke loot logging. */
  alert: HERO.alert,
  /** "refresh" — the logger keeps stopping. */
  refresh: HERO.refresh,
  /** "download" — an update is ready. */
  download: ["M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2", "M7 11l5 5l5 -5", "M12 4l0 12"],
} as const;
