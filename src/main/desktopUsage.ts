/** Bounded local elapsed time. A sleeping machine or stalled loop never invents play time. */
export const USAGE_SAMPLE_MS = 30_000;
export const MAX_SAMPLE_GAP_MS = 90_000;

export type TUsageActivity = { capture: boolean; foreground: boolean };
export type TUsageTotals = { appSeconds: number; captureSeconds: number; foregroundSeconds: number };

export const createUsageClock = (now: () => number) => {
  let last = now();
  let active: TUsageActivity = { capture: false, foreground: false };
  let paused = false;
  let totals = { app: 0, capture: 0, foreground: 0 };
  const sample = (): void => {
    const current = now();
    const gap = current - last;
    last = current;
    if (paused || !Number.isFinite(gap) || gap <= 0 || gap > MAX_SAMPLE_GAP_MS) return;
    totals.app += gap;
    if (active.capture) totals.capture += gap;
    if (active.foreground) totals.foreground += gap;
  };
  return {
    sample,
    activity: (next: TUsageActivity): void => { sample(); active = next; },
    pause: (): void => { sample(); paused = true; },
    resume: (): void => { last = now(); paused = false; },
    reset: (): void => { last = now(); totals = { app: 0, capture: 0, foreground: 0 }; },
    totals: (): TUsageTotals => ({ appSeconds: Math.floor(totals.app / 1000), captureSeconds: Math.floor(totals.capture / 1000), foregroundSeconds: Math.floor(totals.foreground / 1000) }),
  };
};

/** Development, mock and replay sessions must never reach production analytics or support. */
export const desktopReportingAllowed = (packaged: boolean, env: Readonly<Record<string, string | undefined>>, source?: string | null): boolean =>
  packaged && env.GBC_MOCK_ENGINE !== "1" && !env.GBC_REPLAY_DIR && !env.GBC_REPLAY && !env.GBC_REPLAY_ENGINE && env.GBC_NO_TELEMETRY !== "1" && source !== "mock" && source !== "replay";
