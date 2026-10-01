/**
 * The title bar's one button changing between Start capture and Stop (board Fh1), decided apart
 * from how it is drawn. The old window's pill does this (src/renderer/styles.css `.primary`, the
 * README's "How it moves", docs/design-transition-study.html), and the owner asked for the same
 * here: the gold drains off the ember face beneath it and refills on the way back, the words roll
 * — the old ones out upward, then the new ones in from below — and the box eases to the new words'
 * width. StartStop.tsx draws it; shell.css (`.lb-act`) holds every duration.
 *
 * Pure — no DOM, no clock — so test/startStop.test.ts holds the rules without a window.
 */

import type { TStrings } from "../shared/strings.js";
import type { TBarAction } from "./model.js";

/** What the button says and how it looks: the words, and the face they are set on. */
export type TFace = {
  kind: TBarAction["kind"];
  look: TBarAction["look"];
  text: string;
};

export const actionFace = (action: TBarAction, s: TStrings): TFace => ({
  kind: action.kind,
  look: action.look,
  text: action.kind === "stop" ? s.shell.bar.stop : s.buttons.start,
});

/** A change of words, of face, or both — a theme does not change a face; a language does. */
export const sameFace = (a: TFace, b: TFace): boolean => a.kind === b.kind && a.look === b.look && a.text === b.text;

/** A face in the button, with an id that stays with it from arriving to leaving (its React key). */
export type TRollFace = { id: number; face: TFace };

/**
 * The words in the button: the face that is there (arriving, or at rest) and the one on its way
 * out. Two at most — the old window's counter learned that rolling off a face that is itself still
 * leaving stacks them side by side.
 */
export type TRoll = {
  current: TRollFace;
  leaving: TRollFace | null;
  /** The current face came by a change, so it rolls in; the first face is simply there. */
  arrived: boolean;
  /** The current face has begun to show: its roll-in is past the wait for the old words to leave. */
  shown: boolean;
};

export const restingRoll = (face: TFace): TRoll => ({ current: { id: 0, face }, leaving: null, arrived: false, shown: true });

/**
 * The next words. Under reduced motion the new face is simply there. Otherwise the current face
 * leaves and the new one arrives — unless the current one never began to show (a state that came
 * and went inside the old words' 170 ms, Start pressed and the engine failing at once): rolling
 * out words nobody saw would flash them, so they are dropped and the face already leaving goes on.
 */
export const rollTo = (roll: TRoll, face: TFace, reduced: boolean): TRoll => {
  if (sameFace(roll.current.face, face)) {
    return roll;
  }
  const id = Math.max(roll.current.id, roll.leaving?.id ?? 0) + 1;
  if (reduced) {
    return { current: { id, face }, leaving: null, arrived: false, shown: true };
  }
  return { current: { id, face }, leaving: roll.shown ? roll.current : roll.leaving, arrived: true, shown: false };
};

/** The arriving face's roll-in has started (its `animationstart`, after the wait). */
export const rollShown = (roll: TRoll, id: number): TRoll => (roll.current.id === id && !roll.shown ? { ...roll, shown: true } : roll);

/** The leaving face has gone (its `animationend`). An id that is not leaving any more changes nothing. */
export const rollLeft = (roll: TRoll, id: number): TRoll => (roll.leaving?.id === id ? { ...roll, leaving: null } : roll);

/**
 * How the box eases to the new words' width, so nothing in the bar jumps — and so the words never
 * stand outside the box that is drawn around them: a wider face makes its room first, while the old
 * words leave, and its words arrive into it; a narrower one waits for the old words to go, then
 * closes in with the new ones (shell.css `.lb-act[data-ease]`). Under half a pixel is no change.
 */
export type TWidthEase = "grow" | "shrink";

export const widthEase = (from: number, to: number): TWidthEase | null => {
  if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) < 0.5) {
    return null;
  }
  return to > from ? "grow" : "shrink";
};

/**
 * The surface over the ember face: gold for the window's one primary action, lifted for the neutral
 * Start of the error state. While the button is Stop it keeps the last Start's surface — drained off
 * and out of sight — so the wipe back retraces the surface that left. A Start that comes back on the
 * other surface (Stop to the error state) refills with its own.
 */
export type TSurface = "gold" | "lift";

export const topSurface = (face: TFace, last: TSurface): TSurface => {
  if (face.kind !== "start") {
    return last;
  }
  return face.look === "primary" ? "gold" : "lift";
};
