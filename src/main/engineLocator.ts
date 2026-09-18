/**
 * Where is the engine? Resolution order:
 *   1. the user's configured folder (Advanced → Choose engine folder)
 *   2. a bundled copy under Electron's resourcesPath (packaged builds, Phase 3)
 *   3. the dev layout: `ao-loot-logger` as a SIBLING of this app's folder —
 *      exactly how the three repos sit next to each other on the owner's disk.
 *
 * The engine's entry point is `src/index.js` inside its repo root; the root is
 * also the spawn cwd, because today's manual runs (`sudo node src/index.js`
 * from the repo root) write the log next to that root and Phase 1 changes
 * nothing about where the file lands.
 */

export type TResolvedEngine = {
  /** Absolute path to the engine's src/index.js. */
  entry: string;
  /** The engine repo root (where its package.json and node_modules live). */
  root: string;
  /**
   * Spawn cwd and the log-file directory. Started by this app
   * (ELECTRON_RUN_AS_NODE=1), the engine writes its loot log to its working
   * folder (`logDir` in the engine's src/loot-logger.js), so for a BUNDLED
   * engine — whose root sits inside the installed app — this is a per-user
   * captures folder instead of the root. Dev layouts keep root, so the log
   * keeps landing next to the engine exactly like the manual runs.
   *
   * This comment used to say it was so, citing src/index.js, while the engine
   * wrote beside itself: every bundle built before designsvet/ao-loot-logger#11
   * put its loot logs INSIDE the installed app (on macOS breaking the bundle's
   * signature seal, measured 2026-09-18), and the tracker watching this folder
   * never saw them. Only the engine's announced path kept uploads working.
   */
  workDir: string;
  /** Which rule found it: "settings" | "bundled" | "sibling". */
  source: string;
};

export type TLocatorDeps = {
  /** The user's configured engine folder (or entry file), when set. */
  configuredPath: string | null;
  /** Electron's process.resourcesPath (bundled engine lives at <resources>/engine). */
  resourcesPath: string | null;
  /** The app's own root folder (package.json dir) — siblings are found from here. */
  appRoot: string;
  /** Electron's userData dir — a bundled engine captures into <dataDir>/captures. */
  dataDir: string | null;
  exists: (path: string) => boolean;
  join: (...parts: string[]) => string;
  dirname: (path: string) => string;
};

const ENTRY_SUFFIX = ["src", "index.js"] as const;

const entryFor = (deps: TLocatorDeps, root: string): string => {
  return deps.join(root, ...ENTRY_SUFFIX);
};

export const resolveEngine = (deps: TLocatorDeps): TResolvedEngine | null => {
  const { configuredPath, resourcesPath, appRoot, dataDir, exists, join, dirname } = deps;

  if (configuredPath != null && configuredPath.trim().length > 0) {
    const p = configuredPath.trim();
    if (p.endsWith(".js")) {
      if (exists(p)) {
        // …/src/index.js → root is two levels up; anything else → its own dir.
        const parent = dirname(p);
        const root = parent.endsWith("src") || parent.endsWith("src/") ? dirname(parent) : parent;
        return { entry: p, root, workDir: root, source: "settings" };
      }
    } else {
      const entry = entryFor(deps, p);
      if (exists(entry)) {
        return { entry, root: p, workDir: p, source: "settings" };
      }
    }
    // A configured path that resolves to nothing falls through to the other
    // rules on purpose: a stale setting must not brick auto-discovery.
  }

  if (resourcesPath != null) {
    const root = join(resourcesPath, "engine");
    const entry = entryFor(deps, root);
    if (exists(entry)) {
      const workDir = dataDir != null ? join(dataDir, "captures") : root;
      return { entry, root, workDir, source: "bundled" };
    }
  }

  for (const up of [join(appRoot, ".."), join(appRoot, "..", "..")]) {
    const root = join(up, "ao-loot-logger");
    const entry = entryFor(deps, root);
    if (exists(entry)) {
      return { entry, root, workDir: root, source: "sibling" };
    }
  }

  return null;
};
