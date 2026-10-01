#!/usr/bin/env node
/**
 * Does the v5 shell fit every window it can be? `pnpm check:layout:v5` (CI runs it under xvfb,
 * beside the old window's `pnpm check:layout`).
 *
 * The old window is one fixed size, and tools/layout-check.cjs measures it there. The v5 window
 * resizes, down to 768×620, and the shell changes shape on the way: the sidebar folds to a rail
 * below 1280, the right column narrows at 1024 and moves under the page below it, the title bar
 * drops words below 1024. A word that does not fit is cut or pushed sideways in one language, at
 * one width, in one state — which nobody opens by hand. So this drives the BUILT page
 * (dist/web/app — what ships) in an offscreen Electron window behind the old check's stub bridge,
 * at the narrowest width of each of the shell's layouts (768, 1024, 1280) and at the boards' 1440,
 * all at the window's smallest height (620), and fails on:
 *
 * - sideways scroll: the window, or anything in it that scrolls, wider than it is;
 * - clipped text: words cut by a box that hides its overflow, or past the window's edge — except
 *   the two cuts the shell makes on purpose (MAY_CUT), and only while they end in "…" with the
 *   whole text in a title;
 * - words spilling out of a box that draws an edge or a ground (a button, a card, the bar);
 * - two drawn boxes over one another, neither holding the other (a card too wide for its column
 *   lands on the next one without making anything scroll);
 * - overlap of the title bar's parts — the crest, the wordmark, the status, the button, the
 *   version, the gear — with one another, out of the bar, or under the buttons the OS draws over
 *   it (a Mac's three lights at the left, Windows' three caption buttons at the right; board Fh1);
 * - any `securitypolicyviolation` (heard from the page's first moment, shell-layout-preload.cjs),
 *   and any error the page logs;
 * - a page that did not draw: the landmarks, the route marked current in the sidebar, a page in
 *   the panel, and the notice the state calls for in the band — or one it does not call for;
 * - the broken decoder's dialog (board Fh4, option D) open when it should be and not otherwise, held
 *   inside the window under the title bar without scrolling, the focus inside it and the rest of
 *   the window inert while it is open; a box under the dialog's scrim is not "under" the dialog;
 * - while the title bar's Start/Stop changes face (MORPHS, measured every 55ms of it with motion
 *   on): any of the above in the bar, the version or the gear moving, a change that did not play,
 *   and a button still holding its eased width, or a leaving word, once it is over.
 *
 * Every route × 768/1024/1280/1440 × both themes × six languages × the states that change the
 * layout × both platforms; then every route × width × theme × language × platform × both directions
 * of the morph × its frames. The routes and the languages are read from the source (src/app/router.ts
 * ROUTES, src/shared/i18n.ts SUPPORTED_LANGS), the sidebar must offer exactly those routes, and the
 * run must measure exactly the product of the lists, each of them non-empty — so an empty route
 * list, or a loop that stops early, cannot pass.
 *
 * Final frames, the morph's apart: reduced motion is forced, and each measurement waits for the page
 * to say it has settled — the scenario's language and theme applied, every slice of the bridge
 * drawn, the faces loaded — rather than for a fixed time. One window per route, platform, theme, language and state,
 * shrunk through the four widths: the shell's shape is CSS alone (nothing in src/app reads the
 * window's width), so a window resized to 1024 draws what one opened at 1024 draws.
 *
 * Plain CommonJS, run by Electron itself: `electron --no-sandbox tools/shell-layout-check.cjs`
 * after a build (the flag is for Linux CI, where Chromium checks its SUID sandbox before any script
 * runs). OUT=<dir> writes a PNG of each failing scenario. Exits 1 on any failure.
 */

"use strict";

const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const { buildSync } = require("esbuild");

const morph = require("./shell-morph.cjs");

const ROOT = resolve(__dirname, "..");
const PAGE = join(ROOT, "dist", "web", "app", "index.html");
const OUT = process.env.OUT ? resolve(process.env.OUT) : null;

app.commandLine.appendSwitch("force-prefers-reduced-motion");
app.commandLine.appendSwitch("disable-gpu");

/** A list from the app's own source, compiled on the spot: no copy here to fall out of step. */
const fromSource = (file) => {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT, file)],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const module = { exports: {} };
  new Function("module", "exports", outputFiles[0].text)(module, module.exports);
  return module.exports;
};

/**
 * Read inside the run, not when Electron loads this file: a throw at load — a source that no
 * longer compiles, or touches `window` on import — leaves Electron up with no window (it reports
 * the error and waits), and CI would sit through to its timeout. Inside the run a throw exits 1.
 */
const readLists = () => ({
  ROUTES: fromSource("src/app/router.ts").ROUTES,
  SUPPORTED_LANGS: fromSource("src/shared/i18n.ts").SUPPORTED_LANGS,
});

/**
 * The narrowest width of each of the shell's layouts — 768 (the smallest window: the rail, one
 * column, the short bar), 1024 (the rail, a 320px right column, the full bar), 1280 (the labelled
 * sidebar, a 400px column) — and 1440, the width the boards are drawn at. Widest first, so one
 * window shrinks through them as a member's would.
 */
