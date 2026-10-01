import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync as readSource } from "node:fs";
import {
  decoderVerdictFilePath,
  forgetDecoderVerdict,
  loadDecoderVerdict,
  saveDecoderVerdict,
} from "../src/main/decoderVerdict.js";

const LOOT = { handler: "EvOtherGrabbedLoot", failures: 5, calls: 5 };
const fresh = (): string => decoderVerdictFilePath(mkdtempSync(join(tmpdir(), "gbc-verdict-")));

describe("a broken decoder is remembered across restarts of the same version", () => {
  it("is broken from the first second when the same version reopens", () => {
    const file = fresh();
    expect(saveDecoderVerdict(file, "0.9.0", [LOOT])).toBe(true);
    expect(loadDecoderVerdict(file, "0.9.0")).toEqual({ broken: [LOOT], stale: false });
  });

  it("starts clean, and says the file is stale, once another version opens — the fix is a new version", () => {
    const file = fresh();
    saveDecoderVerdict(file, "0.9.0", [LOOT]);
    expect(loadDecoderVerdict(file, "0.9.1")).toEqual({ broken: null, stale: true });
    forgetDecoderVerdict(file);
    expect(existsSync(file)).toBe(false);
  });

  it("reads no file, a broken file and a foreign shape as nothing remembered", () => {
    const file = fresh();
    expect(loadDecoderVerdict(file, "0.9.0")).toEqual({ broken: null, stale: false });
    writeFileSync(file, "{not json");
    expect(loadDecoderVerdict(file, "0.9.0")).toEqual({ broken: null, stale: false });
    writeFileSync(file, JSON.stringify({ appVersion: "0.9.0", broken: [{ handler: 7 }] }));
    expect(loadDecoderVerdict(file, "0.9.0")).toEqual({ broken: null, stale: false });
  });

  it("writes through a temp file, leaving no temp behind", () => {
    const file = fresh();
    saveDecoderVerdict(file, "0.9.0", [LOOT]);
    expect(JSON.parse(readFileSync(file, "utf8")).appVersion).toBe("0.9.0");
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});

// The seeding is one block in main's start-up, which no unit reaches: it must run before the window
// and the IPC exist, or the first state the page sees is not yet broken.
describe("main starts from the remembered verdict", () => {
  it("loads the verdict before registering IPC and creating the window", () => {
    const main = readSource(join(__dirname, "..", "src", "main", "index.ts"), "utf8");
    const ready = main.indexOf("app.whenReady().then(() => {");
    const load = main.indexOf("loadDecoderVerdict(DECODER_VERDICT_FILE", ready);
    expect(load).toBeGreaterThan(ready);
    expect(load).toBeLessThan(main.indexOf("registerIpc();", ready));
    expect(main).toContain("saveDecoderVerdict(DECODER_VERDICT_FILE, app.getVersion(), state.engineBroken)");
  });
});
