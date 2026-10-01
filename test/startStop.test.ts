import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { barAction } from "../src/app/model.js";
import {
  actionFace,
  restingRoll,
  rollLeft,
  rollShown,
  rollTo,
  sameFace,
  topSurface,
  widthEase,
  type TFace,
} from "../src/app/morph.js";
import { ECaptureStatus, initialCaptureState, type TCaptureState } from "../src/shared/captureTypes.js";
import { stringsFor } from "../src/shared/strings.js";

/**
 * The title bar's Start/Stop changing face (src/app/morph.ts; StartStop.tsx draws it): which face
 * each state shows, how the words roll when it changes — never more than two at once, never words
 * nobody saw rolled out — how the box eases to the new width, and which surface drains off the
 * ember. The motion itself is measured on the built page by tools/shell-layout-check.cjs; the
 * timings are held to the old window's here, since keeping its rhythm is the point.
 */

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const state = (status: ECaptureStatus): TCaptureState => ({ ...initialCaptureState, status });
const faceIn = (status: ECaptureStatus, lang: Parameters<typeof stringsFor>[0] = "en"): TFace => {
  const action = barAction(state(status));
  if (action == null) {
    throw new Error("no action");
  }
  return actionFace(action, stringsFor(lang));
};

const START = faceIn(ECaptureStatus.Idle);
const STOP = faceIn(ECaptureStatus.Waiting);
const NEUTRAL = faceIn(ECaptureStatus.Error);

describe("actionFace: the button's words and face in each state (Fh1)", () => {
  it("is gold Start capture when idle, neutral Start capture in the error state, Stop otherwise", () => {
    expect(START).toEqual({ kind: "start", look: "primary", text: "Start capture" });
    expect(NEUTRAL).toEqual({ kind: "start", look: "neutral", text: "Start capture" });
    for (const status of [ECaptureStatus.Starting, ECaptureStatus.Waiting, ECaptureStatus.Capturing, ECaptureStatus.Restarting, ECaptureStatus.Stopping]) {
      expect(faceIn(status)).toEqual({ kind: "stop", look: "danger", text: "Stop" });
    }
  });

  it("starting and stopping keep Stop's words: the refusal is the dimming, not a different label", () => {
    expect(sameFace(faceIn(ECaptureStatus.Starting), faceIn(ECaptureStatus.Capturing))).toBe(true);
    expect(sameFace(faceIn(ECaptureStatus.Stopping), faceIn(ECaptureStatus.Waiting))).toBe(true);
  });

  it("takes the words from the catalog, in the window's language", () => {
    expect(faceIn(ECaptureStatus.Idle, "de").text).toBe(stringsFor("de").buttons.start);
    expect(faceIn(ECaptureStatus.Capturing, "uk").text).toBe(stringsFor("uk").shell.bar.stop);
    expect(sameFace(faceIn(ECaptureStatus.Idle, "de"), START)).toBe(false);
  });
});

describe("rollTo: the words when the face changes", () => {
  it("does nothing when nothing changed — the clock re-renders the bar every second", () => {
    const roll = restingRoll(START);
    expect(rollTo(roll, { ...START }, false)).toBe(roll);
  });

  it("the first face is simply there: it does not roll in on the window's first paint", () => {
    expect(restingRoll(START)).toEqual({ current: { id: 0, face: START }, leaving: null, arrived: false, shown: true });
  });

  it("a change: the old face leaves with its id, the new one arrives under a new id and is not shown yet", () => {
    const next = rollTo(restingRoll(START), STOP, false);
    expect(next).toEqual({ current: { id: 1, face: STOP }, leaving: { id: 0, face: START }, arrived: true, shown: false });
  });

  it("under reduced motion the new face is simply there, with nothing leaving", () => {
    expect(rollTo(restingRoll(START), STOP, true)).toEqual({ current: { id: 1, face: STOP }, leaving: null, arrived: false, shown: true });
  });

  it("words nobody saw are not rolled out: a change inside the old words' exit drops them, the old words go on leaving", () => {
    // Start pressed, and the engine fails before Stop has begun to show
    const pressed = rollTo(restingRoll(START), STOP, false);
    const failed = rollTo(pressed, NEUTRAL, false);
    expect(failed.leaving).toEqual({ id: 0, face: START });
    expect(failed.current).toEqual({ id: 2, face: NEUTRAL });
    expect(failed.shown).toBe(false);
  });

  it("once the new words have begun to show, they are what leaves next — never more than two faces at once", () => {
    const pressed = rollShown(rollTo(restingRoll(START), STOP, false), 1);
    expect(pressed.shown).toBe(true);
    const failed = rollTo(pressed, NEUTRAL, false);
    expect(failed.leaving).toEqual({ id: 1, face: STOP });
    expect(failed.current.id).toBe(2);
  });

  it("ids only grow, so a React key never names two faces", () => {
    let roll = restingRoll(START);
    const seen = new Set<number>([roll.current.id]);
    for (const face of [STOP, START, STOP, NEUTRAL, STOP, START]) {
      roll = rollShown(rollTo(roll, face, false), roll.current.id + 1);
      expect(seen.has(roll.current.id)).toBe(false);
      seen.add(roll.current.id);
    }
  });
});