const WIDTHS = [1440, 1280, 1024, 768];
/** The smallest height the window allows (src/main/windowOptions.ts): the page scrolls, the frame does not. */
const HEIGHT = 620;
const THEMES = ["obsidian", "parchment"];
/** The title bar pads a different end on each: a Mac's lights at the left, Windows' buttons at the right. */
const PLATFORMS = ["darwin", "win32"];

/**
 * The states that change the layout, as the stub bridge spells them (layout-check-preload.cjs).
 * Every capture state the shell draws differently — the bar's words and its button, the hero card,
 * the meta line — each with the guild connection that gives the sidebar's foot (board Fh2) one of
 * its shapes, then the foot's remaining states over a running capture; then every notice of board
 * Fh5 in the band, at its tallest, and the broken decoder's dialog (Fh4, option D).
 *
 * `notice` is the band's notice the state must draw (null: none — a band that appears where it
 * should not is a fault too), `dialog` whether the dialog must be open. `press` clicks a button
 * first, as a member would — "Later", the fix that reports back, the install still fetching —
 * required on the platforms named (`on`), not tried on the others, where the card has no such
 * button; `waitFor` is what the press must bring before measuring.
 */
const LATER = { selector: "[data-dialog-later]", on: ["darwin", "win32"] };
const STATES = [
  // The first run: Start in gold, the pair card in the right column, "Connect a guild" in the foot.
  { name: "idle", state: "idle", paired: false, notice: null },
  { name: "starting", state: "starting", paired: false, notice: null },
  { name: "waiting", state: "waiting", paired: false, notice: null },
  // Past 90 s of waiting the three reasons join the hero card, beside the pair card: the tallest page.
  { name: "waiting-long", state: "waitingLong", paired: false, notice: null },
  // The bar at its longest — a name, "capturing 1 h 0 min", Stop — and the foot's longest line, the
  // device's name (cut, titled) over "1,284 lines sent · 1 min ago".
  { name: "capturing", state: "capturing", paired: true, sentAgoMs: 60_000, notice: null },
  // Before Albion names the character: "Capturing · detecting… · 20 s"; nothing sent yet.
  { name: "capturing-unnamed", state: "capturingNew", paired: true, sent: 0, notice: null },
  // The bar's longest words, "The logger hiccupped — restarting it… · in 4 s". The first restart:
  // no notice yet (from the third in a row).
  { name: "restarting", state: "restarting", paired: true, upload: "retrying", notice: null },
  { name: "stopping", state: "stopping", paired: true, upload: "sending", notice: null },
  // The danger words, a neutral Start, the foot's one state in words, which wraps — and the band's
  // fix: macOS blocking capture on a Mac, Npcap for administrators only on Windows.
  { name: "error", state: "error", paired: true, upload: "unauthorized", notice: "blocked" },
  { name: "send-blocked", state: "capturing", paired: true, upload: "blocked", notice: null },
  { name: "bot-outdated", state: "capturing", paired: true, upload: "bot-outdated", notice: null },
  { name: "send-off", state: "capturing", paired: true, uploadEnabled: false, notice: null },
  // The notices (Fh5). The tallest blocked cards: the Mac's after its password prompt was closed (its
  // note under the sentence), the driver's while it fetches (two controls and a note).
  {
    name: "blocked-mac-cancelled",
    state: "error",
    access: "no-permission",
    fixOutcome: "cancelled",
    paired: false,
    press: { selector: '[data-notice-action="fix-mac"]', on: ["darwin"] },
    waitFor: ".lb-notice-note",
    notice: "blocked",
  },
  {
    name: "blocked-npcap-fetching",
    state: "errorNpcap",
    access: "npcap-missing",
    npcapPending: true,
    paired: false,
    press: { selector: '[data-notice-action="install-npcap"]', on: ["win32"] },
    waitFor: ".lb-notice-note",
    notice: "blocked",
  },
  // Idle, and the setup probe already knows: the bar's red, a blocked hero, the gold fix in the band.
  { name: "blocked-engine", state: "idle", engineMissing: true, paired: false, notice: "blocked" },
  { name: "blocked-abi", state: "errorAbi", paired: false, notice: "blocked" },
  // The broken decoder after "Later": the band alone, each of the fix's four steps, over a paired
  // capture held until the update.
  { name: "decoder-ready", state: "health", update: { phase: "ready", version: "0.9.1" }, paired: true, upload: "held", press: LATER, notice: "decoder" },
  { name: "decoder-not-out", state: "health", update: { phase: "up-to-date" }, paired: true, upload: "held", press: LATER, notice: "decoder" },
  { name: "decoder-downloading", state: "health", update: { phase: "downloading", version: "0.9.1", percent: 40 }, paired: true, upload: "held", press: LATER, notice: "decoder" },
  { name: "decoder-manual", state: "health", update: { phase: "off" }, paired: true, upload: "held", press: LATER, notice: "decoder" },
  // Over an idle capture: "Update now" in gold, and Start stepped back to its neutral face.
  { name: "decoder-idle", state: "healthIdle", update: { phase: "ready", version: "0.9.1" }, paired: false, press: LATER, notice: "decoder" },
  // The dialog itself, when the break is found and when the fix is down.
  { name: "dialog-fix-ready", state: "health", update: { phase: "ready", version: "0.9.1" }, paired: true, upload: "held", notice: "decoder", dialog: true },
  { name: "dialog-not-out", state: "health", update: { phase: "up-to-date" }, paired: true, upload: "held", notice: "decoder", dialog: true },
  { name: "logger-stopping", state: "restartingAgain", paired: true, upload: "retrying", notice: "logger-stopping" },
  { name: "update-ready", state: "idle", update: { phase: "ready", version: "0.9.1" }, paired: false, notice: "update-ready" },
  { name: "update-ready-capturing", state: "capturing", update: { phase: "ready", version: "0.9.1" }, paired: true, notice: "update-ready" },
];

