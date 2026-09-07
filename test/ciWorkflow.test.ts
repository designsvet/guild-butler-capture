import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards on the workflow files themselves.
 *
 * `build.yml` has cited "House rule (test/ciWorkflow.test.ts)" since the pipeline
 * was written, and this file did not exist — the rule was enforced by a comment
 * pointing at nothing. That is the same shape as the defects this repo keeps
 * paying for: a claimed guard that compiles, reads convincingly, and checks
 * nothing.
 *
 * Everything asserted here is config, and config has no failure mode until the
 * release it breaks. A mutable action ref keeps working right up until someone
 * repoints it (CVE-2025-30066, where a stolen token moved existing version tags
 * and every repo tracking the tag ran the payload). So these are ratchets, not
 * style rules.
 */
const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");
const read = (name: string): string => readFileSync(join(WORKFLOWS, `${name}.yml`), "utf8");

/** `uses:` refs, minus the local (`./`) and docker (`docker://`) forms. */
const usesRefs = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)]
    .map((m) => m[1] ?? "")
    .filter((ref) => !ref.startsWith("./") && !ref.startsWith("docker://"));

const isFirstParty = (ref: string): boolean => ref.startsWith("actions/");
const isShaPinned = (ref: string): boolean => /@[0-9a-f]{40}$/.test(ref);

describe("workflow supply chain", () => {
  it("pins every third-party action to a full commit SHA", () => {
    // actions/* is GitHub's own and deliberately left on version tags — a
    // decision, not an oversight. Everything else is somebody else's account.
    for (const name of ["build", "ci"]) {
      const unpinned = usesRefs(read(name)).filter((r) => !isFirstParty(r) && !isShaPinned(r));
      expect(unpinned, `${name}.yml has unpinned third-party actions`).toEqual([]);
    }
  });

  it("pins the engine checkout to a commit SHA, never a branch", () => {
    // The engine is patched and compiled INTO the shipped installer, so a
    // mutable ref here is the largest unpinned dependency in the pipeline —
    // and it is not an action, which is why an action-only audit misses it.
    const build = read("build");
    const refs = [...build.matchAll(/ref:\s*\$\{\{\s*inputs\.engine_ref\s*\|\|\s*'([^']+)'/g)].map((m) => m[1] ?? "");
    expect(refs.length, "expected the engine checkout in both jobs").toBe(2);
    for (const ref of refs) {
      expect(ref, "engine ref must be a 40-char SHA").toMatch(/^[0-9a-f]{40}$/);
    }
    expect(new Set(refs).size, "both jobs must build the same engine commit").toBe(1);
  });
});

describe("workflow permissions", () => {
  it("build.yml denies by default and grants per job", () => {
    const build = read("build");
    // Top-level `{}` means a job added later inherits nothing.
    expect(build).toMatch(/^permissions:\s*\{\}\s*$/m);
    // ...and exactly the two publishing jobs opt back in.
    const grants = [...build.matchAll(/^\s{4}permissions:\n\s{6}contents:\s*write\s*$/gm)];
    expect(grants.length, "only build and macos may hold contents: write").toBe(2);
  });

  it("ci.yml is read-only", () => {
    expect(read("ci")).toMatch(/^permissions:\n\s+contents:\s*read\s*$/m);
  });
});

describe("workflow house rules", () => {
  it("sets up pnpm before node, so setup-node can cache pnpm's store", () => {
    // The rule build.yml's comment has always claimed. Reversed, `cache: pnpm`
    // fails on a runner with no pnpm on PATH.
    for (const name of ["build", "ci"]) {
      const yaml = read(name);
      const refs = usesRefs(yaml);
      const pnpm = refs.findIndex((r) => r.startsWith("pnpm/action-setup@"));
      const node = refs.findIndex((r) => r.startsWith("actions/setup-node@"));
      expect(pnpm, `${name}.yml: pnpm/action-setup missing`).toBeGreaterThanOrEqual(0);
      expect(node, `${name}.yml: actions/setup-node missing`).toBeGreaterThanOrEqual(0);
      expect(pnpm, `${name}.yml: pnpm/action-setup must come first`).toBeLessThan(node);
    }
  });
});
