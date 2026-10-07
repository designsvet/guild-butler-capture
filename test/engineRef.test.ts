import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEV_ENGINE,
  DEV_STAMP,
  ENGINE_LOOT_RULES_FILE,
  ENGINE_REF_FILE,
  engineLootRulesFor,
  engineRefFor,
  engineStampFor,
  parseEngineRef,
  parseLootRules,
  stampForLootLog,
  UNKNOWN_ENGINE,
  UNVOUCHED_STAMP,
  type TEngineStamp,
} from "../src/main/engineRef.js";

/**
 * Which engine wrote the lines: the X-Capture-Engine header (raid-bot ADR 0168, slice 1 step 5).
 * The rule that reads the stamp, and the build step that writes it — run for real over a real git
 * checkout, because the stamp's whole point is to be the commit the bundle was built from.
 */

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("reading the stamp", () => {
  it("takes one full lowercase sha, whitespace aside", () => {
    expect(parseEngineRef(`${SHA}\n`)).toBe(SHA);
    expect(parseEngineRef(`  ${SHA}  `)).toBe(SHA);
  });

  it("refuses anything else — the header must never carry a guess, or a line break", () => {
    expect(parseEngineRef(null)).toBeNull();
    expect(parseEngineRef("")).toBeNull();
    expect(parseEngineRef(SHA.slice(0, 7))).toBeNull();
    expect(parseEngineRef(SHA.toUpperCase())).toBeNull();
    expect(parseEngineRef(`${SHA}\nX-Other: 1`)).toBeNull();
    expect(parseEngineRef("protocol18")).toBeNull();
  });
});

describe("the header's value per engine", () => {
  const files = new Map<string, string>();
  const read = (path: string): string | null => files.get(path) ?? null;
  const join2 = (...parts: string[]): string => parts.join("/");

  it("is the bundled engine's stamped commit", () => {
    files.set(`/res/engine/${ENGINE_REF_FILE}`, `${SHA}\n`);
    expect(engineRefFor({ source: "bundled", root: "/res/engine" }, read, join2)).toBe(SHA);
  });

  it("is `unknown` for a bundled engine with no readable stamp", () => {
    expect(engineRefFor({ source: "bundled", root: "/elsewhere" }, read, join2)).toBe(UNKNOWN_ENGINE);
    files.set(`/bad/${ENGINE_REF_FILE}`, "not a sha");
    expect(engineRefFor({ source: "bundled", root: "/bad" }, read, join2)).toBe(UNKNOWN_ENGINE);
  });

  it("is `dev` for every engine that is not the bundled one — whatever stamp sits beside it", () => {
    files.set(`/dev/ao-loot-logger/${ENGINE_REF_FILE}`, `${SHA}\n`);
    for (const source of ["sibling", "settings"]) {
      expect(engineRefFor({ source, root: "/dev/ao-loot-logger" }, read, join2)).toBe(DEV_ENGINE);
    }
    expect(engineRefFor(null, read, join2)).toBe(DEV_ENGINE);
  });
});