/** The scrim is a veil over the page, not a box on it; the dialog's layer is over everything else. */
const VEILS = [".lb-scrim"];
const OVERLAY = ".lb-overlay";

/**
 * The cuts the shell makes on purpose: a device's name in the sidebar's foot, which is whatever a
 * member called the computer (Sidebar.tsx, `TFoot.named`), and the bar's status words, which give
 * up width before anything else in the bar (TitleBar.tsx) — at 768 on Windows the longest
 * restarting sentences do. Each may end in "…" and only with the whole text in a title. Words
 * anywhere else that do not fit are a fault: a state in the foot wraps rather than read
 * "Disconnected in Di…".
 */
const MAY_CUT = [".lb-foot-text:not(.lb-foot-text--words)", ".lb-status-label"];

/**
 * The title bar's Start/Stop changing face (StartStop.tsx; board Fh1), measured while it plays —
 * the one part of the shell that moves its own layout. Its box eases between two widths, its words
 * roll out and in, a surface drains off another: a word standing outside the drawn box for a frame,
 * or the version and the gear jumping, would pass every final frame above. So each window here
 * turns motion back on (tools/shell-morph.cjs) and plays both directions as the logger goes —
 * Start pressed (idle → starting) and the logger stopped (stopping → idle) — measuring the bar at
 * every MORPH_FRAMES ms of the 440ms drain, from the change to its end.
 */
const MORPHS = [
  { name: "start", to: "starting" },
  { name: "stop", via: "stopping", to: "idle" },
];
/** Every 55ms: the words' 170ms exit and 260ms entrance, and the width's two eases, fall between. */
const MORPH_FRAMES = [0, 55, 110, 165, 220, 275, 330, 385, 440];
/** What a change must set playing, or the morph did not run and its frames prove nothing. */
const MORPH_PLAYS = ["clip-path", "width", "lb-roll-out", "lb-roll-in"];
/** The button: its layers are its paint, not boxes of their own (the check's `surfaces`). */
const SURFACES = [{ box: ".lb-act", layers: ".lb-act-layer" }];

/**
 * Where the OS draws over the bar (board Fh1; tools/shell-shots.cjs draws the same stand-ins): a
 * Mac's three 12px lights, 8px apart from 18px in, centred on the 48px bar; Windows' three 46px
 * caption buttons, the bar's full height, at the right. No part of the bar may sit under them.
 */
const OS_ZONES = {
  darwin: [{ name: "the Mac's traffic lights", left: 18, right: 70, top: 18, bottom: 30 }],
  win32: [{ name: "Windows' caption buttons", fromRight: 138, top: 0, bottom: 48 }],
};

/** One page load per entry; each is measured at every width. */
const loads = ({ ROUTES, SUPPORTED_LANGS }) => {
  const list = [];
  for (const route of ROUTES) {
    for (const platform of PLATFORMS) {
      for (const theme of THEMES) {
        for (const lang of SUPPORTED_LANGS) {
          for (const { name, notice, dialog, press, waitFor, ...stub } of STATES) {
            list.push({
              route,
              platform,
              theme,
              lang,
              stateName: name,
              expect: { notice, dialog: dialog === true },
              press: press != null && press.on.includes(platform) ? press.selector : null,
              waitFor: press != null && press.on.includes(platform) ? (waitFor ?? null) : null,
              sc: { lang, theme, platform, ...stub },
            });
          }
        }
      }
    }
  }
  return list;
};

/** One window per entry, from idle; both directions of the morph are played in it at every width. */
const morphLoads = ({ ROUTES, SUPPORTED_LANGS }) => {
  const list = [];
  for (const route of ROUTES) {
    for (const platform of PLATFORMS) {
      for (const theme of THEMES) {
        for (const lang of SUPPORTED_LANGS) {
          list.push({ route, platform, theme, lang, sc: { lang, theme, platform, state: "idle", paired: false } });
        }
      }
    }
  }
  return list;
};

/** In the page: where the bar's parts right of the button are. A change of the button's width must not move them. */
const rightOfButton = () => {
  const parts = [];
  for (let el = document.querySelector(".lb-titlebar > .lb-act")?.nextElementSibling; el != null; el = el.nextElementSibling) {
    if (getComputedStyle(el).display !== "none") {
      const r = el.getBoundingClientRect();
      parts.push({ what: [...el.classList].find((c) => c.startsWith("lb-")) ?? el.tagName.toLowerCase(), left: r.left, right: r.right });
    }
  }
  return parts;
};

/**
 * Runs in the page, so it is written to stand alone: everything it uses is a parameter or a
 * browser global. Returns the problems (empty = fits), the ellipses it allowed, and the routes the
 * sidebar offers.
 */
