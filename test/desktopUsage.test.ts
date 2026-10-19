import { describe, expect, it } from "vitest";
import { createUsageClock, desktopReportingAllowed } from "../src/main/desktopUsage.js";

describe("desktop elapsed time", () => {
  it("separates app, foreground and capture durations at transition boundaries", () => {
    let time = 0;
    const clock = createUsageClock(() => time);
    clock.activity({ capture: true, foreground: true });
    time = 12_000;
    clock.activity({ capture: true, foreground: false });
    time = 30_000;
    clock.activity({ capture: false, foreground: false });
    time = 50_000;
    clock.sample();
    expect(clock.totals()).toEqual({ appSeconds: 50, captureSeconds: 30, foregroundSeconds: 12 });
  });
  it("rejects sleep/stall gaps, clock reversal and explicitly suspended time", () => {
    let time = 0;
    const clock = createUsageClock(() => time);
    clock.activity({ capture: true, foreground: true });
    time = 30_000; clock.sample();
    time += 8 * 3_600_000; clock.sample();
    time += 10_000; clock.pause();
    time += 20_000; clock.sample();
    clock.resume();
    time -= 10_000; clock.sample();
    time += 5_000; clock.sample();
    expect(clock.totals().appSeconds).toBe(45);
  });
  it("keeps fractional samples until they form a second", () => {
    let time = 0;
    const clock = createUsageClock(() => time);
    for (let i = 0; i < 10; i++) { time += 150; clock.sample(); }
    expect(clock.totals().appSeconds).toBe(1);
  });
});

it("cannot report development, mock, replay or explicitly disabled sessions", () => {
  expect(desktopReportingAllowed(true, {}, "bundled")).toBe(true);
  for (const source of ["mock", "replay"]) expect(desktopReportingAllowed(true, {}, source)).toBe(false);
  for (const env of [{ GBC_MOCK_ENGINE: "1" }, { GBC_REPLAY: "file" }, { GBC_REPLAY_DIR: "recording" }, { GBC_NO_TELEMETRY: "1" }]) expect(desktopReportingAllowed(true, env)).toBe(false);
  expect(desktopReportingAllowed(false, {}, "bundled")).toBe(false);
});
