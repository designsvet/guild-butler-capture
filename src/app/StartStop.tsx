import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type TransitionEvent } from "react";

import { cssTimeMs, prefersReducedMotion } from "@guild-butler/design-system/react";

import type { TStrings } from "../shared/strings.js";
import { Icon, PLAY } from "./icons.js";
import type { TBarAction } from "./model.js";
import { actionFace, restingRoll, rollLeft, rollShown, rollTo, topSurface, widthEase, type TFace, type TRoll } from "./morph.js";

/**
 * The title bar's one button (board Fh1), changing between Start capture and Stop the way the old
 * window's pill does (src/renderer/styles.css `.primary`; the rules are src/app/morph.ts). One
 * button, never two that swap, built in layers, each for a reason the old pill found:
 *
 * - the EMBER face (Stop's danger outline) is underneath all the time;
 * - the SURFACE over it — gold, or lifted for the error state's neutral Start — drains off it, left
 *   to right, and refills from the right on the way back. A cross-fade was the obvious move and it
 *   was wrong: a bright gradient dissolving into a dark outline passes through a muddy middle;
 * - a SHIMMER crosses it while the logger starts or stops — waiting that looks like working — over a
 *   Stop that is dimmed and refuses the press, as Fh1 draws it;
 * - the WORDS: the old ones roll out upward and the new ones in from below, and the box eases to
 *   the new words' width. They are drawn twice — on the ember, and inside the surface, cut by its
 *   edge — so each word is in the ink of the surface it is on, all through the drain.
 *
 * Every duration is a `--lb-t-*` in shell.css, and the sequence is CSS alone — the words' wait, the
 * drain, the width — so nothing here keeps time: it reacts to the browser's animation events.
 * That is also what lets tools/shell-shots.cjs stop the morph at any millisecond and photograph it.
 * Under reduced motion every duration is zero (base.css) and the end states are the same.
 *
 * The refusal is `aria-disabled`, not `disabled`: a disabled button drops the keyboard's focus, and
 * Start pressed from the keyboard would leave the member nowhere while the logger starts.
 */

/**
 * The box's width as laid out — mid-ease, where the ease has got to. Not getBoundingClientRect: that
 * counts the squash's scale, and an ease that started from a squashed width would end in a jump.
 */
const boxWidth = (el: HTMLElement): number => parseFloat(getComputedStyle(el).width);

/** The button's padding either side — the words' width plus this is the button's (it has no border: the layers draw it). */
const inlinePadding = (el: HTMLElement): number => {
  const style = getComputedStyle(el);
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
};

/** The words on one face: Start's play icon, or Stop's small square, then the label. */
const Words = ({ face }: { face: TFace }) => (
  <>
    {face.kind === "stop" ? <span className="lb-stop-mark" aria-hidden="true" /> : <Icon paths={PLAY} />}
    <span className="lb-act-label">{face.text}</span>
  </>
);

/**
 * The words: the face on its way out (upward, out of the accessibility tree) and the face that is
 * there — arriving from below once the other has gone, or at rest. Drawn twice by the button, in
 * the same place; only the first copy listens to its animations.
 */
const Faces = ({
  roll,
  onAnimationStart,
  onAnimationEnd,
}: {
  roll: TRoll;
  onAnimationStart?: (event: AnimationEvent<HTMLSpanElement>) => void;
  onAnimationEnd?: (event: AnimationEvent<HTMLSpanElement>) => void;
}) => (
  <span className="lb-act-words">
    {roll.leaving != null ? (
      <span
        key={roll.leaving.id}
        className="lb-act-face is-leaving"
        data-face-id={roll.leaving.id}
        aria-hidden="true"
        onAnimationEnd={onAnimationEnd}
      >
        <Words face={roll.leaving.face} />
      </span>
    ) : null}
    <span
      key={roll.current.id}
      className={`lb-act-face${roll.arrived ? " is-arriving" : ""}`}
      data-face-id={roll.current.id}
      onAnimationStart={onAnimationStart}
    >
      <Words face={roll.current.face} />
    </span>
  </span>
);