const measure = ({ route, zones, mayCut, surfaces, scope, veils = [], overlay = null, expect = null }) => {
  const problems = new Set();
  const marked = new Set();
  const root = document.documentElement;
  // The whole page, or one part of it (a morph changes only the title bar): the page-wide checks —
  // that it drew, that nothing scrolls sideways — belong to the whole.
  const wholePage = scope == null;
  const within = wholePage ? document.body : document.querySelector(scope);
  const W = root.clientWidth;
  const H = root.clientHeight;
  // Layout rounds to fractions of a pixel; a whole pixel is a real overflow.
  const T = 1;

  const css = (el) => getComputedStyle(el);
  const clips = (v) => v === "hidden" || v === "clip";
  const scrolls = (v) => v === "auto" || v === "scroll";
  const words = (text) => {
    const t = text.replace(/\s+/g, " ").trim();
    return `"${t.length > 48 ? `${t.slice(0, 47)}…` : t}"`;
  };
  // An element by its shell class, else its most specific package class (the modifier comes last:
  // `gbtn gbtn-primary`), else its id (React's ids say nothing), else its words.
  const say = (el) => {
    const tag = el.tagName.toLowerCase();
    const own = [...el.classList].find((c) => c.startsWith("lb-")) ?? [...el.classList].findLast((c) => c.startsWith("gb"));
    if (own != null) {
      return `${tag}.${own}`;
    }
    return el.id !== "" ? `${tag}#${el.id}` : `${tag} ${words(el.textContent ?? "")}`;
  };
  // Seen by a screen reader and not by the eye: the package's .gb-sr-only and the rail's folded
  // labels (a 1px clipped box), or not drawn at all.
  const unseen = (el) => {
    for (let e = el; e != null && e !== root; e = e.parentElement) {
      const s = css(e);
      if (s.display === "none" || s.visibility !== "visible" || s.clip !== "auto" || s.clipPath !== "none" || s.opacity === "0") {
        return true;
      }
    }
    return false;
  };
  // The skip link waits above the window until it is focused (base.css .gb-skip): parked, not cut.
  const parked = (el) => {
    const skip = el.closest(".gb-skip");
    return skip != null && document.activeElement !== skip;
  };
  const painted = (colour) => {
    if (colour === "" || colour === "transparent") {
      return false;
    }
    const alpha = colour.match(/\/\s*([\d.]+)%?\s*\)$/) ?? colour.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
    return alpha == null || Number(alpha[1]) > 0;
  };
  // A box the eye sees as one: a ground, an edge or a shadow. Words must stay inside it. A button
  // drawn by layers inside it (the bar's Start/Stop: an ember face, a surface that drains off it)
  // is one box, its own, whatever its layers are doing — the layers are its paint, not boxes.
  const surface = (el) => surfaces.some(({ box }) => el.matches(box));
  const layer = (el) => surfaces.some(({ layers }) => el.matches(layers));
  const drawsABox = (s, el) =>
    (el != null && surface(el)) ||
    painted(s.backgroundColor) ||
    s.backgroundImage !== "none" ||
    s.boxShadow !== "none" ||
    ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(s[`border${side}Width`]) > 0 && painted(s[`border${side}Color`]));
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const paddingBox = (el) => {
    const r = el.getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
  };
  const intersect = (a, b) => ({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });
  const empty = (r) => r.right - r.left <= 0.5 || r.bottom - r.top <= 0.5;
  const union = (a, b) => ({
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  });
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const outside = (r, b) => r.left < b.left - T || r.right > b.right + T || r.top < b.top - T || r.bottom > b.bottom + T;
  // Does a box cut what it holds? Only a block-level box can: overflow does nothing to an inline one.
  const clipping = (s) => s.display !== "inline" && s.display !== "contents" && (clips(s.overflowX) || clips(s.overflowY));
  const range = document.createRange();
  const textRects = (node) => {
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).map(box);
  };

  // The page drew.
  for (const [selector, what] of !wholePage ? [] : [
    ["header.lb-titlebar", "the title bar"],
    ["nav.lb-side", "the sidebar"],
    ["main#main", "the main region"],
    [".lb-titlebar .lb-status", "the capture's status"],
  ]) {
    if (document.querySelector(selector) == null) {
      problems.add(`${what} (${selector}) is not drawn`);
    }
  }
  if (wholePage) {
    const link = document.querySelector(`nav a[href="#/${route}"]`);
    if (link?.getAttribute("aria-current") !== "page") {
      problems.add(`the sidebar does not mark #/${route} as the page you are on`);
    }
    const panel = document.querySelector("main [role='tabpanel']");
    if (panel == null || panel.textContent.trim() === "") {
      problems.add(`#/${route} drew no page`);
    }
    if (expect != null) {
      // The notice the state calls for, and none it does not: a band missing is a fix nobody
      // sees; a band where nothing is wrong pushes the page down for nothing.
      const shown = [...document.querySelectorAll("main .lb-notice")].map((el) => el.dataset.notice);
      const wanted = expect.notice == null ? [] : [expect.notice];
      if (shown.join(",") !== wanted.join(",")) {
        problems.add(`the band shows ${shown.length === 0 ? "no notice" : shown.join(" and ")}, not ${wanted.length === 0 ? "nothing" : wanted[0]}`);
      }
      const dialog = document.querySelector("[role='alertdialog']");
      if ((dialog != null) !== expect.dialog) {
        problems.add(expect.dialog ? "the broken decoder's dialog is not open" : "a dialog is open");
      }
      if (dialog != null) {
        // Under the title bar, inside the window, whole: a dialog that scrolls hides its buttons.
        const r = dialog.getBoundingClientRect();
        if (r.top < 48 - T || r.left < -T || r.right > W + T || r.bottom > H + T) {
          problems.add("the dialog does not fit the window under the title bar");
        }
        if (dialog.scrollHeight > dialog.clientHeight + T) {
          problems.add(`the dialog scrolls (${dialog.scrollHeight}px of it in ${dialog.clientHeight}px)`);
        }
        if (!dialog.contains(document.activeElement)) {
          problems.add("the dialog is open and the focus is not in it");
        }
        for (const part of ["header.lb-titlebar", ".lb-body", ".gb-skip"]) {
          if (document.querySelector(part)?.inert !== true) {
            problems.add(`${part} is not inert under the dialog`);
          }
        }
      }
    }

    // Sideways scroll: the window, then anything in it that scrolls.
    if (root.scrollWidth > W + T) {
      problems.add(`the window scrolls sideways (${root.scrollWidth}px of content in ${W}px)`);
    }
    for (const el of document.body.querySelectorAll("*")) {
      if (scrolls(css(el).overflowX) && el.scrollWidth > el.clientWidth + T) {
        problems.add(`${say(el)} scrolls sideways (${el.scrollWidth}px of content in ${el.clientWidth}px)`);
      }
    }
  } else if (within == null) {
    problems.add(`${scope} is not drawn`);
    return { problems: [...problems], marked: [], offered: [] };
  }

  // Every piece of words on the page: walk out from it through the boxes that hold it, to the
  // first that scrolls (a page is meant to be longer than its window; sideways is reported above).
  // A box that hides its overflow must not cut it; a box that is drawn must not have it spill out.
  // With no scroller on the way, the window's own edges are the last box.
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    const host = node.parentElement;
    if (!/\S/.test(node.data) || host == null || host.closest("script, style") != null || unseen(host) || parked(host)) {
      continue;
    }
    let visible = textRects(node);
    if (visible.length === 0) {
      continue;
    }
    let scroller = null;
    for (let el = host; el != null && el !== document.body; el = el.parentElement) {
      const s = css(el);
      if (scrolls(s.overflowX) || scrolls(s.overflowY)) {
        scroller = el;
        break;
      }
      if (clipping(s)) {
        const edge = paddingBox(el);
        const cutX = clips(s.overflowX) && visible.some((r) => r.left < edge.left - T || r.right > edge.right + T);
        const cutY = clips(s.overflowY) && visible.some((r) => r.top < edge.top - T || r.bottom > edge.bottom + T);
        if (cutX || cutY) {
          // An ellipsis says "there is more", and a title holding the whole says what — on the
          // boxes allowed to cut. Anything else loses words.
          const whole = el.textContent.trim();
          const titled = el.closest("[title]");
          const onPurpose = mayCut.some((selector) => el.matches(selector));
          if (onPurpose && !cutY && s.textOverflow === "ellipsis" && titled != null && titled.title.includes(whole)) {
            marked.add(`${say(el)} ${words(whole)}`);
          } else {
            problems.add(`${say(el)} cuts ${words(el.textContent)}${cutY ? " at the bottom" : ""}`);
          }
        }
        visible = visible.map((r) => intersect(r, edge)).filter((r) => !empty(r));
        if (visible.length === 0) {
          break;
        }
      }
      if (drawsABox(s, el) && visible.some((r) => outside(r, box(el.getBoundingClientRect())))) {
        problems.add(`${words(node.data)} spills out of ${say(el)}`);
      }
    }
    if (scroller == null && visible.some((r) => outside(r, { left: 0, top: 0, right: W, bottom: H }))) {
      problems.add(`${words(node.data)} runs off the window`);
    }
  }

  // Drawn boxes over one another: two cards, a card and a button, a tile and a line of the sidebar —
  // any two boxes the eye sees, neither of which holds the other. A box too wide for its column
  // that does not make the page scroll lands on its neighbour instead, and its words can still all
  // be inside it.
  // A dialog's layer lies over the page on purpose: a box in it and a box under it are not on one
  // another, and the scrim between them is a veil, not a box.
  const veiled = (el) => veils.some((selector) => el.matches(selector));
  const lifted = (el) => overlay != null && el.closest(overlay) != null;
  const drawn = [...within.querySelectorAll("*")].filter(
    (el) => !layer(el) && !veiled(el) && drawsABox(css(el), el) && !unseen(el) && !parked(el) && el.getClientRects().length > 0,
  );
  for (const [i, a] of drawn.entries()) {
    for (const b of drawn.slice(i + 1)) {
      if (lifted(a) !== lifted(b)) {
        continue;
      }
      if (!a.contains(b) && !b.contains(a) && overlap(box(a.getBoundingClientRect()), box(b.getBoundingClientRect()))) {
        problems.add(`${say(a)} and ${say(b)} overlap`);
      }
    }
  }

  // The title bar's parts: each drawn where it is and nowhere else. A part's extent is its box and
  // everything drawn inside it that its boxes do not hide — so a status whose time runs out of a
  // squeezed box counts where the time is drawn, not where the box ends.
  const bar = document.querySelector("header.lb-titlebar");
  if (bar != null) {
    const barBox = box(bar.getBoundingClientRect());
    const extentOf = (part) => {
      // What of `rects` the boxes from `from` out to the part itself leave in sight.
      const shown = (from, rects) => {
        let visible = rects.filter((r) => !empty(r));
        for (let e = from; e != null && e !== part.parentElement; e = e.parentElement) {
          if (clipping(css(e))) {
            visible = visible.map((r) => intersect(r, paddingBox(e))).filter((r) => !empty(r));
          }
        }
        return visible;
      };
      let extent = box(part.getBoundingClientRect());
      for (const el of part.querySelectorAll("*")) {
        if (!unseen(el)) {
          for (const r of shown(el.parentElement, [box(el.getBoundingClientRect())])) {
            extent = union(extent, r);
          }
        }
      }
      const texts = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      for (let node = texts.nextNode(); node != null; node = texts.nextNode()) {
        if (/\S/.test(node.data) && !unseen(node.parentElement)) {
          for (const r of shown(node.parentElement, textRects(node))) {
            extent = union(extent, r);
          }
        }
      }
      return extent;
    };
    const parts = [...bar.children]
      .filter((el) => !el.classList.contains("lb-bar-fill") && !unseen(el) && el.getClientRects().length > 0)
      .map((el) => ({ el, extent: extentOf(el) }));
    for (const [i, a] of parts.entries()) {
      if (outside(a.extent, barBox)) {
        problems.add(`${say(a.el)} runs out of the title bar`);
      }
      for (const zone of zones) {
        const area = zone.fromRight != null ? { left: W - zone.fromRight, right: W, top: zone.top, bottom: zone.bottom } : zone;
        if (overlap(a.extent, area)) {
          problems.add(`${say(a.el)} is under ${zone.name}`);
        }
      }
      for (const b of parts.slice(i + 1)) {
        if (overlap(a.extent, b.extent)) {
          problems.add(`in the title bar, ${say(a.el)} overlaps ${say(b.el)}`);
        }
      }
    }
  }

  return {
    problems: [...problems],
    marked: [...marked],
    offered: [...document.querySelectorAll("nav a[href^='#/']")].map((a) => a.getAttribute("href").slice(2)),
  };
};

