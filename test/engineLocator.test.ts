import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveEngine, type TLocatorDeps } from "../src/main/engineLocator.js";

const deps = (existing: string[], over: Partial<TLocatorDeps> = {}): TLocatorDeps => {
  const set = new Set(existing);
  return {
    configuredPath: null,
    resourcesPath: null,
    appRoot: "/apps/guild-butler-capture",
    dataDir: null,
    exists: (p) => set.has(p),
    join,
    dirname,
    ...over,
  };
};

describe("engine locator", () => {
  it("finds the dev sibling layout (the three folders side by side)", () => {
    const found = resolveEngine(deps(["/apps/ao-loot-logger/src/index.js"]));
    expect(found).toEqual({
      entry: "/apps/ao-loot-logger/src/index.js",
      root: "/apps/ao-loot-logger",
      workDir: "/apps/ao-loot-logger",
      source: "sibling",
    });
  });

  it("prefers the user's configured folder over discovery", () => {
    const found = resolveEngine(
      deps(["/custom/logger/src/index.js", "/apps/ao-loot-logger/src/index.js"], {
        configuredPath: "/custom/logger",
      }),
    );
    expect(found?.source).toBe("settings");
    expect(found?.root).toBe("/custom/logger");
  });

  it("accepts a configured entry FILE and derives the repo root from it", () => {
    const found = resolveEngine(
      deps(["/custom/logger/src/index.js"], { configuredPath: "/custom/logger/src/index.js" }),
    );
    expect(found).toEqual({
      entry: "/custom/logger/src/index.js",
      root: "/custom/logger",
      workDir: "/custom/logger",
      source: "settings",
    });
  });

  it("a stale configured path falls through to discovery instead of bricking it", () => {
    const found = resolveEngine(deps(["/apps/ao-loot-logger/src/index.js"], { configuredPath: "/moved/away" }));
    expect(found?.source).toBe("sibling");
  });

  it("prefers a bundled engine when packaged", () => {
    const found = resolveEngine(
      deps(["/res/engine/src/index.js", "/apps/ao-loot-logger/src/index.js"], { resourcesPath: "/res" }),
    );
    expect(found?.source).toBe("bundled");
    expect(found?.root).toBe("/res/engine");
  });

  it("a bundled engine captures into the user's data dir — its root is read-only", () => {
    // The engine writes its log to cwd (fork src/index.js), and a packaged
    // install dir must never be the cwd; dev layouts keep root as the workDir.
    const found = resolveEngine(
      deps(["/res/engine/src/index.js"], { resourcesPath: "/res", dataDir: "/home/user/.gbc" }),
    );
    expect(found?.workDir).toBe(join("/home/user/.gbc", "captures"));
    expect(found?.root).toBe("/res/engine");
  });

  it("returns null when nothing exists anywhere", () => {
    expect(resolveEngine(deps([]))).toBeNull();
  });
});