export const StartStop = ({
  action,
  s,
  onStart,
  onStop,
}: {
  action: TBarAction;
  s: TStrings;
  onStart: () => void;
  onStop: () => void;
}) => {
  const face = actionFace(action, s);
  const [roll, setRoll] = useState<TRoll>(() => restingRoll(face));
  const [surface, setSurface] = useState(() => topSurface(face, "gold"));
  const [squash, setSquash] = useState({ kind: face.kind, plays: 0 });
  // Derived from the props as they change (React's "adjusting state while rendering"): the change
  // and its new face land in the same commit, so the old words never draw on the new face.
  const nextRoll = rollTo(roll, face, prefersReducedMotion());
  if (nextRoll !== roll) {
    setRoll(nextRoll);
  }
  const nextSurface = topSurface(face, surface);
  if (nextSurface !== surface) {
    setSurface(nextSurface);
  }
  // The squash plays once per change between Start and Stop: a material change you can feel. Two
  // names for one keyframe, alternated, so each change restarts it (shell.css `lb-squash-*`).
  if (squash.kind !== face.kind) {
    setSquash({ kind: face.kind, plays: squash.plays + 1 });
  }

  const button = useRef<HTMLButtonElement>(null);
  const easedFor = useRef(roll.current.id);

  // The width: from where the box is to the new words' own width, timed by shell.css for growing or
  // shrinking. Before paint, so the box is never drawn at the new width first. Where the box is: an
  // ease still playing holds it at some width on the way; at rest it is the old words' width, which
  // the leaving words still have (they are laid out at their own width, out of the flow).
  useLayoutEffect(() => {
    const el = button.current;
    if (el == null || easedFor.current === roll.current.id) {
      return;
    }
    easedFor.current = roll.current.id;
    const old = el.querySelector<HTMLElement>(":scope > .lb-act-words > .is-leaving");
    const from = el.style.width !== "" ? boxWidth(el) : old != null ? boxWidth(old) + inlinePadding(el) : null;
    el.style.width = "";
    delete el.dataset.ease;
    const to = boxWidth(el);
    const ease = from == null || prefersReducedMotion() ? null : widthEase(from, to);
    if (ease == null || from == null) {
      return;
    }
    el.dataset.ease = ease;
    el.style.width = `${from}px`;
    // the start of the ease, committed to style before the end is set
    boxWidth(el);
    el.style.width = `${to}px`;
  }, [roll.current.id]);

  // The ease is over: the box goes back to its own width, which is the one it eased to.
  const onTransitionEnd = (event: TransitionEvent<HTMLButtonElement>): void => {
    const el = event.currentTarget;
    if (event.target === el && event.propertyName === "width") {
      el.style.width = "";
      delete el.dataset.ease;
    }
  };

  // An animation the page takes away halfway — the Motion setting or the system's flipped while it
  // played — ends nothing: settle the words as if it had.
  useEffect(() => {
    const el = button.current;
    if (el == null) {
      return;
    }
    const onCancel = (event: globalThis.AnimationEvent): void => {
      const id = Number((event.target as HTMLElement).dataset.faceId);
      if (event.animationName === "lb-roll-out") {
        setRoll((r) => rollLeft(r, id));
      } else if (event.animationName === "lb-roll-in") {
        setRoll((r) => rollShown(r, id));
      }
    };
    el.addEventListener("animationcancel", onCancel);
    return () => {
      el.removeEventListener("animationcancel", onCancel);
    };
  }, []);

  // The old window's .settle: when the logger has started or stopped under a resting pointer, the
  // NEW face's hover does not light the instant it lands — it read as a flicker.
  const [settling, setSettling] = useState(false);
  const wasBusy = useRef(action.disabled);
  useEffect(() => {
    const landed = wasBusy.current && !action.disabled;
    wasBusy.current = action.disabled;
    const el = button.current;
    if (!landed || el == null) {
      // busy again before the grace ran out (its timer is cleared below): no hover to hold off now
      setSettling(false);
      return;
    }
    setSettling(true);
    const timer = window.setTimeout(
      () => {
        setSettling(false);
      },
      cssTimeMs(getComputedStyle(el).getPropertyValue("--lb-t-settle")) || 0,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [action.disabled]);

  const onAnimationStart = (event: AnimationEvent<HTMLSpanElement>): void => {
    if (event.animationName === "lb-roll-in") {
      const id = Number(event.currentTarget.dataset.faceId);
      setRoll((r) => rollShown(r, id));
    }
  };
  const onAnimationEnd = (event: AnimationEvent<HTMLSpanElement>): void => {
    if (event.animationName === "lb-roll-out") {
      const id = Number(event.currentTarget.dataset.faceId);
      setRoll((r) => rollLeft(r, id));
    }
  };

  return (
    <button
      ref={button}
      type="button"
      className={`gbtn lb-act${settling ? " is-settling" : ""}`}
      data-kind={face.kind}
      data-surface={surface}
      data-squash={squash.plays === 0 ? undefined : squash.plays % 2 === 1 ? "a" : "b"}
      aria-disabled={action.disabled ? true : undefined}
      onClick={() => {
        // aria-disabled refuses nothing by itself: the press is refused here, mouse and keyboard
        if (action.disabled) {
          return;
        }
        if (face.kind === "start") {
          onStart();
        } else {
          onStop();
        }
      }}
      onTransitionEnd={onTransitionEnd}
    >
      <span className="lb-act-layer lb-act-ember" aria-hidden="true" />
      {/* The words on the ember: the button's name, and its width. Their events drive the roll. */}
      <Faces roll={roll} onAnimationStart={onAnimationStart} onAnimationEnd={onAnimationEnd} />
      {/* The surface, with the same words again inside it, cut by the same edge: wherever the
          surface is, the words are in its ink, and wherever it has drained, in the ember's — so
          they read in every frame. One set of words in one colour crossing both surfaces was the
          old pill's muddy middle again, words half lost on whichever surface they did not suit. */}
      <span className="lb-act-layer lb-act-top" aria-hidden="true">
        <Faces roll={roll} />
      </span>
      <span className="lb-act-layer lb-act-shimmer" aria-hidden="true" />
    </button>
  );
};