/**
 * Settled: the window is at the width asked for, the scenario's language and theme are on <html>,
 * every slice of the bridge the shell draws has arrived — the capture (the bar's status), the setup
 * (the version), the pairing (the sidebar's foot), the settings (a page's switch is enabled once
 * they land; a page with none shows them only as the language and the theme) — and the faces have
 * loaded. Polled, so a slow machine waits longer instead of measuring a half-built page (the old
 * check's fixed 700ms is how its ru-pair-details came to fail now and then).
 */
const settled = ({ lang, theme, platform, width, height, timeoutMs, notice = undefined, dialog = undefined, waitFor = null }) => `new Promise((resolve) => {
  const started = performance.now();
  const missing = () => {
    const root = document.documentElement;
    const out = [];
    if (innerWidth !== ${width} || innerHeight !== ${height}) out.push('the window at ${width}x${height} (it is ' + innerWidth + 'x' + innerHeight + ')');
    if (root.lang !== ${JSON.stringify(lang)}) out.push('the language');
    if (root.dataset.theme !== ${JSON.stringify(theme === "parchment" ? "light" : "dark")}) out.push('the theme');
    if (root.dataset.platform !== ${JSON.stringify(platform)}) out.push('the platform');
    if (document.querySelector('.lb-titlebar .lb-status') == null) out.push('the capture state');
    if (document.querySelector('.lb-bar-version') == null) out.push('the setup');
    if (document.querySelector('.lb-foot') == null) out.push('the pairing');
    if (document.querySelector('button[role="switch"]:disabled') != null) out.push('the settings');
    ${notice === undefined ? "" : `if ((document.querySelector('main .lb-notice')?.dataset.notice ?? null) !== ${JSON.stringify(notice)}) out.push('the notice ${notice}');`}
    ${dialog === undefined ? "" : `if ((document.querySelector('[role=alertdialog]') != null) !== ${JSON.stringify(dialog)}) out.push('the dialog ${dialog ? "open" : "closed"}');`}
    ${waitFor == null ? "" : `if (document.querySelector(${JSON.stringify(waitFor)}) == null) out.push(${JSON.stringify(`what the press brings (${waitFor})`)});`}
    return out;
  };
  const tick = () => {
    const out = missing();
    if (out.length === 0) {
      document.fonts.ready.then(() => requestAnimationFrame(() => resolve(document.fonts.status === 'loaded' ? [] : ['the faces'])));
    } else if (performance.now() - started > ${timeoutMs}) {
      resolve(out);
    } else {
      setTimeout(tick, 10);
    }
  };
  tick();
})`;