describe("rollShown / rollLeft: the browser's animation events", () => {
  it("mark the arriving face shown, and take the leaving one away — for their own id only", () => {
    const roll = rollTo(restingRoll(START), STOP, false);
    expect(rollShown(roll, 0)).toBe(roll);
    expect(rollShown(roll, 1).shown).toBe(true);
    expect(rollLeft(roll, 1)).toBe(roll);
    expect(rollLeft(roll, 0).leaving).toBeNull();
  });

  it("an event that arrives late, for a face already replaced, changes nothing", () => {
    const roll = rollTo(rollShown(rollTo(restingRoll(START), STOP, false), 1), START, false);
    expect(rollLeft(roll, 0)).toBe(roll); // face 0 was dropped when face 1 began to leave
    expect(rollShown(roll, 1)).toBe(roll);
  });
});

describe("widthEase: the box between two widths", () => {
  it("grows to a wider face, shrinks to a narrower one", () => {
    expect(widthEase(73, 133)).toBe("grow");
    expect(widthEase(133, 73)).toBe("shrink");
  });

  it("under half a pixel is no change, and a width it could not read is none either", () => {
    expect(widthEase(133.1, 133.4)).toBeNull();
    expect(widthEase(Number.NaN, 133)).toBeNull();
    expect(widthEase(73, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("topSurface: what drains off the ember", () => {
  it("is gold over the window's one primary Start, lifted over the error state's neutral one", () => {
    expect(topSurface(START, "lift")).toBe("gold");
    expect(topSurface(NEUTRAL, "gold")).toBe("lift");
  });

  it("while Stop shows, keeps the surface that drained off — the way back retraces it", () => {
    expect(topSurface(STOP, "gold")).toBe("gold");
    expect(topSurface(STOP, "lift")).toBe("lift");
  });

  it("idle → starting → error: the gold drains, and the neutral surface refills", () => {
    let surface = topSurface(START, "gold");
    surface = topSurface(faceIn(ECaptureStatus.Starting), surface);
    expect(surface).toBe("gold");
    expect(topSurface(NEUTRAL, surface)).toBe("lift");
  });
});

describe("the morph keeps the old window's rhythm", () => {
  const ROOT = ROOT_DIR;
  const declared = (file: string): Map<string, string> => {
    const out = new Map<string, string>();
    postcss.parse(readFileSync(join(ROOT, file), "utf8")).walkDecls(/^--/, (decl) => {
      if (!out.has(decl.prop)) {
        out.set(decl.prop, decl.value.replace(/\s+/g, ""));
      }
    });
    return out;
  };
  const shell = declared("src/app/shell.css");
  const old = declared("src/renderer/styles.css");
  const oldCss = readFileSync(join(ROOT, "src", "renderer", "styles.css"), "utf8");

  it("the words leave, arrive and the surface drains in the old window's times (--gb-t-out / -in / -morph)", () => {
    expect(shell.get("--lb-t-out")).toBe(old.get("--gb-t-out"));
    expect(shell.get("--lb-t-in")).toBe(old.get("--gb-t-in"));
    expect(shell.get("--lb-t-morph")).toBe(old.get("--gb-t-morph"));
    expect(shell.get("--lb-t-morph")).toBe("440ms");
  });

  it("the drain's curve and the sheen's lap are the old pill's", () => {
    const drain = /\.pill-gold\s*\{[^}]*transition:\s*clip-path\s+var\(--gb-t-morph\)\s+(cubic-bezier\([^)]*\))/.exec(oldCss)?.[1];
    expect(drain?.replace(/\s+/g, "")).toBe(shell.get("--lb-ease-morph"));
    const lap = /animation:\s*pill-shimmer\s+([\d.]+)s/.exec(oldCss)?.[1];
    expect(`${Number(lap) * 1000}ms`).toBe(shell.get("--lb-t-shimmer"));
  });

  it("the hover grace after the logger lands is the old window's", () => {
    const renderer = readFileSync(join(ROOT, "src", "renderer", "renderer.ts"), "utf8");
    const settle = /const PRIMARY_SETTLE_MS = (\d+);/.exec(renderer)?.[1];
    expect(`${settle}ms`).toBe(shell.get("--lb-t-settle"));
  });
});
