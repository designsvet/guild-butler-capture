import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { talksToBot } from "../src/main/botFacing.js";

const MAIN = readFileSync(join(__dirname, "..", "src", "main", "index.ts"), "utf8");

describe("the mock engine never talks to the bot", () => {
  it("lets every real engine through and stops the mock", () => {
    expect(talksToBot("bundled")).toBe(true);
    expect(talksToBot("settings")).toBe(true);
    expect(talksToBot("sibling")).toBe(true);
    expect(talksToBot(null)).toBe(true);
    expect(talksToBot("mock")).toBe(false);
  });

  // The guard is two call sites in main, which no unit reaches: hold them in the source, so a
  // refactor that drops one fails here rather than uploading invented loot from a paired computer.
  it("starts the upload loop only behind the guard", () => {
    const calls = MAIN.split("startUploadLoop();").length - 1;
    expect(calls).toBe(1);
    expect(MAIN).toMatch(/if \(talksToBot\(engine\.source\)\) \{\s*startUploadLoop\(\);/);
  });

  // Stopping a capture runs one last upload pass for the session's tail: the mock's tail is invented too.
  it("runs the closing upload pass only for an engine that talks to the bot", () => {
    const stop = MAIN.slice(MAIN.indexOf("const stopUploadLoop"), MAIN.indexOf("};", MAIN.indexOf("const stopUploadLoop")));
    const guard = stop.indexOf("if (!talksToBot(currentEngine?.source))");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(stop.indexOf(".tick()"));
  });

  it("forwards nothing to the bot unless the engine talks to it", () => {
    for (const fn of ["forwardEngineHealth(fresh)", "forwardFestivities(ev.event)", "forwardEnergy(ev.event)", "forwardEnergyLog(ev.event)"]) {
      const at = MAIN.indexOf(fn);
      expect(at, fn).toBeGreaterThan(-1);
      const line = MAIN.slice(MAIN.lastIndexOf("\n", MAIN.lastIndexOf("if (", at)), at);
      expect(line, fn).toContain("toBot &&");
    }
  });
});