const run = async () => {
  const { ROUTES, SUPPORTED_LANGS } = readLists();
  const lists = [
    ["route", ROUTES],
    ["width", WIDTHS],
    ["theme", THEMES],
    ["language", SUPPORTED_LANGS],
    ["state", STATES],
    ["platform", PLATFORMS],
  ];
  const none = [...lists, ["direction", MORPHS], ["frame", MORPH_FRAMES]]
    .filter(([, list]) => !Array.isArray(list) || list.length === 0)
    .map(([what]) => what);
  if (none.length > 0) {
    console.log(`Nothing to check: no ${none.join(", no ")}. A run that measures nothing does not pass.`);
    return 1;
  }
  const morphLists = [
    ["route", ROUTES],
    ["width", WIDTHS],
    ["theme", THEMES],
    ["language", SUPPORTED_LANGS],
    ["direction", MORPHS],
    ["frame", MORPH_FRAMES],
    ["platform", PLATFORMS],
  ];
  const product = (ls) => ls.reduce((n, [, list]) => n * list.length, 1);
  const describe = (ls) => ls.map(([what, list]) => `${list.length} ${what}${list.length === 1 ? "" : "s"}`).join(" × ");
  const expectedStill = product(lists);
  const expectedMorph = product(morphLists);
  const expected = expectedStill + expectedMorph;
  const factors = `${expectedStill} still (${describe(lists)}) + ${expectedMorph} in the Start/Stop morph (${describe(morphLists)})`;
  if (OUT != null) {
    mkdirSync(OUT, { recursive: true });
  }
  const allowed = new Map();
  let measured = 0;
  let failed = 0;
  for (const load of loads({ ROUTES, SUPPORTED_LANGS })) {
    const label = `#/${load.route} ${load.platform} ${load.theme} ${load.lang} ${load.stateName}`;
    const win = new BrowserWindow({
      show: false,
      width: WIDTHS[0],
      height: HEIGHT,
      useContentSize: true,
      frame: false,
      webPreferences: {
        offscreen: true,
        preload: join(__dirname, "shell-layout-preload.cjs"),
        contextIsolation: true,
        sandbox: false,
        additionalArguments: [`--gbc-scenario=${Buffer.from(JSON.stringify(load.sc)).toString("base64")}`],
      },
    });
    const logged = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") {
        logged.push(event.message);
      }
    });
    await win.loadFile(PAGE, { hash: `/${load.route}` });
    const pressFailed = [];
    if (load.press != null) {
      // as a member would, once the page has drawn what the press is on
      const ready = await win.webContents.executeJavaScript(
        `new Promise((r) => { const t0 = performance.now(); const tick = () => { const el = document.querySelector(${JSON.stringify(load.press)}); if (el != null) { el.click(); r(true); } else if (performance.now() - t0 > 5000) { r(false); } else { setTimeout(tick, 10); } }; tick(); })`,
      );
      if (!ready) {
        pressFailed.push(`there was nothing to press at ${load.press}`);
      }
    }
    const results = [];
    for (const width of WIDTHS) {
      if (width !== WIDTHS[0]) {
        win.setContentSize(width, HEIGHT);
      }
      const waitingFor = await win.webContents.executeJavaScript(
        settled({
          lang: load.lang,
          theme: load.theme,
          platform: load.platform,
          width,
          height: HEIGHT,
          timeoutMs: 5000,
          notice: load.expect.notice,
          dialog: load.expect.dialog,
          waitFor: load.waitFor,
        }),
      );
      const { problems, marked, offered } = await win.webContents.executeJavaScript(
        `(${measure.toString()})(${JSON.stringify({ route: load.route, zones: OS_ZONES[load.platform], mayCut: MAY_CUT, surfaces: SURFACES, veils: VEILS, overlay: OVERLAY, expect: load.expect })})`,
      );
      const refused = await win.webContents.executeJavaScript("window.gbcCheck.refused()");
      const all = [
        ...pressFailed,
        ...(waitingFor.length > 0 ? [`the page never settled: no ${waitingFor.join(", no ")}`] : []),
        ...problems,
        ...refused.map((r) => `the content-security policy refused ${r}`),
        ...logged.map((m) => `the page logged an error: ${m}`),
        ...offered.filter((r) => !ROUTES.includes(r)).map((r) => `the sidebar offers #/${r}, which is not a route`),
        ...ROUTES.filter((r) => !offered.includes(r)).map((r) => `the sidebar does not offer #/${r}`),
      ];
      for (const m of marked) {
        allowed.set(m, (allowed.get(m) ?? 0) + 1);
      }
      measured += 1;
      if (all.length > 0) {
        failed += 1;
        if (OUT != null) {
          const name = `${load.route}-${load.platform}-${load.theme}-${load.lang}-${load.stateName}-${width}`;
          writeFileSync(join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
      results.push({ width, all });
    }
    win.destroy();
    const bad = results.filter((r) => r.all.length > 0);
    if (bad.length === 0) {
      console.log(`ok   ${label.padEnd(44)} ${WIDTHS.join(" ")}`);
    }
    for (const r of bad) {
      console.log(`FAIL ${label.padEnd(44)} ${r.width}  ${r.all.join("; ")}`);
    }
  }
  for (const load of morphLoads({ ROUTES, SUPPORTED_LANGS })) {
    const label = `morph #/${load.route} ${load.platform} ${load.theme} ${load.lang}`;
    const win = new BrowserWindow({
      show: false,
      width: WIDTHS[0],
      height: HEIGHT,
      useContentSize: true,
      frame: false,
      webPreferences: {
        offscreen: true,
        preload: join(__dirname, "shell-layout-preload.cjs"),
        contextIsolation: true,
        sandbox: false,
        additionalArguments: [`--gbc-scenario=${Buffer.from(JSON.stringify(load.sc)).toString("base64")}`],
      },
    });
    const logged = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") {
        logged.push(event.message);
      }
    });
    await win.loadFile(PAGE, { hash: `/${load.route}` });
    await morph.allowMotion(win);
    const bad = [];
    for (const width of WIDTHS) {
      if (width !== WIDTHS[0]) {
        win.setContentSize(width, HEIGHT);
      }
      const waitingFor = await win.webContents.executeJavaScript(
        settled({ lang: load.lang, theme: load.theme, platform: load.platform, width, height: HEIGHT, timeoutMs: 5000 }),
      );
      for (const m of MORPHS) {
        const before = [...(waitingFor.length > 0 ? [`the page never settled: no ${waitingFor.join(", no ")}`] : [])];
        if (m.via != null) {
          const label0 = await win.webContents.executeJavaScript("document.querySelector('.lb-status-label')?.textContent");
          morph.push(win, m.via);
          const landed = await win.webContents.executeJavaScript(
            `new Promise((r) => { const t0 = performance.now(); const tick = () => document.querySelector('.lb-status-label')?.textContent !== ${JSON.stringify(label0)} ? r(true) : performance.now() - t0 > 3000 ? r(false) : setTimeout(tick, 10); tick(); })`,
          );
          if (!landed) {
            before.push(`the bar never showed ${m.via}`);
          }
        }
        const rest = await win.webContents.executeJavaScript(`(${rightOfButton.toString()})()`);
        const playing = await morph.play(win, m.to);
        if (playing == null) {
          before.push(`the button did not change when ${m.to} was pushed`);
        } else {
          for (const needed of MORPH_PLAYS.filter((p) => !playing.includes(p))) {
            before.push(`the change to ${m.to} did not play ${needed}`);
          }
        }
        for (const t of MORPH_FRAMES) {
          await morph.seekTo(win, t);
          const { problems, marked } = await win.webContents.executeJavaScript(
            `(${measure.toString()})(${JSON.stringify({ route: load.route, zones: OS_ZONES[load.platform], mayCut: MAY_CUT, surfaces: SURFACES, scope: "header.lb-titlebar" })})`,
          );
          const now = await win.webContents.executeJavaScript(`(${rightOfButton.toString()})()`);
          const moved = rest
            .map((r, i) => ({ r, n: now[i] }))
            .filter(({ r, n }) => n == null || n.what !== r.what || Math.abs(n.left - r.left) > 0.5 || Math.abs(n.right - r.right) > 0.5)
            .map(({ r, n }) => `${r.what}, right of the button, moved ${n == null ? "away" : `${(n.left - r.left).toFixed(1)}px`}`);
          const refused = await win.webContents.executeJavaScript("window.gbcCheck.refused()");
          const all = [
            ...(t === MORPH_FRAMES[0] ? before : []),
            ...problems,
            ...moved,
            ...refused.map((r) => `the content-security policy refused ${r}`),
            ...logged.splice(0).map((msg) => `the page logged an error: ${msg}`),
          ];
          if (t === MORPH_FRAMES.at(-1)) {
            const after = await morph.playOut(win);
            if (after.held) {
              all.push("the button kept the width its ease held it at once the morph was over");
            }
            if (after.leaving > 0) {
              all.push(`${after.leaving} leaving word(s) still drawn once the morph was over`);
            }
          }
          for (const mk of marked) {
            allowed.set(mk, (allowed.get(mk) ?? 0) + 1);
          }
          measured += 1;
          if (all.length > 0) {
            failed += 1;
            bad.push(`${width} ${m.name} ${t}ms  ${all.join("; ")}`);
            if (OUT != null) {
              const name = `morph-${load.route}-${load.platform}-${load.theme}-${load.lang}-${width}-${m.name}-${t}ms`;
              writeFileSync(join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG());
            }
          }
        }
      }
    }
    win.destroy();
    if (bad.length === 0) {
      console.log(`ok   ${label.padEnd(44)} ${WIDTHS.join(" ")} × ${MORPHS.map((m) => m.name).join(", ")} × ${MORPH_FRAMES.length} frames`);
    }
    for (const b of bad) {
      console.log(`FAIL ${label.padEnd(44)} ${b}`);
    }
  }
  if (allowed.size > 0) {
    console.log("\nCut on purpose (an ellipsis, the whole text in a title):");
    for (const [what, n] of [...allowed].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}× ${what}`);
    }
  }
  if (measured !== expected) {
    console.log(`\nMeasured ${measured} scenarios, not the ${expected} asked for (${factors}).`);
    return 1;
  }
  console.log(`\n${measured} scenarios (${factors}), ${failed} failed.`);
  console.log(failed > 0 ? `${failed} scenario(s) do not fit.` : `Every scenario fits, from ${WIDTHS.at(-1)}x${HEIGHT} up.`);
  return failed > 0 ? 1 : 0;
};

// Destroying the last window must not end the run between scenarios.
app.on("window-all-closed", () => {});

app.whenReady().then(
  () =>
    run().then(
      (code) => app.exit(code),
      (error) => {
        console.error(error);
        app.exit(1);
      },
    ),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
