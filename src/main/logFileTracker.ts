/**
 * Log-file tracker — finds the engine's current `loot-events-*.txt` and counts
 * its data lines, as the FALLBACK when the engine's own heartbeat count was not
 * parseable, and as the source of the path Reveal opens when the engine never
 * announced a filename.
 *
 * Polling, not fs.watch: the file lives wherever the engine writes it (repo
 * root or cwd), watch semantics differ per platform, and a 5-second poll over
 * one small directory is invisible. Everything filesystem-shaped is injected.
 */

const LOG_NAME_RE = /^loot-events-.*\.txt$/i;

/** The capture CSV's header line (the bot's ingest skips it too — see ADR 0092). */
const HEADER_PREFIX = "timestamp_utc;";

export type TLogCandidate = { path: string; mtimeMs: number };

/** Newest matching file across every candidate dir; name filter is the caller's. */
export const pickNewestLog = (candidates: readonly TLogCandidate[]): TLogCandidate | null => {
  let best: TLogCandidate | null = null;
  for (const c of candidates) {
    if (best == null || c.mtimeMs > best.mtimeMs) {
      best = c;
    }
  }
  return best;
};

export const isLootLogName = (name: string): boolean => {
  return LOG_NAME_RE.test(name);
};

/** Loot events in a capture file = non-empty lines minus the header. */
export const countDataLines = (text: string): number => {
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.toLowerCase().startsWith(HEADER_PREFIX)) {
      continue;
    }
    count += 1;
  }
  return count;
};

export type TLogTrackerDeps = {
  /** Directories the engine might write into (engine root, spawn cwd). */
  dirs: readonly string[];
  /** Files modified before this are last session's; small slack applied here. */
  sinceMs: number;
  listDir: (dir: string) => Promise<TLogCandidate[]>;
  readFile: (path: string) => Promise<string>;
  onUpdate: (file: string, lines: number) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  intervalMs?: number;
};

const DEFAULT_INTERVAL_MS = 5000;
const MTIME_SLACK_MS = 5000;

export type TLogFileTracker = { stop: () => void; pollNow: () => Promise<void> };

export const createLogFileTracker = (deps: TLogTrackerDeps): TLogFileTracker => {
  let stopped = false;
  let polling = false;
  let lastReported: { file: string; lines: number } | null = null;

  const poll = async (): Promise<void> => {
    if (stopped || polling) {
      return;
    }
    polling = true;
    try {
      const all: TLogCandidate[] = [];
      for (const dir of deps.dirs) {
        try {
          const entries = await deps.listDir(dir);
          for (const e of entries) {
            if (e.mtimeMs >= deps.sinceMs - MTIME_SLACK_MS) {
              all.push(e);
            }
          }
        } catch {
          // a candidate dir may simply not exist — that is not an error
        }
      }
      const newest = pickNewestLog(all);
      if (newest == null) {
        return;
      }
      const lines = countDataLines(await deps.readFile(newest.path));
      if (lastReported == null || lastReported.file !== newest.path || lastReported.lines !== lines) {
        lastReported = { file: newest.path, lines };
        if (!stopped) {
          deps.onUpdate(newest.path, lines);
        }
      }
    } catch {
      // transient read failures (file mid-rotation) — next tick retries
    } finally {
      polling = false;
    }
  };

  const handle = deps.setInterval(() => {
    void poll();
  }, deps.intervalMs ?? DEFAULT_INTERVAL_MS);

  return {
    stop: (): void => {
      stopped = true;
      deps.clearInterval(handle);
    },
    pollNow: poll,
  };
};