describe("reading the loot-rules level", () => {
  it("takes one non-negative decimal integer, whitespace aside", () => {
    expect(parseLootRules("1\n")).toBe(1);
    expect(parseLootRules("  0  ")).toBe(0);
    expect(parseLootRules("12")).toBe(12);
  });

  it("refuses anything else — the bot gates on this number, so it is never a guess", () => {
    for (const bad of [null, "", "-1", "+1", "1.0", "1.5", "01", "1e3", "0x1", "one", "1\n2", "1\nX-Other: 1"]) {
      expect(parseLootRules(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseLootRules("9007199254740993")).toBeNull();
  });
});

describe("the loot-rules header's value per engine", () => {
  const files = new Map<string, string>();
  const read = (path: string): string | null => files.get(path) ?? null;
  const join2 = (...parts: string[]): string => parts.join("/");

  it("is the bundled engine's stamped level", () => {
    files.set(`/res/engine/${ENGINE_LOOT_RULES_FILE}`, "1\n");
    expect(engineLootRulesFor({ source: "bundled", root: "/res/engine" }, read, join2)).toBe(1);
  });

  it("is null — no header — for a bundled engine with no readable level (one older than the level)", () => {
    expect(engineLootRulesFor({ source: "bundled", root: "/elsewhere" }, read, join2)).toBeNull();
    files.set(`/bad/${ENGINE_LOOT_RULES_FILE}`, "level one");
    expect(engineLootRulesFor({ source: "bundled", root: "/bad" }, read, join2)).toBeNull();
  });

  it("is null for every engine that is not the bundled one — whatever level sits beside it", () => {
    files.set(`/dev/ao-loot-logger/${ENGINE_LOOT_RULES_FILE}`, "1\n");
    for (const source of ["sibling", "settings"]) {
      expect(engineLootRulesFor({ source, root: "/dev/ao-loot-logger" }, read, join2)).toBeNull();
    }
    expect(engineLootRulesFor(null, read, join2)).toBeNull();
  });

  it("travels with the commit as one stamp; the level never stands in for the commit, nor the commit for it", () => {
    files.set(`/both/${ENGINE_REF_FILE}`, `${SHA}\n`);
    files.set(`/both/${ENGINE_LOOT_RULES_FILE}`, "1\n");
    files.set(`/level-only/${ENGINE_LOOT_RULES_FILE}`, "1\n");
    files.set(`/ref-only/${ENGINE_REF_FILE}`, `${SHA}\n`);
    const stamp = (root: string, source = "bundled") => engineStampFor({ source, root }, read, join2);
    expect(stamp("/both")).toEqual({ ref: SHA, lootRules: 1 });
    expect(stamp("/level-only")).toEqual({ ref: UNKNOWN_ENGINE, lootRules: 1 });
    expect(stamp("/ref-only")).toEqual({ ref: SHA, lootRules: null });
    expect(stamp("/both", "sibling")).toEqual(DEV_STAMP);
    expect(DEV_STAMP).toEqual({ ref: DEV_ENGINE, lootRules: null });
  });
});

describe("a loot log carries the stamp of the engine that wrote it", () => {
  const bundled: TEngineStamp = { ref: SHA, lootRules: 1 };
  const dev: TEngineStamp = { ref: DEV_ENGINE, lootRules: null };

  it("is the stamp recorded when the log was named — not the engine running now", () => {
    const written = new Map([["/c/loot-events-old.txt", dev]]);
    // A bundled session re-sending the dev session's log: still the dev engine's lines.
    expect(stampForLootLog("/c/loot-events-old.txt", written, bundled)).toEqual(dev);
    written.set("/c/loot-events-new.txt", bundled);
    expect(stampForLootLog("/c/loot-events-new.txt", written, bundled)).toEqual(bundled);
  });

  it("vouches for no level on a log this app run never saw named, and is the session's with no log", () => {
    expect(stampForLootLog("/c/loot-events-unseen.txt", new Map(), bundled)).toEqual(UNVOUCHED_STAMP);
    expect(UNVOUCHED_STAMP).toEqual({ ref: UNKNOWN_ENGINE, lootRules: null });
    expect(stampForLootLog(null, new Map(), bundled)).toEqual(bundled);
  });
});

describe("the build stamps the engine's commit into the bundle (tools/prepare-engine-dist.mjs)", () => {
  const SCRIPT = join(__dirname, "..", "tools", "prepare-engine-dist.mjs");

  /** An engine checkout with what the script copies: package.json, src/index.js, node_modules/cap. */
  const engineCheckout = (git: boolean, lootRulesJs: string | null = null): string => {
    const root = mkdtempSync(join(tmpdir(), "gbc-engine-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "node_modules", "cap"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, "src", "index.js"), "\n");
    if (lootRulesJs != null) {
      writeFileSync(join(root, "src", "loot-rules.js"), lootRulesJs);
    }
    if (git) {
      // No user config, signing or hooks of this machine's may decide whether the test can commit.
      const run = (...args: string[]) =>
        execFileSync(
          "git",
          ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args],
          { cwd: root, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
        ).trim();
      run("init", "-q");
      run("add", "-A");
      run("commit", "-q", "--no-verify", "-m", "engine");
    }
    return root;
  };

  const prepare = (root: string, env: NodeJS.ProcessEnv = {}): { out: string; status: number } => {
    const out = join(mkdtempSync(join(tmpdir(), "gbc-engine-dist-")), "engine-dist");
    try {
      execFileSync(process.execPath, [SCRIPT, root, out], {
        stdio: "ignore",
        env: { ...process.env, GITHUB_ACTIONS: "", ...env },
      });
      return { out, status: 0 };
    } catch (err) {
      return { out, status: (err as { status?: number }).status ?? -1 };
    }
  };

  it("writes the checkout's HEAD as ENGINE_REF, which the app reads back", () => {
    const root = engineCheckout(true);
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const { out, status } = prepare(root);
    expect(status).toBe(0);
    expect(readFileSync(join(out, ENGINE_REF_FILE), "utf8")).toBe(`${head}\n`);
    expect(engineRefFor({ source: "bundled", root: out }, (p) => readFileSync(p, "utf8"), join)).toBe(head);
  });

  it("writes no stamp for a folder that is not its own checkout (locally) — never a parent repo's commit", () => {
    const { out, status } = prepare(engineCheckout(false));
    expect(status).toBe(0);
    expect(existsSync(join(out, "src", "index.js"))).toBe(true);
    expect(existsSync(join(out, ENGINE_REF_FILE))).toBe(false);
  });

  it("fails the build in CI rather than ship a bundle that cannot say which engine it is", () => {
    expect(prepare(engineCheckout(false), { GITHUB_ACTIONS: "true" }).status).toBe(2);
  });

  // The engine's own file, in the engine's own words (designsvet/ao-loot-logger src/loot-rules.js).
  const LEVEL_ONE = "// bumped by every change to which pickups are written\nmodule.exports = { LOOT_RULES: 1 }\n";

  it("writes the engine's loot-rules level as ENGINE_LOOT_RULES, which the app reads back", () => {
    const { out, status } = prepare(engineCheckout(true, LEVEL_ONE));
    expect(status).toBe(0);
    expect(readFileSync(join(out, ENGINE_LOOT_RULES_FILE), "utf8")).toBe("1\n");
    // Beside the commit, and inside the bundled engine as shipped: src/loot-rules.js travels too.
    expect(existsSync(join(out, ENGINE_REF_FILE))).toBe(true);
    expect(existsSync(join(out, "src", "loot-rules.js"))).toBe(true);
    const stamp = engineStampFor({ source: "bundled", root: out }, (p) => readFileSync(p, "utf8"), join);
    expect(stamp.lootRules).toBe(1);
  });

  it("is required from the engine, not pattern-matched — a level the engine computes is still its level", () => {
    const computed = "const base = 2;\nmodule.exports = { LOOT_RULES: base + 1 };\n";
    const { out, status } = prepare(engineCheckout(false, computed));
    expect(status).toBe(0);
    expect(readFileSync(join(out, ENGINE_LOOT_RULES_FILE), "utf8")).toBe("3\n");
  });

  it("writes no level for an engine older than it — and that is no failure, in CI either", () => {
    const local = prepare(engineCheckout(false));
    expect(local.status).toBe(0);
    expect(existsSync(join(local.out, ENGINE_LOOT_RULES_FILE))).toBe(false);
    // In CI the commit is readable, the level absent: the bundle is built, and build.yml's check on
    // the packed app is what refuses to ship it.
    const ci = prepare(engineCheckout(true), { GITHUB_ACTIONS: "true" });
    expect(ci.status).toBe(0);
    expect(existsSync(join(ci.out, ENGINE_REF_FILE))).toBe(true);
    expect(existsSync(join(ci.out, ENGINE_LOOT_RULES_FILE))).toBe(false);
  });

  it("refuses a level that is not a non-negative integer: no file locally, a failed build in CI", () => {
    for (const bad of [
      'module.exports = { LOOT_RULES: "1" };\n',
      "module.exports = { LOOT_RULES: -1 };\n",
      "module.exports = { LOOT_RULES: 1.5 };\n",
      "module.exports = {};\n",
      "throw new Error('broken');\n",
    ]) {
      const local = prepare(engineCheckout(false, bad));
      expect(local.status, bad).toBe(0);
      expect(existsSync(join(local.out, ENGINE_LOOT_RULES_FILE)), bad).toBe(false);
    }
    // In CI the commit must be readable first, or the missing commit is what fails it.
    for (const bad of ['module.exports = { LOOT_RULES: "1" };\n', "throw new Error('broken');\n"]) {
      expect(prepare(engineCheckout(true, bad), { GITHUB_ACTIONS: "true" }).status, bad).toBe(2);
    }
  }, 20_000);
});
