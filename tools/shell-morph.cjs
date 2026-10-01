/**
 * The title bar's Start/Stop changing face (src/app/StartStop.tsx), held still at any millisecond —
 * for tools/shell-shots.cjs (frames of it, and the strip) and tools/shell-layout-check.cjs (does it
 * fit at every one of them). Both drive the built page behind the stub bridge, which forces reduced
 * motion for every other picture; these turn motion back on in one window and play a change through
 * the bridge as main would push it.
 *
 * Nothing here keeps time against the page. The morph is CSS alone — the words' wait, the drain, the
 * width — so the moment the button changes, every animation in it is stopped at its start, and a
 * frame is those same animations sought to `t`. Forwards only: an animation sought past its end
 * fires its end event, and the page tidies up after it (the old words go, the width lets go) as it
 * does in use.
 *
 * Plain CommonJS, as the tools are; the functions that run in the page are written to stand alone
 * (everything they use is a parameter or a browser global) and are sent as source.
 */

"use strict";

/** Motion back on in this window alone: DevTools' media emulation over the app-wide switch. */
const allowMotion = async (win) => {
  if (!win.webContents.debugger.isAttached()) {
    win.webContents.debugger.attach("1.3");
  }
  await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  const reduced = await win.webContents.executeJavaScript("matchMedia('(prefers-reduced-motion: reduce)').matches");
  if (reduced) {
    throw new Error("motion is still reduced in the window: the morph would not play");
  }
};

/**
 * In the page, before the change is pushed: the moment the button changes, every animation in it —
 * the drain, the words, the width, the sheen, the squash — is stopped at its start and kept for
 * `seek`. The observer's callback runs once React has committed and laid out (one task), and
 * `getAnimations()` flushes style first, so every transition the change starts is there by then.
 * Resolves with what is playing — an animation's name, or the property a transition moves — or
 * null when the button did not change within three seconds.
 */
const arm = () => {
  window.__lbMorph = new Promise((resolve) => {
    const button = document.querySelector(".lb-act");
    // The change is the button taking another face. A mutation that leaves the face as it was is
    // not it — the hover's grace lifting (`is-settling`, 350ms after the logger last landed, which
    // the stop morph sets off just before the next width's start), a width let go — and stopping
    // everything then catches none of the morph, which then plays on unseen.
    const face = () => `${button.dataset.kind}|${button.dataset.surface}|${button.getAttribute("aria-disabled")}`;
    const from = face();
    // a push that changes nothing in the button must fail the caller, not leave it waiting
    const giveUp = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, 3000);
    const observer = new MutationObserver(() => {
      if (face() === from) {
        return;
      }
      clearTimeout(giveUp);
      observer.disconnect();
      const animations = document.getAnimations().filter((a) => a.effect?.target?.closest?.(".lb-act") != null);
      for (const a of animations) {
        a.pause();
        a.currentTime = 0;
      }
      window.__lbMorphAnimations = animations;
      resolve(animations.map((a) => a.animationName ?? a.transitionProperty));
    });
    observer.observe(button, { attributes: true, childList: true, subtree: true, characterData: true });
  });
};

/**
 * In the page: every stopped animation to `t` ms after the change, then two frames for the events
 * and the paint. Resolves with the button's laid-out width (the squash's scale does not count) and
 * whether the ease still holds it at an explicit one.
 */
const seek = (t) =>
  new Promise((resolve) => {
    for (const a of window.__lbMorphAnimations) {
      a.currentTime = t;
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const button = document.querySelector(".lb-act");
        resolve({ width: parseFloat(getComputedStyle(button).width), held: button.style.width !== "" });
      }),
    );
  });

/**
 * In the page: the morph played out — every animation run to its end (the sheen, which has none,
 * let run again) — and two frames for the page to tidy up after it. Resolves with whether the
 * button let go of the width the ease held it at, and how many leaving words are still drawn.
 */
const finish = () =>
  new Promise((resolve) => {
    for (const a of window.__lbMorphAnimations ?? []) {
      if (a.effect?.getComputedTiming().iterations === Infinity) {
        a.play();
      } else {
        a.finish();
      }
    }
    window.__lbMorphAnimations = [];
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const button = document.querySelector(".lb-act");
        resolve({
          held: button.style.width !== "" || button.dataset.ease != null,
          leaving: button.querySelectorAll(".is-leaving").length,
        });
      }),
    );
  });

/** Push a capture state through the stub bridge (layout-check-preload.cjs), as main would. */
const push = (win, state) => {
  win.webContents.send("gbc-stub:state", state);
};

/** Push `to` with the button armed; resolves with what started playing. */
const play = async (win, to) => {
  await win.webContents.executeJavaScript(`(${arm.toString()})()`);
  push(win, to);
  return win.webContents.executeJavaScript("window.__lbMorph");
};

const seekTo = (win, t) => win.webContents.executeJavaScript(`(${seek.toString()})(${t})`);

const playOut = (win) => win.webContents.executeJavaScript(`(${finish.toString()})()`);

module.exports = { allowMotion, play, seekTo, playOut, push };
