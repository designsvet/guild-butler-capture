import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEV_ENGINE, ENGINE_REF_FILE, engineRefFor, parseEngineRef, UNKNOWN_ENGINE } from "../src/main/engineRef.js";

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

describe("the build stamps the engine's commit into the bundle (tools/prepare-engine-dist.mjs)", () => {
  const SCRIPT = join(__dirname, "..", "tools", "prepare-engine-dist.mjs");

  /** An engine checkout with what the script copies: package.json, src/index.js, node_modules/cap. */
  const engineCheckout = (git: boolean): string => {
    const root = mkdtempSync(join(tmpdir(), "gbc-engine-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "node_modules", "cap"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, "src", "index.js"), "\n");
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
});
