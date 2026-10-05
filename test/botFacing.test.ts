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
    expect(talksToBot("replay")).toBe(false);
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

/** The body of the `const name = …` arrow in main, up to its closing `};` at the start of a line. */
const body = (name: string): string => {
  const at = MAIN.indexOf(`const ${name} = `);
  expect(at, name).toBeGreaterThan(-1);
  return MAIN.slice(at, MAIN.indexOf("\n};", at));
};

describe("trades reach the bot only from a real engine, and only under the v5 flag", () => {
  // raid-bot ADR 0168: the trade journal is new, so it is behind the v5 shell's flag (heldUploadOn)
  // as everything new is — and a 0.8.x old-window release must neither write nor send a trade.

  it("decides at Start, inside the loot loop's start — so behind the same talksToBot guard", () => {
    const start = body("startUploadLoop");
    expect(start).toMatch(
      /tradesOn = heldUploadOn\(\);\s*if \(tradesOn\) \{[^}]*?logFileAtStart = state\.logFile;\s*ensureTradeUploader\(\)\.resetSession\(\);/,
    );
    // …and startUploadLoop itself runs only behind talksToBot (the test above).
  });

  it("follows this session's journal only — the loot log main named at Start is the last session's", () => {
    // tradeFileThisSession is tested in tradeUpload.test.ts; this holds main to calling it with the
    // snapshot startUploadLoop takes (above), so a new session cannot re-send the last one's trades.
    expect(body("ensureTradeUploader")).toMatch(/currentFile: \(\) => tradeFileThisSession\(state\.logFile, logFileAtStart\),/);
  });

  it("ticks the trade uploader only while tradesOn — every call site", () => {
    const calls = [...MAIN.matchAll(/ensureTradeUploader\(\)/g)].map((m) => m.index ?? 0);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const at of calls) {
      const guard = MAIN.slice(MAIN.lastIndexOf("if (", at), at);
      expect(guard, MAIN.slice(at - 120, at)).toMatch(/^if \((toBot && )?tradesOn\b/);
    }
  });

  it("asks the engine for the journal only under the flag", () => {
    expect(body("engineEnv")).toMatch(/withTradeEvents\(\{ \.\.\.process\.env, ELECTRON_RUN_AS_NODE: "1" \}, heldUploadOn\(\)\)/);
  });

  it("closes the session's tail for trades only behind the same guard as loot", () => {
    const stop = body("stopUploadLoop");
    const guard = stop.indexOf("if (!talksToBot(currentEngine?.source))");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(stop.indexOf("ensureTradeUploader()"));
  });

  it("keeps ONE held-ranges store for both uploaders — two over one file write over each other", () => {
    expect(MAIN.split("createHeldStore(").length - 1).toBe(1);
    expect(MAIN.split("holds: heldRanges(),").length - 1).toBe(2);
  });
});
