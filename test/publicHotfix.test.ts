import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
const step = workflow.split("      - name: Decide the release tag\n")[1]?.split("      - name:")[0];
const script = step?.split("        run: |\n")[1]?.replace(/^          /gm, "");
if (script == null) throw new Error("release decision script missing");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;

// Execute the workflow's actual decision script. No publishing step is run.
const decide = (event: string, ref: string, requested: string) => {
  const directory = mkdtempSync(join(tmpdir(), "capture-release-gate-"));
  const output = join(directory, "output");
  try {
    const result = spawnSync("bash", ["-c", script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, EVENT: event, REF: ref, REQUESTED: requested, GITHUB_OUTPUT: output },
    });
    let values = "";
    try {
      values = readFileSync(output, "utf8");
    } catch {
      // Build-only and refused decisions write no release outputs.
    }
    return { status: result.status, values, stdout: result.stdout };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("the public maintenance release gate", () => {
  it.each([
    ["pull_request", "refs/pull/1/merge"],
    ["push", "refs/heads/release/0.8.x"],
    ["push", "refs/heads/main"],
    ["workflow_dispatch", "refs/heads/release/0.8.x"],
  ])("%s on %s with no version is build-only", (event, ref) => {
    const result = decide(event, ref, "");
    expect(result.status).toBe(0);
    expect(result.values).toBe("");
  });

  it.each([
    ["pull_request", "refs/heads/release/0.8.x"],
    ["workflow_dispatch", "refs/heads/main"],
    ["workflow_dispatch", "refs/heads/fix/public-october-protocol"],
  ])("refuses a requested release from %s on %s", (event, ref) => {
    expect(decide(event, ref, version).status).not.toBe(0);
  });

  it("refuses a version different from the bytes being packaged", () => {
    expect(decide("workflow_dispatch", "refs/heads/release/0.8.x", "999.0.0").status).not.toBe(0);
  });

  it("explicit maintenance dispatch selects the exact reviewed version", () => {
    const result = decide("workflow_dispatch", "refs/heads/release/0.8.x", version);
    expect(result.status).toBe(0);
    expect(result.values).toBe(`version=${version}\ntag=v${version}\n`);
  });
});
