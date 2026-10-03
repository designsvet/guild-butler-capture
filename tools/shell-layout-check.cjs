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
 *   the window inert while it is open; a box under the dialog's scrim is not "under" the dialog.
 *   Then, answered from the keyboard (a click on the scrim, then Escape — `dialogKeys`): closed,
 *   the band still holding its notice, the window alive again and the focus on the page;
 * - the settings drawer (board Fh6, option C) open when the gear was pressed and not otherwise, 16px
 *   in from the window's edges under the title bar, no wider than 440px, the focus inside it and the
 *   rest of the window inert; its language menu, when open, whole in the window, clear of the title
 *   bar and of its own button, not scrolling, the focus on one of its rows. A box in the drawer and
 *   one under its scrim are not "on" one another, nor the menu and the rows it floats over. Then
 *   the keys (`settingsKeys`): Tab held inside, a theme and a language picked from the keyboard and
 *   kept, every other control pressed from the keyboard making its own bridge call (WIRES, read
 *   back from the stub), Escape closing the menu alone and then the drawer, and the focus back on
 *   the gear;
 * - the guild connection's panel (board Fh2) open when a door was pressed and not otherwise, showing
 *   the face the pairing calls for, whole in the window under the title bar, over its foot and not on
 *   it, not scrolling, the focus in it, the foot's door saying it is open and drawn pressed; its Pair
 *   the kit's steel button (`gbtn-share`), and the window's one gold button the one the state names —
 *   the bar's Start, or the band's fix over a neutral Start — never the panel's. Then the
 *   keys (`connectionKeys`): every control pressed from the keyboard making its own bridge call and
 *   no other (`pair`, `copyText`, `setUpload`, `openLoot`, `unpair`), Pair waiting for a code, a
 *   refusal said under the field, Escape, a press outside and the focus leaving closing it — none of
 *   them while a code is being checked — and the focus back on the door it came from;
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
 * drawn, the faces loaded, nothing left playing (the drawer fades in, under reduced motion) —
 * rather than for a fixed time. One window per route, platform, theme, language and state,
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
const stubItemArt = require("./item-art-stub.cjs");

const ROOT = resolve(__dirname, "..");
const PAGE = join(ROOT, "dist", "web", "app", "index.html");
const OUT = process.env.OUT ? resolve(process.env.OUT) : null;
// Focused reruns after a Session/PvE-only edit; the default CI matrix stays exhaustive.
const DATA_ONLY = process.env.ONLY === "data";

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
let hasPve = null;
let pveVisitsOf = null;
const readLists = () => {
  const { replayedSession, journalSession, fromSource: sessionSource } = require("./session-fixture.cjs");
  const session = replayedSession();
  const { closeSession, newSession, reduceSession } = sessionSource("src/shared/session/model.ts");
  const pve = sessionSource("src/shared/session/pve.ts");
  hasPve = pve.hasPve;
  pveVisitsOf = pve.pveVisits;
  const edge = newSession("unplaced", session.lastAt);
  const chestOnly = reduceSession(edge, { v:1, t:"chest", at:session.lastAt, char:null, zone:null, name:null, rarity:null });
  const unknown = reduceSession(chestOnly, { v:1, t:"kill", at:session.lastAt, char:null, zone:"UNRECOGNIZED_ZONE", mob:9999999, hp:null });
  STATES.push(
    { name:"pve-chest-only", routes:["pve"], state:"capturing", session:chestOnly, paired:false, notice:null },
    { name:"pve-unplaced", routes:["pve"], state:"capturing", session:unknown, paired:false, notice:null },
    { name:"pve-missing-currency", routes:["pve"], state:"capturing", session:{ ...session, totals:{ ...session.totals, favor:null } }, paired:false, notice:null },
  );
  STATES.push(
    { name: "session-replay", state: "capturing", session, paired: true, notice: null },
    { name: "session-stopped", state: "idle", session: closeSession(session, session.lastAt), paired: false, notice: null },
    { name: "session-next", state: "capturing", session, paired: true, notice: null, press: { selector: "[data-new-session]", on: ["darwin", "win32"] } },
    { name: "journal-completions", state: "capturing", session: journalSession(), paired: false, notice: null },
  );
  return {
    ROUTES: fromSource("src/app/router.ts").ROUTES,
    SUPPORTED_LANGS: fromSource("src/shared/i18n.ts").SUPPORTED_LANGS,
  };
};

/** The words the connection panel's keys check against: the app's catalog and its failures, read in the run (above). */
let stringsFor = null;
let EPairFailure = null;
const readWords = () => {
  stringsFor = fromSource("src/shared/strings.ts").stringsFor;
  EPairFailure = fromSource("src/shared/captureTypes.ts").EPairFailure;
};

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
 * should not is a fault too), `dialog` whether the dialog must be open, `drawer` the settings
 * drawer, `menu` its language menu. `press` clicks a button first — or several, in order — as a
 * member would: "Later", the fix that reports back, the install still fetching, the gear and then
 * the language; required on the platforms named (`on`), not tried on the others, where the card
 * has no such button; `waitFor` is what the press must bring before measuring. A press may type into
 * a field instead (`{ fill, value }`): the connection panel's code. `panel` is the face of the guild
 * connection's panel (board Fh2) the state must show — "connect" or "connected" — or none. `gold`,
 * where a state names it, is the window's one gold button: "start" (the bar's Start capture), "fix"
 * (the band's, with Start stepped back to its neutral face), or null (none in sight: the bar shows
 * Stop).
 */
const LATER = { selector: "[data-dialog-later]", on: ["darwin", "win32"] };
const GEAR = "[data-settings-gear]";
const SETTINGS = { selector: GEAR, on: ["darwin", "win32"] };
const LANGUAGE_MENU = { selector: [GEAR, "[data-language-picker]"], on: ["darwin", "win32"] };
/**
 * The settings drawer's controls that go to the bridge, in Tab order from the theme tiles (the
 * switch comes round after Close), each with the key that presses it and the call it must make —
 * the old gear popover's (src/renderer/renderer.ts). The theme and the language are held apart, by
 * what they do to the page.
 */
const WIRES = [
  { control: "[data-settings-action='check-updates']", key: "Enter", call: "updateCheckNow" },
  { control: "[data-settings-action='reveal']", key: "Enter", call: "reveal" },
  { control: "[data-settings-action='choose-engine']", key: "Enter", call: "pickEnginePath" },
  { control: ".lb-set-links a[href]", key: "Enter", call: "openPrivacy" },
  { control: "[role='switch']", key: " ", call: "setAutoCapture" },
];
/**
 * The guild connection's panel (Fh2): its door in the sidebar's foot, the other on Session, the code
 * typed (the board's) and Pair pressed — which the stub bridge refuses, with the failure a state
 * names (`pairFailure`), or never answers (`pairPending`).
 */
const DOOR = "[data-connection-door]";
const CONNECT = { selector: DOOR, on: ["darwin", "win32"] };
const FROM_SESSION = { selector: "[data-connection-opener='session']", on: ["darwin", "win32"] };
const REFUSED = { selector: [DOOR, { fill: "[data-pair-code]", value: "ABCD-EFGH" }, "[data-pair-submit]"], on: ["darwin", "win32"] };
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
  // The settings drawer (Fh6, option C) over a running capture, with a real install's folders at
  // their longest; its language menu open; and over an idle capture with no engine found — the
  // engine's "not found" sentence, no folder, the band's fix under the scrim.
  { name: "settings", state: "capturing", paired: true, press: SETTINGS, waitFor: ".lb-drawer", notice: null, drawer: true },
  { name: "settings-language", state: "capturing", paired: true, press: LANGUAGE_MENU, waitFor: "[role='listbox']", notice: null, drawer: true, menu: true },
  { name: "settings-no-engine", state: "idle", engineMissing: true, paired: false, press: SETTINGS, waitFor: ".lb-drawer", notice: "blocked", drawer: true },
  // The guild connection's panel (Fh2): not connected, from the foot and from Session's button; a
  // code refused, the board's refusal and the longest in every language (this computer cannot
  // store the token securely) — and, from the keys, every other refusal in turn; a code being
  // checked ("Connecting…"); opened under the band's fix; connected, as the board draws it and with
  // the longest sentence the details can carry (the bot needs an update).
  // Pair is steel in every one of them, and the gold is not the panel's: the bar's Start over an
  // idle capture, the band's fix under a band, none while the bar shows Stop.
  { name: "connect", state: "idle", paired: false, press: CONNECT, waitFor: "[data-connection-panel='connect']", notice: null, panel: "connect", gold: "start" },
  // (the stub accepts its code: the keys pair this one)
  { name: "connect-from-session", state: "waiting", paired: false, pairOk: true, press: FROM_SESSION, waitFor: "[data-connection-panel='connect']", notice: null, panel: "connect", gold: null },
  { name: "connect-refused", state: "idle", paired: false, press: REFUSED, waitFor: "[data-pair-failure]", notice: null, panel: "connect", gold: "start" },
  { name: "connect-no-encryption", state: "idle", paired: false, pairFailure: "no-encryption", press: REFUSED, waitFor: "[data-pair-failure]", notice: null, panel: "connect", gold: "start" },
  { name: "connect-checking", state: "idle", paired: false, pairPending: true, press: REFUSED, waitFor: "[data-pair-submit][aria-disabled='true']", notice: null, panel: "connect", gold: "start" },
  // Under the band's gold fix (no engine found): the fix holds the window's one gold button, the
  // bar's Start steps back to its neutral face, and Pair is still steel.
  { name: "connect-under-fix", state: "idle", engineMissing: true, paired: false, press: CONNECT, waitFor: "[data-connection-panel='connect']", notice: "blocked", panel: "connect", gold: "fix" },
  { name: "connected", state: "capturing", paired: true, sentAgoMs: 60_000, press: CONNECT, waitFor: "[data-connection-panel='connected']", notice: null, panel: "connected", gold: null },
  { name: "connected-outdated", state: "capturing", paired: true, upload: "bot-outdated", press: CONNECT, waitFor: "[data-connection-panel='connected']", notice: null, panel: "connected", gold: null },
];

/**
 * The scrims are veils over the page, not boxes on it. The layers over the page — the decoder's
 * dialog, the settings drawer, the drawer's language menu, the connection's panel — each lie over
 * what is under them on purpose: a box in one and a box in another are not on one another.
 */
const VEILS = [".lb-scrim"];
const OVERLAY = ".lb-overlay, .lb-settings, .lb-menu, .lb-pair";

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
          for (const { name, routes, notice, dialog, drawer, menu, panel, gold, press, waitFor, ...stub } of STATES) {
            if (routes != null && !routes.includes(route)) { continue; }
            if (route === "pve" && !hasPve(stub.session ?? null) && name !== "journal-completions") { continue; }
            const pressed = press != null && press.on.includes(platform);
            list.push({
              route,
              platform,
              theme,
              lang,
              stateName: name,
              // `gold` left out where a state names none: only "one gold button at most" is held there
              expect: { notice, dialog: dialog === true, drawer: drawer === true, menu: menu === true, panel: panel ?? null, ...(gold === undefined ? {} : { gold }) },
              press: pressed ? [press.selector].flat() : [],
              waitFor: pressed ? (waitFor ?? null) : null,
              // a real install's folders, at their longest (the settings drawer shows them whole)
              sc: { lang, theme, platform, longPaths: true, ...stub },
            });
          }
        }
      }
    }
  }
  return list;
};

/** One window per entry, from idle; both directions of the morph are played in it at every width. */
const morphLoads = ({ SUPPORTED_LANGS }) => {
  const ROUTES = ["session"];
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

  // The tab's underline has a glow outside its box. Wrapped metadata needs its own
  // clear row; non-overlapping text rectangles alone miss the line crowding it.
  const pageHeader = within.matches(".lb-head") ? within : within.querySelector(".lb-head");
  if (W < 1280 && pageHeader != null) {
    const tabs = pageHeader.querySelector(".gb-tabs");
    const meta = pageHeader.querySelector(".lb-head-meta");
    if (tabs != null && meta != null && meta.getBoundingClientRect().top < tabs.getBoundingClientRect().bottom + 8 - T) {
      problems.add("the page metadata crowds the tab underline (less than 8px clear space)");
    }
  }

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
      // The settings drawer (Fh6, option C): there when the gear was pressed, and only then.
      const drawer = document.querySelector(".lb-drawer[role='dialog']");
      if ((drawer != null) !== expect.drawer) {
        problems.add(expect.drawer ? "the settings drawer is not open" : "the settings drawer is open");
      }
      if (drawer != null) {
        // 16px in from the window's edges, under the title bar, no wider than the package's 440.
        const r = drawer.getBoundingClientRect();
        const inset = 16;
        if (r.top < 48 + inset - T || r.right > W - inset + T || r.bottom > H - inset + T || r.left < -T) {
          problems.add(`the drawer does not sit 16px in under the title bar (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
        }
        if (r.width > 440 + T) {
          problems.add(`the drawer is ${Math.round(r.width)}px wide, not 440`);
        }
        if (!drawer.contains(document.activeElement)) {
          problems.add("the drawer is open and the focus is not in it");
        }
        for (const part of ["header.lb-titlebar", ".lb-body", ".gb-skip"]) {
          if (document.querySelector(part)?.inert !== true) {
            problems.add(`${part} is not inert under the drawer`);
          }
        }
        if (document.querySelector("[data-settings-gear]")?.getAttribute("aria-expanded") !== "true") {
          problems.add("the gear does not say its drawer is open");
        }
      }
      // Its language menu: whole in the window, clear of the title bar and of its own button, not
      // scrolling (seven rows fit the smallest window), the focus on one of its rows.
      const menu = document.querySelector("[role='listbox']");
      if ((menu != null) !== expect.menu) {
        problems.add(expect.menu ? "the language menu is not open" : "a language menu is open");
      }
      if (menu != null) {
        const r = menu.getBoundingClientRect();
        if (r.top < 48 - T || r.left < -T || r.right > W + T || r.bottom > H + T) {
          problems.add("the language menu does not fit the window under the title bar");
        }
        const button = document.querySelector("[data-language-picker]");
        if (button != null && overlap(box(r), box(button.getBoundingClientRect()))) {
          problems.add("the language menu covers its own button");
        }
        if (menu.scrollHeight > menu.clientHeight + T) {
          problems.add(`the language menu scrolls (${menu.scrollHeight}px of it in ${menu.clientHeight}px)`);
        }
        if (document.activeElement?.getAttribute("role") !== "option" || !menu.contains(document.activeElement)) {
          problems.add("the language menu is open and the focus is not on one of its rows");
        }
      }
      // The guild connection's panel (Fh2): open with the face the pairing calls for when a door was
      // pressed, and only then; whole in the window, under the title bar, over the foot it opens from
      // and not on it; not scrolling (it would only in a window shorter than the smallest); the focus
      // in it; the foot's door saying it is open, and drawn pressed.
      const pair = document.querySelector("[data-connection-panel]");
      const face = pair?.dataset.connectionPanel ?? null;
      if (face !== expect.panel) {
        problems.add(expect.panel == null ? `the connection panel is open (${face})` : face == null ? "the connection panel is not open" : `the connection panel shows ${face}, not ${expect.panel}`);
      }
      if (pair != null) {
        const r = pair.getBoundingClientRect();
        if (r.top < 48 + 8 - T || r.left < -T || r.right > W + T || r.bottom > H + T) {
          problems.add(`the connection panel does not fit the window under the title bar (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
        }
        if (pair.scrollHeight > pair.clientHeight + T) {
          problems.add(`the connection panel scrolls (${pair.scrollHeight}px of it in ${pair.clientHeight}px)`);
        }
        const foot = document.querySelector(".lb-foot");
        if (foot != null && r.bottom > foot.getBoundingClientRect().top + T) {
          problems.add("the connection panel covers the foot it opens from");
        }
        if (!pair.contains(document.activeElement)) {
          problems.add("the connection panel is open and the focus is not in it");
        }
        const door = document.querySelector("[data-connection-door]");
        if (door?.getAttribute("aria-expanded") !== "true") {
          problems.add("the foot's door does not say its panel is open");
        }
        if (door == null || !painted(css(door).backgroundColor)) {
          problems.add("the foot's door is not drawn pressed while its panel is open");
        }
      }
      // One gold button per window (model.ts `barAction`): the band's fix, else the bar's Start —
      // never two in sight. What lies inert under the dialog or the drawer is veiled, not in sight.
      const golds = [...document.querySelectorAll(".gbtn-primary, .lb-act[data-kind='start'][data-surface='gold']")].filter(
        (el) => el.closest("[inert]") == null && !unseen(el),
      );
      if (golds.length > 1) {
        problems.add(`${golds.length} gold buttons in sight, not one: ${golds.map(say).join(", ")}`);
      }
      // The connection panel's Pair is the kit's filled steel button in every state (the owner's
      // ruling, 2026-10-02: in the kit steel means shared, and pairing is what shares a member's loot
      // with the guild) — so the panel never takes the gold, and the one gold button is the one the
      // state names: the bar's Start while the steps show over an idle capture; under a band, its
      // fix, with Start stepped back to its neutral face (the lifted surface, morph.ts topSurface).
      const submit = pair?.querySelector("[data-pair-submit]") ?? null;
      if (face === "connect" && (submit == null || !submit.classList.contains("gbtn-share") || submit.classList.contains("gbtn-primary"))) {
        problems.add(`the connection panel's Pair is ${submit == null ? "not drawn" : `${say(submit)} (${submit.className})`}, not the kit's steel button (gbtn-share)`);
      }
      if (expect.gold !== undefined) {
        const start = document.querySelector(".lb-titlebar .lb-act[data-kind='start']");
        let holder = null;
        if (expect.gold === "start") {
          holder = start?.dataset.surface === "gold" ? start : null;
          if (holder == null) {
            problems.add(`the bar's Start is not gold (${start == null ? "no Start in the bar" : `its surface is ${start.dataset.surface}`}) while the connection panel is open`);
          }
        } else if (expect.gold === "fix") {
          holder = document.querySelector("main .lb-notice .gbtn-primary");
          if (holder == null) {
            problems.add("the band's fix is not gold");
          }
          if (start?.dataset.surface !== "lift") {
            problems.add(`under the band's gold fix the bar's Start is ${start == null ? "not drawn" : `on its ${start.dataset.surface} surface`}, not stepped back to its neutral face`);
          }
        }
        const strays = golds.filter((el) => el !== holder);
        if (strays.length > 0) {
          problems.add(`gold on ${strays.map(say).join(", ")}, where the state names ${expect.gold == null ? "no gold button" : expect.gold === "start" ? "the bar's Start" : "the band's fix"}`);
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
      // A box fixed to the window (the drawer's language menu) is placed against the window, not
      // in the boxes around it in the page: they neither hold nor cut it, and the window's edges
      // are its last box.
      if (s.position === "fixed") {
        break;
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
  // A layer over the page (the dialog, the drawer, its menu) lies over what is under it on purpose: a
  // box in one layer and a box in another are not on one another, and a scrim is a veil, not a box.
  const veiled = (el) => veils.some((selector) => el.matches(selector));
  const layerOf = (el) => (overlay == null ? null : el.closest(overlay));
  const drawn = [...within.querySelectorAll("*")].filter(
    (el) => !layer(el) && !veiled(el) && drawsABox(css(el), el) && !unseen(el) && !parked(el) && el.getClientRects().length > 0,
  );
  for (const [i, a] of drawn.entries()) {
    for (const b of drawn.slice(i + 1)) {
      if (layerOf(a) !== layerOf(b)) {
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
 * they land; a page with none shows them only as the language and the theme) — nothing that plays
 * once is still playing (the settings drawer fades in), and the faces have loaded. Polled, so a slow machine waits longer instead of measuring a half-built page (the old
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
    const playing = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length;
    if (playing > 0) out.push(playing + ' animation(s) still playing');
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

/**
 * The broken decoder's dialog, answered from the keyboard once its window has been measured: a click
 * on the scrim first — it leaves the focus on the page's body, outside the dialog, where a key
 * handler on the dialog alone would never hear Escape — then Escape, which is "Later". The dialog
 * must close, the band keep the decoder's notice ("Later" answers the dialog, never the notice), the
 * rest of the window come back to life, and the focus land on the page, which the dialog opened over
 * (nothing held the focus before it). Real input through DevTools, as a member's would arrive.
 * Returns the problems; empty = it behaved.
 */
const dialogKeys = async (win) => {
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  try {
    await cdp.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    const height = await win.webContents.executeJavaScript("innerHeight");
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.sendCommand("Input.dispatchMouseEvent", { type, x: 8, y: height - 8, button: "left", clickCount: 1 });
    }
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.sendCommand("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
    return await win.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(() => {
      const out = [];
      if (document.querySelector("[role='alertdialog']") != null) out.push("Escape after a click on the scrim did not close the dialog");
      const band = document.querySelector("main .lb-notice")?.dataset.notice ?? null;
      if (band !== "decoder") out.push("after Later the band shows " + (band ?? "nothing") + ", not the decoder's notice");
      for (const part of ["header.lb-titlebar", ".lb-body", ".gb-skip"]) {
        if (document.querySelector(part)?.inert === true) out.push(part + " is still inert after the dialog closed");
      }
      if (document.activeElement?.id !== "main") out.push("after Later the focus is on " + (document.activeElement?.tagName ?? "nothing") + ", not the page");
      resolve(out);
    }, 100))`);
  } finally {
    cdp.detach();
  }
};

/**
 * The settings drawer from the keyboard (board Fa: Esc closes, Tab stays inside while it is open, the
 * focus returns to the button that opened it), once its window has been measured. Real keys and
 * presses through DevTools, as a member's would arrive. Returns the problems; empty = it behaved.
 *
 * With its language menu open: a row picked with the keys (End — Português — or, where that is the
 * scenario's own language, Home and ↓ — English) and Enter must close the menu onto its button and
 * put the page in that language, the drawer still open, and give it to the bridge to store; ↓ on the
 * button opens the menu again, and Escape closes the menu alone, onto its button; a second Escape
 * closes the drawer.
 *
 * Without it: the focus starts on Close; Shift+Tab goes round to the drawer's last stop and Tab back
 * to Close; Enter on the other theme's tile puts the page in that theme, keeps the focus there and
 * gives the theme to the bridge to store. Over a running capture, every other control (WIRES) is
 * reached by Tab and pressed — Enter, Space for the switch — and must make its bridge call and no
 * other (the stub records them), the drawer still open and the page not navigated away.
 * Then the drawer is closed — over a running capture by a click on its words (which leaves the focus
 * on the page's body, outside it) and Escape; opened again with Enter on the gear, interrupted by the
 * broken decoder's dialog (the drawer inert under it, the focus back in the drawer once "Later" is
 * pressed) and closed with Escape — and with no engine found, by a press on the scrim.
 *
 * Every close must leave the drawer gone, the focus on the gear and the rest of the window alive.
 */
const settingsKeys = async (win, load) => {
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  const js = (code) => win.webContents.executeJavaScript(code);
  const KEYS = {
    Tab: ["Tab", 9],
    Escape: ["Escape", 27],
    Enter: ["Enter", 13],
    End: ["End", 35],
    Home: ["Home", 36],
    ArrowDown: ["ArrowDown", 40],
    " ": ["Space", 32],
  };
  const press = async (name, shift = false) => {
    const [code, vk] = KEYS[name];
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.sendCommand("Input.dispatchKeyEvent", {
        type,
        key: name,
        code,
        windowsVirtualKeyCode: vk,
        modifiers: shift ? 8 : 0,
        // Enter and Space activate a button through the character they type
        ...((name === "Enter" || name === " ") && type === "keyDown" ? { text: name === "Enter" ? "\r" : " " } : {}),
      });
    }
  };
  // what the page has asked of the bridge since it loaded, reads (get*) apart: the stub records it
  const asked = () => js("window.gbcStub.calls().filter((c) => !c.name.startsWith('get')).map((c) => ({ name: c.name, arg: c.args[0] ?? null }))");
  const click = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
  };
  // whatever the keys set moving (the drawer's fade out) has played out
  const settle = () =>
    js(`new Promise((r) => { const t0 = performance.now(); const tick = () => { const busy = document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity); if (!busy || performance.now() - t0 > 3000) { setTimeout(r, 30); } else { setTimeout(tick, 10); } }; tick(); })`);
  const focused = () =>
    js(`(() => { const el = document.activeElement; if (el == null || el === document.body) return 'the page'; if (el.matches('[data-settings-close]')) return 'Close'; if (el.matches('[data-settings-gear]')) return 'the gear'; if (el.matches('[data-language-picker]')) return 'the language button'; return (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40); })()`);
  const lastStop = () =>
    js(`(() => { const list = [...document.querySelectorAll('.lb-drawer :is(button, a[href], [tabindex]:not([tabindex="-1"]))')].filter((el) => !el.hasAttribute('disabled')); const el = list.at(-1); return el == null ? null : (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40); })()`);
  const closedWell = async (how) => {
    await settle();
    // The drawer goes once its exit has played (SettingsDrawer.tsx: the animation's promise, then a
    // render): under a loaded machine that render can land after the animations have stopped, so
    // its going is waited for — up to 3s — rather than read once (a run of 5,184 once caught it
    // still leaving).
    await js(
      `new Promise((r) => { const t0 = performance.now(); const tick = () => document.querySelector('.lb-settings') == null || performance.now() - t0 > 3000 ? r() : setTimeout(tick, 10); tick(); })`,
    );
    const problems = [];
    if ((await js("document.querySelector('.lb-settings') != null")) === true) {
      problems.push(`${how} did not close the drawer`);
    }
    for (const part of ["header.lb-titlebar", ".lb-body", ".gb-skip"]) {
      if ((await js(`document.querySelector(${JSON.stringify(part)})?.inert === true`)) === true) {
        problems.push(`${part} is still inert after ${how} closed the drawer`);
      }
    }
    const at = await focused();
    if (at !== "the gear") {
      problems.push(`after ${how} closed the drawer the focus is on ${at}, not the gear`);
    }
    return problems;
  };
  const out = [];
  try {
    await cdp.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (load.expect.menu) {
      const own = load.lang === "pt";
      for (const name of own ? ["Home", "ArrowDown"] : ["End"]) {
        await press(name);
      }
      await press("Enter");
      await settle();
      const want = own ? "en" : "pt";
      if ((await js("document.querySelector(\"[role='listbox']\") != null")) === true) {
        out.push("Enter on a row of the language menu did not close it");
      }
      const at = await focused();
      if (at !== "the language button") {
        out.push(`after a language was picked the focus is on ${at}, not the language button`);
      }
      const lang = await js("document.documentElement.lang");
      if (lang !== want) {
        out.push(`a language picked from the keys left the page in ${lang}, not ${want}`);
      }
      if ((await asked()).filter((c) => c.name === "setLanguage").at(-1)?.arg !== want) {
        out.push(`a language picked from the keys was not given to the bridge to store (setLanguage("${want}"))`);
      }
      if ((await js("document.querySelector('.lb-drawer') != null")) !== true) {
        out.push("picking a language closed the drawer too");
      }
      // ↓ on the button opens the menu again; Escape closes the menu alone, onto its button
      await press("ArrowDown");
      await settle();
      if ((await js("document.querySelector(\"[role='listbox']\") != null")) !== true) {
        out.push("↓ on the language button did not open its menu");
      }
      await press("Escape");
      await settle();
      if ((await js("document.querySelector(\"[role='listbox']\") != null")) === true) {
        out.push("Escape did not close the language menu");
      }
      if ((await js("document.querySelector('.lb-drawer') != null")) !== true) {
        out.push("Escape in the language menu closed the drawer too");
      } else if ((await focused()) !== "the language button") {
        out.push(`after Escape in the language menu the focus is on ${await focused()}, not its button`);
      }
      await press("Escape");
      out.push(...(await closedWell("Escape")));
      return out;
    }

    if ((await focused()) !== "Close") {
      out.push(`the drawer opened with the focus on ${await focused()}, not Close`);
    }
    const last = await lastStop();
    await press("Tab", true);
    const back = await focused();
    if (back !== last) {
      out.push(`Shift+Tab from the drawer's first stop went to ${back}, not its last (${last})`);
    }
    await press("Tab");
    if ((await focused()) !== "Close") {
      out.push(`Tab from the drawer's last stop went to ${await focused()}, not back to Close`);
    }
    const pick = await js(
      "(() => { const tile = document.querySelector('.lb-theme-tile[aria-pressed=\"false\"]'); tile?.focus(); return tile?.dataset.themePick ?? null; })()",
    );
    if (pick == null) {
      out.push("the drawer has no theme tile to pick");
    } else {
      await press("Enter");
      await settle();
      const wanted = pick === "parchment" ? "light" : "dark";
      const theme = await js("document.documentElement.dataset.theme");
      if (theme !== wanted) {
        out.push(`Enter on the ${pick} tile left the page ${theme}, not ${wanted}`);
      }
      if ((await js(`document.querySelector('.lb-theme-tile[data-theme-pick="${pick}"]')?.getAttribute('aria-pressed')`)) !== "true") {
        out.push(`the ${pick} tile does not show itself chosen after Enter`);
      }
      if ((await js(`document.activeElement?.dataset.themePick ?? null`)) !== pick) {
        out.push(`after the ${pick} tile was picked the focus left it`);
      }
      if ((await asked()).filter((c) => c.name === "setTheme").at(-1)?.arg !== pick) {
        out.push(`Enter on the ${pick} tile did not give it to the bridge to store (setTheme("${pick}"))`);
      }
    }
    if (!load.sc.engineMissing) {
      // Every other control reaches the bridge: Tab on from the tile to each in turn and press it as
      // a keyboard does, and the stub must have recorded that control's call and no other — with
      // the drawer still open, and the page where it was (the privacy policy is main's to open, in
      // the browser; a link left to navigate would take the window with it).
      const href = await js("location.href");
      for (const wire of WIRES) {
        let reached = false;
        for (let i = 0; i < 20 && !reached; i += 1) {
          await press("Tab");
          reached = (await js(`document.activeElement?.matches(${JSON.stringify(`.lb-drawer ${wire.control}`)}) === true`)) === true;
        }
        if (!reached) {
          out.push(`Tab never reached the drawer's ${wire.call} control (${wire.control})`);
          continue;
        }
        const before = (await asked()).length;
        await press(wire.key);
        await settle();
        const made = (await asked()).slice(before).map((c) => c.name);
        if (made.length !== 1 || made[0] !== wire.call) {
          out.push(`${wire.key === " " ? "Space" : wire.key} on ${wire.control} asked the bridge for ${made.length === 0 ? "nothing" : made.join(", ")}, not ${wire.call}`);
        }
      }
      if ((await js("document.querySelector('.lb-settings')?.dataset.state")) !== "open") {
        out.push("pressing the drawer's controls closed it");
      }
      if ((await js("location.href")) !== href) {
        out.push("a control in the drawer navigated the page away");
        return out;
      }
    }
    if (load.sc.engineMissing) {
      const height = await js("innerHeight");
      await click(8, height - 8);
      out.push(...(await closedWell("a press on the scrim")));
      return out;
    }
    const title = await js("(() => { const r = document.querySelector('.lb-drawer-title').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    await click(title[0], title[1]);
    if ((await js("document.querySelector('.lb-drawer') != null")) !== true) {
      out.push("a click on the drawer's own words closed it");
    }
    await press("Escape");
    out.push(...(await closedWell("Escape, after a click on its words")));
    await press("Enter");
    await settle();
    if ((await js("document.querySelector('.lb-drawer') != null")) !== true) {
      out.push("Enter on the gear did not open the drawer again");
      return out;
    }
    if ((await focused()) !== "Close") {
      out.push(`the drawer opened again with the focus on ${await focused()}, not Close`);
    }
    // A broken decoder interrupts the open drawer (Fh4, option D): its dialog goes over it, the
    // drawer takes nothing meanwhile, and "Later" (Escape) gives the drawer back its focus.
    win.webContents.send("gbc-stub:state", "health");
    const interrupted = await js(
      `new Promise((r) => { const t0 = performance.now(); const tick = () => document.querySelector("[role='alertdialog']") != null ? r(true) : performance.now() - t0 > 3000 ? r(false) : setTimeout(tick, 10); tick(); })`,
    );
    if (!interrupted) {
      out.push("the decoder's dialog did not open over the drawer");
    } else {
      await settle();
      if ((await js("document.querySelector(\"[role='alertdialog']\").contains(document.activeElement)")) !== true) {
        out.push("the decoder's dialog opened over the drawer without the focus");
      }
      if ((await js("document.querySelector('.lb-settings')?.inert === true")) !== true) {
        out.push("the drawer is not inert under the decoder's dialog");
      }
      await press("Escape");
      await settle();
      if ((await js("document.querySelector(\"[role='alertdialog']\") != null")) === true) {
        out.push("Escape did not answer the decoder's dialog over the drawer");
      }
      if ((await js("document.querySelector('.lb-settings') != null && document.querySelector('.lb-settings').inert !== true")) !== true) {
        out.push("after the dialog over it was answered the drawer is gone or still inert");
      } else if ((await focused()) !== "Close") {
        out.push(`after the dialog over the drawer was answered the focus is on ${await focused()}, not back in the drawer`);
      }
    }
    await press("Escape");
    out.push(...(await closedWell("Escape, the second time")));
    return out;
  } finally {
    cdp.detach();
  }
};

/**
 * The guild connection's panel from the keyboard and the pointer (board Fa: a popover — Escape and a
 * press outside close it, and so does the focus leaving it; the focus goes back to the door it came
 * from), once its window has been measured. Real keys, text and presses through DevTools, as a
 * member's would arrive; what the page asked of the bridge is read back from the stub's record.
 * Returns the problems; empty = it behaved.
 *
 * - Not connected, from the foot: the focus starts in the code field and Pair waits for a code;
 *   Escape closes it onto the door, and Enter on the door opens it again onto the field; the copy
 *   button copies `/capture pair` and says so; a code typed and Enter asks the bridge to pair it —
 *   once — and the refusal is said under the field, which keeps the focus; the focus leaving the
 *   panel (Tab past Pair) closes it, and a refusal does not outlive the panel; a press outside — on a
 *   spot that takes no focus, so the press alone — closes it.
 * - From Session's Pair with Discord: the same panel, that button saying it is open, and Escape gives
 *   the focus back to it. Enter on it opens it again, and a code the stub accepts turns the panel to
 *   the details with the focus on the panel, the pair card gone from Session and the foot naming the
 *   computer; Escape then gives the focus to the foot's door, the other door having gone.
 * - While a code is being checked: Escape, a press outside, the door and the focus leaving all leave
 *   it open, and Enter in the field asks for nothing more.
 * - Connected: the focus starts on the panel itself; Space on the switch, Enter on View my loot (the
 *   window not navigating) and Enter on Disconnect each make their own call and no other; Disconnect
 *   turns the panel to its steps with the focus in it, and the foot to "Connect a guild"; Escape
 *   closes it onto the door.
 */
const connectionKeys = async (win, load) => {
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  const js = (code) => win.webContents.executeJavaScript(code);
  const KEYS = { Tab: ["Tab", 9], Escape: ["Escape", 27], Enter: ["Enter", 13], " ": ["Space", 32] };
  const press = async (name, shift = false) => {
    const [code, vk] = KEYS[name];
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.sendCommand("Input.dispatchKeyEvent", {
        type,
        key: name,
        code,
        windowsVirtualKeyCode: vk,
        modifiers: shift ? 8 : 0,
        ...((name === "Enter" || name === " ") && type === "keyDown" ? { text: name === "Enter" ? "\r" : " " } : {}),
      });
    }
    await settle();
  };
  const click = async ([x, y]) => {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
    await settle();
  };
  const centre = (selector) =>
    js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r == null ? null : [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  // A spot on the page with nothing on it: the header's row, at the window's right. A press there
  // also takes the focus to the main region (it can hold the focus), so it closes the panel by the
  // focus leaving it too.
  const outside = () => js("[innerWidth - 30, 70]");
  // A spot that takes no focus — the sidebar's empty middle, above the panel — so a press there
  // closes the panel, if it does, by the press alone.
  const bare = () =>
    js("(() => { const f = document.querySelector('.lb-side-fill').getBoundingClientRect(); const p = document.querySelector('[data-connection-panel]').getBoundingClientRect(); return [f.left + f.width / 2, (f.top + Math.min(f.bottom, p.top)) / 2]; })()");
  const settle = () =>
    js(`new Promise((r) => { const t0 = performance.now(); const tick = () => { const busy = document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity); if (!busy || performance.now() - t0 > 3000) { setTimeout(r, 30); } else { setTimeout(tick, 10); } }; tick(); })`);
  const asked = () => js("window.gbcStub.calls().filter((c) => !c.name.startsWith('get')).map((c) => c.name + '(' + c.args.map((a) => JSON.stringify(a)).join(', ') + ')')");
  const on = (selector) => js(`document.activeElement?.matches(${JSON.stringify(selector)}) === true`);
  const focused = () =>
    js(`(() => { const el = document.activeElement; if (el == null || el === document.body) return 'the page'; if (el.matches('[data-connection-panel]')) return 'the panel'; if (el.matches('[data-connection-door]')) return 'the foot'; if (el.matches('[data-pair-code]')) return 'the code field'; return (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40); })()`);
  const open = () => js("document.querySelector('[data-connection-panel]')?.dataset.connectionPanel ?? null");
  const tabTo = async (selector) => {
    for (let i = 0; i < 12; i += 1) {
      if ((await on(selector)) === true) {
        return true;
      }
      await press("Tab");
    }
    return (await on(selector)) === true;
  };
  // Pressing a control must make exactly its own call.
  const makes = async (what, key, wanted, out) => {
    const before = (await asked()).length;
    await press(key);
    const made = (await asked()).slice(before);
    if (made.length !== 1 || made[0] !== wanted) {
      out.push(`${key === " " ? "Space" : key} on ${what} asked the bridge for ${made.length === 0 ? "nothing" : made.join(", ")}, not ${wanted}`);
    }
  };
  const closedOnto = async (how, door, out) => {
    if ((await open()) != null) {
      out.push(`${how} did not close the connection panel`);
      return;
    }
    if ((await js("document.querySelector('[data-connection-door]')?.getAttribute('aria-expanded')")) !== "false") {
      out.push(`after ${how} the foot's door still says its panel is open`);
    }
    if (door != null && (await on(door)) !== true) {
      out.push(`after ${how} closed the panel the focus is on ${await focused()}, not the door it came from`);
    }
  };
  const out = [];
  try {
    await cdp.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    switch (load.stateName) {
      case "connect": {
        if ((await on("[data-pair-code]")) !== true) {
          out.push(`the panel opened with the focus on ${await focused()}, not the code field`);
        }
        if ((await js("document.querySelector('[data-pair-submit]')?.disabled")) !== true) {
          out.push("Pair does not wait for a code");
        }
        await press("Escape");
        await closedOnto("Escape", DOOR, out);
        await press("Enter");
        if ((await open()) !== "connect") {
          out.push("Enter on the foot's door did not open the panel again");
          return out;
        }
        if ((await on("[data-pair-code]")) !== true) {
          out.push(`the panel opened again with the focus on ${await focused()}, not the code field`);
        }
        await press("Tab", true);
        if ((await on("[data-pair-copy]")) !== true) {
          out.push(`Shift+Tab from the code field went to ${await focused()}, not the copy button`);
        } else {
          await makes("the copy button", "Enter", 'copyText("/capture pair")', out);
          if ((await js("document.querySelector('.lb-pair-copied') != null")) !== true) {
            out.push("the copy button did not say it had copied");
          }
        }
        await press("Tab");
        if ((await on("[data-pair-code]")) !== true) {
          out.push(`Tab from the copy button went to ${await focused()}, not the code field`);
          return out;
        }
        // Spaces are not a code: Pair still waits. Then the field is emptied as the browser would.
        await cdp.sendCommand("Input.insertText", { text: "   " });
        await settle();
        if ((await js("document.querySelector('[data-pair-submit]')?.disabled")) !== true) {
          out.push("Pair stopped waiting for a code with only spaces typed");
        }
        await js(
          "(() => { const el = document.querySelector('[data-pair-code]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()",
        );
        await cdp.sendCommand("Input.insertText", { text: "abcd efgh" });
        await settle();
        if ((await js("document.querySelector('[data-pair-submit]')?.disabled")) !== false) {
          out.push("Pair stayed refusing with a code typed");
        }
        // Live, Pair is still the steel button, and the bar's Start still the window's gold.
        if ((await js("document.querySelector('[data-pair-submit]')?.classList.contains('gbtn-share') === true")) !== true) {
          out.push("with a code typed, Pair is not the kit's steel button");
        }
        if ((await js("document.querySelector(\".lb-titlebar .lb-act[data-kind='start']\")?.dataset.surface ?? null")) !== "gold") {
          out.push("with a code typed, the bar's Start is not gold");
        }
        await makes("the code field", "Enter", 'pair("abcd efgh")', out);
        if ((await js("document.querySelector('[data-pair-failure]')?.dataset.pairFailure ?? null")) !== "refused") {
          out.push("a refused code is not said under the field");
        }
        if ((await js("document.querySelector('[data-pair-code]')?.getAttribute('aria-invalid')")) !== "true") {
          out.push("the field does not say its code was refused");
        }
        if ((await on("[data-pair-code]")) !== true) {
          out.push(`after the refusal the focus is on ${await focused()}, not the code field`);
        }
        // Tab past Pair: the focus leaves the panel, which closes
        await press("Tab");
        await press("Tab");
        await closedOnto("the focus leaving it", null, out);
        await click(await centre(DOOR));
        if ((await open()) !== "connect") {
          out.push("a press on the foot's door did not open the panel");
          return out;
        }
        if ((await js("document.querySelector('[data-pair-failure]') != null || document.querySelector('[data-pair-code]')?.value !== ''")) === true) {
          out.push("a refusal, or its code, outlived the panel it was said in");
        }
        await click(await bare());
        await closedOnto("a press outside it", null, out);
        return out;
      }
      case "connect-from-session": {
        if ((await on("[data-pair-code]")) !== true) {
          out.push(`the panel opened from Session with the focus on ${await focused()}, not the code field`);
        }
        if ((await js("document.querySelector(\"[data-connection-opener='session']\")?.getAttribute('aria-expanded')")) !== "true") {
          out.push("Session's Pair with Discord does not say its panel is open");
        }
        await press("Escape");
        await closedOnto("Escape", "[data-connection-opener='session']", out);
        await press("Enter");
        if ((await on("[data-pair-code]")) !== true) {
          out.push(`Enter on Session's Pair with Discord left the focus on ${await focused()}, not the code field`);
          return out;
        }
        await cdp.sendCommand("Input.insertText", { text: "abcd efgh" });
        await settle();
        await makes("the code field", "Enter", 'pair("abcd efgh")', out);
        if ((await open()) !== "connected") {
          out.push(`an accepted code left the panel showing ${(await open()) ?? "nothing"}, not the details`);
          return out;
        }
        if ((await on("[data-connection-panel]")) !== true) {
          out.push(`after an accepted code the focus is on ${await focused()}, not the panel`);
        }
        if ((await js("document.querySelector(\"[data-connection-opener='session']\") != null")) === true) {
          out.push("after an accepted code Session still offers to pair");
        }
        if ((await js("document.querySelector('.lb-foot')?.dataset.dot")) === "hollow") {
          out.push("after an accepted code the foot still says Connect a guild");
        }
        await press("Escape");
        await closedOnto("Escape, once Session's button had gone", DOOR, out);
        return out;
      }
      case "connect-refused": {
        // Every way a code can be refused (EPairFailure), each said under the field in the app's own
        // sentence for it — the old window's catalog key, `fail` + the failure's name — and read out
        // through the page's one polite region. The stub is told which refusal to give next.
        const s = stringsFor(load.lang);
        for (const [key, failure] of Object.entries(EPairFailure)) {
          const sentence = s.pairing[`fail${key}`];
          await js(`window.gbcStub.refuseWith(${JSON.stringify(failure)})`);
          await js("document.querySelector('[data-pair-code]')?.focus()");
          await makes("the code field", "Enter", 'pair("ABCD-EFGH")', out);
          // the region says it 60ms after it is asked to (the package's LiveRegion)
          await js("new Promise((r) => setTimeout(r, 120))");
          const said = await js("document.querySelector('[data-pair-failure]')?.textContent.trim() ?? null");
          if (typeof sentence !== "string" || said !== sentence) {
            out.push(`refused with ${failure}, the panel says ${said == null ? "nothing" : JSON.stringify(said)}, not the app's sentence for it`);
          }
          const heard = await js("document.querySelector('[role=\"status\"][aria-live=\"polite\"]')?.textContent.trim() ?? null");
          if (heard !== sentence) {
            out.push(`refused with ${failure}, the polite region says ${heard == null ? "nothing" : JSON.stringify(heard)}, not its sentence`);
          }
        }
        return out;
      }
      case "connect-checking": {
        const pairs = async () => (await asked()).filter((c) => c.startsWith("pair(")).length;
        await press("Escape");
        if ((await open()) == null) {
          out.push("Escape closed the panel while a code was being checked");
          return out;
        }
        await click(await outside());
        if ((await open()) == null) {
          out.push("a press outside closed the panel while a code was being checked");
          return out;
        }
        await click(await centre(DOOR));
        if ((await open()) == null) {
          out.push("the foot's door closed the panel while a code was being checked");
          return out;
        }
        // Session's Pair with Discord, the other door (pressed by the page's own click: at 768 the
        // panel may lie over it)
        await js("document.querySelector(\"[data-connection-opener='session']\")?.click()");
        await settle();
        if ((await open()) == null) {
          out.push("Session's Pair with Discord closed the panel while a code was being checked");
          return out;
        }
        await js("document.querySelector('[data-pair-code]')?.focus()");
        await press("Enter");
        if ((await pairs()) !== 1) {
          out.push(`a code was sent ${await pairs()} times while the first was being checked`);
        }
        for (let i = 0; i < 4; i += 1) {
          await press("Tab");
        }
        if ((await open()) == null) {
          out.push("the focus leaving the panel closed it while a code was being checked");
        }
        return out;
      }
      case "connected": {
        if ((await on("[data-connection-panel]")) !== true) {
          out.push(`the details opened with the focus on ${await focused()}, not the panel`);
        }
        const href = await js("location.href");
        if (!(await tabTo("[data-connection-panel] [role='switch']"))) {
          out.push("Tab never reached Send loot automatically");
        } else {
          await makes("Send loot automatically", " ", "setUpload(false)", out);
          if ((await js("document.querySelector(\"[data-connection-panel] [role='switch']\")?.getAttribute('aria-checked')")) !== "false") {
            out.push("the switch does not show the upload off");
          }
        }
        if (!(await tabTo("[data-pair-loot]"))) {
          out.push("Tab never reached View my loot");
        } else {
          await makes("View my loot", "Enter", "openLoot()", out);
          if ((await js("location.href")) !== href) {
            out.push("View my loot navigated the window away");
            return out;
          }
        }
        if (!(await tabTo("[data-pair-disconnect]"))) {
          out.push("Tab never reached Disconnect this computer");
          return out;
        }
        await makes("Disconnect this computer", "Enter", "unpair()", out);
        if ((await open()) !== "connect") {
          out.push("after Disconnect the panel does not show the steps");
        }
        if ((await on("[data-connection-panel]")) !== true) {
          out.push(`after Disconnect the focus is on ${await focused()}, not the panel`);
        }
        if ((await js("document.querySelector('.lb-foot')?.dataset.dot")) !== "hollow") {
          out.push("after Disconnect the foot does not say Connect a guild");
        }
        await press("Escape");
        await closedOnto("Escape", DOOR, out);
        return out;
      }
      default: {
        return out;
      }
    }
  } finally {
    cdp.detach();
  }
};

const detailProof = async (win, session) =>
  win.webContents.executeJavaScript(`(() => {
  const data = document.querySelector('[data-session-data], [data-pve-data]');
  if (data == null) { return []; }
  const errors = [];
  const duration = ${Math.max(0, (session.endedAt ?? session.lastAt) - session.startedAt)};
  const icons = [];
  for (const stat of data.querySelectorAll('[data-session-metric]')) {
    const metric = stat.dataset.sessionMetric;
    if (['loot', 'kills'].includes(metric)) { continue; }
    icons.push(stat.querySelector('img')?.getAttribute('src') ?? stat.querySelector('svg')?.innerHTML);
    if (['fame', 'respec', 'silver', 'might', 'favor'].includes(metric) && stat.querySelector('img')?.getAttribute('src') !== './albion/u-'+metric+'.png') {
      errors.push('Currency lost its approved Albion sprite: '+metric);
    }
    const rate = stat.querySelector('[data-hourly]');
    const expected = duration > 0 ? Number(stat.dataset.raw) / 10000 * 3600000 / duration : null;
    if (expected == null ? rate != null : rate == null || !Number.isFinite(Number(rate.dataset.hourly)) || Math.abs(Number(rate.dataset.hourly) - expected) > 0.001) {
      errors.push('Session-average rate changed or was invented: '+metric);
    }
  }
  if (new Set(icons).size !== icons.length) { errors.push('Different currencies use the same icon'); }
  for (const source of data.querySelectorAll('[data-source-amount]')) {
    const expected = Number(source.dataset.sourceAmount) / Number(source.dataset.sourceTotal) * 100;
    const width = parseFloat(source.querySelector('.lb-source-track span').style.width);
    if (!Number.isFinite(width) || Math.abs(width-expected)>0.001 || !source.querySelector('.lb-source-amount small')?.textContent.includes('%')) {
      errors.push('Source bar and visible percentage do not describe the same total');
    }
  }
  const chests = [...data.querySelectorAll('[data-chest-count]')].reduce((n, el) => n + Number(el.dataset.chestCount), 0);
  if (chests !== ${session.chestCount}) { errors.push('Chest rarity strip lost complete openings'); }
  if (data.matches('[data-session-data]') && ${hasPve(session)} && data.querySelectorAll('a[href="#/pve"]').length < 1) {
    errors.push('Session has no working link into PvE');
  }
  for (const event of data.querySelectorAll('.lb-feed li')) {
    if (event.querySelector('svg, img') == null) { errors.push('Activity feed has no event art'); }
  }
  const strip = data.matches('[data-session-data]') ? data.querySelector('.lb-stats') : null;
  if (strip != null && strip.children.length >= 5) {
    const tiles = [...strip.children];
    tiles.forEach((tile, index) => { tile.style.display = index < 5 ? '' : 'none'; });
    const rows = new Map();
    for (const tile of tiles.slice(0, 5)) {
      const box = tile.getBoundingClientRect();
      const top = Math.round(box.top);
      rows.set(top, [...(rows.get(top) ?? []), box]);
      if (tile.querySelector('.lb-stat-value').getBoundingClientRect().right > box.right) {
        errors.push('A KPI number is cut');
      }
    }
    const counts = [...rows.values()].map((row) => row.length);
    if (JSON.stringify(counts) !== JSON.stringify(innerWidth >= 1024 ? [5] : [3,2])) {
      errors.push('KPI strip differs from Fr: '+JSON.stringify(counts));
    }
    for (const row of rows.values()) {
      if (Math.abs(row.at(-1).right-strip.getBoundingClientRect().right)>1 || Math.max(...row.map((x)=>x.width))-Math.min(...row.map((x)=>x.width))>1) {
        errors.push('KPI row does not divide its width evenly');
      }
    }
    tiles.forEach((tile) => { tile.style.removeProperty('display'); });
  }
  for (const image of data.querySelectorAll('.lb-albion-icon')) {
    if (!image.complete || image.naturalWidth === 0) { errors.push('Approved native asset did not load: '+image.getAttribute('src')); }
    const box = image.getBoundingClientRect();
    if (Math.abs(box.width-Number(image.getAttribute('width')))>1 || Math.abs(box.height-Number(image.getAttribute('height')))>1) {
      errors.push('Base image styles stretched an Albion sprite: '+image.getAttribute('src'));
    }
  }
  const activity = data.querySelector('.lb-activity-cards');
  if (activity != null) {
    const cards = [...activity.children];
    // Real captures may contain only PvE. Exercise one/two/three visible cards, without
    // inserting invented counts or depending on the fixture containing every activity.
    for (let visible = 1; visible <= cards.length; visible += 1) {
      cards.forEach((card, index) => { card.style.display = index < visible ? '' : 'none'; });
      const rows = new Map();
      for (const card of cards.slice(0, visible)) {
        const box = card.getBoundingClientRect();
        rows.set(Math.round(box.top), Math.max(rows.get(Math.round(box.top)) ?? 0, box.right));
      }
      if ([...rows.values()].some((right) => Math.abs(right - activity.getBoundingClientRect().right) > 1)) {
        errors.push('A partial activity row leaves empty card slots');
      }
    }
    cards.forEach((card) => { card.style.removeProperty('display'); });
  }
  return errors;
})()`);

const pveProof = async (win, session) => win.webContents.executeJavaScript(`(async () => {
  const errors = [];
  const data = document.querySelector('[data-pve-data]');
  if (data == null) { return ['PvE page is missing']; }
  if (${pveVisitsOf(session).some((visit) => visit.startedAt == null)} && data.querySelector('.lb-pve-visits').closest('section').querySelector('.lb-data-sub') != null) {
    errors.push('Unplaced events are claimed as established visits');
  }
  for (const [metric, raw] of Object.entries(${JSON.stringify(session.totals)})) {
    if (!['fame','respec','silver','might','favor'].includes(metric)) { continue; }
    const actual = data.querySelector('[data-session-metric="'+metric+'"]');
    if (raw == null || raw === 0) { if (actual != null) { errors.push('PvE invented '+metric); } }
    else if (Number(actual?.dataset.raw) !== raw) { errors.push('PvE changed raw '+metric); }
  }
  const sum = (selector, key) => [...data.querySelectorAll(selector)].reduce((n, el) => n + Number(el.dataset[key]), 0);
  const stats = data.querySelector('.lb-pve-stats');
  const rightByRow = new Map();
  for (const stat of stats.children) {
    const box = stat.getBoundingClientRect();
    rightByRow.set(Math.round(box.top),Math.max(rightByRow.get(Math.round(box.top)) ?? 0,box.right));
  }
  if ([...rightByRow.values()].some((right) => Math.abs(right-stats.getBoundingClientRect().right)>1)) { errors.push('PvE metrics leave unused row space'); }
  const kills = ${Object.values(session.mobs).reduce((n, qty) => n + qty, 0)};
  if (sum('[data-pve-visit]', 'kills') !== kills || sum('[data-pve-mob]', 'kills') !== kills) { errors.push('PvE lost recorded kills'); }
  if (sum('[data-pve-visit]', 'chests') !== ${session.chestCount}) { errors.push('PvE lost recorded chests'); }
  const settle = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  for (const filter of data.querySelectorAll('[data-pve-filter]')) {
    filter.click(); await settle();
    if (filter.getAttribute('aria-pressed') !== 'true') { errors.push('Content filter is not selected'); }
    const expected = ${JSON.stringify(pveVisitsOf(session).map((visit) => ({content:visit.content,kills:visit.kills})))}.filter((visit) => filter.dataset.pveFilter === 'all' || visit.content === filter.dataset.pveFilter);
    if ([...data.querySelectorAll('[data-pve-visit]')].length !== expected.length || sum('[data-pve-visit]','kills') !== expected.reduce((n,visit) => n+visit.kills,0)) { errors.push('Content filter lost or invented visits'); }
    if (filter.dataset.pveFilter !== 'all' && [...data.querySelectorAll('[data-pve-visit]')].some((el) => el.dataset.content !== filter.dataset.pveFilter)) {
      errors.push('Content filter kept another content kind');
    }
  }
  data.querySelector('[data-pve-filter="all"]').click(); await settle();
  for (const sort of ['recent','kills']) {
    data.querySelector('[data-pve-sort="'+sort+'"]')?.click(); await settle();
    const values = [...data.querySelectorAll('[data-pve-mob]')].map((el) => Number(el.dataset[sort === 'kills' ? 'kills' : 'last']));
    if (values.some((value, index) => index > 0 && value > values[index-1])) { errors.push('Mob sort is not ordered'); }
  }
  if (document.querySelectorAll('nav [aria-current="page"]').length !== 1) { errors.push('More than one current page'); }
  return errors;
})()`);

const run = async () => {
  stubItemArt();
  const { ROUTES, SUPPORTED_LANGS } = readLists();
  readWords();
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
  const stillLoads = loads({ ROUTES, SUPPORTED_LANGS }).filter((load) => !DATA_ONLY || load.sc.session != null).sort((a,b) => Number(b.route === "pve") - Number(a.route === "pve"));
  const animatedLoads = DATA_ONLY ? [] : morphLoads({ ROUTES, SUPPORTED_LANGS });
  const expectedStill = stillLoads.length * WIDTHS.length;
  const expectedMorph = animatedLoads.length * WIDTHS.length * MORPHS.length * MORPH_FRAMES.length;
  const expected = expectedStill + expectedMorph;
  const factors = `${expectedStill} still (data-gated routes, all widths/themes/languages/platforms) + ${expectedMorph} in the Start/Stop morph (Session shell)`;
  if (OUT != null) {
    mkdirSync(OUT, { recursive: true });
  }
  const allowed = new Map();
  let measured = 0;
  let failed = 0;
  for (const load of stillLoads) {
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
    for (const press of load.press) {
      // as a member would, once the page has drawn what the press is on (and settled from the last):
      // a button pressed, or a field typed into — its value set as the browser sets it, then the
      // input event a keystroke raises, which is what React listens for
      const at = typeof press === "string" ? press : press.fill;
      const act =
        typeof press === "string"
          ? "el.click();"
          : `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(press.value)}); el.dispatchEvent(new Event('input', { bubbles: true }));`;
      const ready = await win.webContents.executeJavaScript(
        `new Promise((r) => { const t0 = performance.now(); const tick = () => { const el = document.querySelector(${JSON.stringify(at)}); const busy = document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity); if (el != null && !busy) { ${act} r(true); } else if (performance.now() - t0 > 5000) { r(false); } else { setTimeout(tick, 10); } }; tick(); })`,
      );
      if (!ready) {
        pressFailed.push(`there was nothing to press at ${at}`);
        break;
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
      const showingPve = load.route === "pve" && load.stateName !== "session-next" && hasPve(load.sc.session ?? null);
      const activeRoute = showingPve ? "pve" : "session";
      const expectedRoutes = load.stateName !== "session-next" && hasPve(load.sc.session ?? null) ? ROUTES : ["session"];
      const { problems, marked, offered } = await win.webContents.executeJavaScript(
        `(${measure.toString()})(${JSON.stringify({ route: activeRoute, zones: OS_ZONES[load.platform], mayCut: MAY_CUT, surfaces: SURFACES, veils: VEILS, overlay: OVERLAY, expect: load.expect })})`,
      );
      const refused = await win.webContents.executeJavaScript("window.gbcCheck.refused()");
      const replayProof =
        load.sc.session != null && !showingPve
          ? await win.webContents.executeJavaScript(`(() => {
        const data = document.querySelector('[data-session-data]');
        if (${JSON.stringify(load.stateName)} === 'session-next') { return data == null ? [] : ['New session kept the old counters']; }
        if (data == null) { return ['Replay did not draw the Session page']; }
        if (${JSON.stringify(load.stateName)} === 'journal-completions') {
          const quantities = [...data.querySelectorAll('[data-session-event="journal"]')].map((el) => Number(el.dataset.sessionQuantity));
          const errors = [];
          if (quantities.length !== 3 || quantities.reduce((sum, qty) => sum + qty, 0) !== 6 || data.querySelector('[data-session-metric="fame"]') != null) {
            errors.push('Journal feed lost a recorded completion or invented fame');
          }
          const feed = data.querySelector('.lb-feed').closest('.lb-data-card');
          if (Math.abs(feed.getBoundingClientRect().top - data.getBoundingClientRect().top) > 1) {
            errors.push('Empty metrics/sources reserve a gap above the first journal card');
          }
          return errors;
        }
        const counts = { kills: '40', resources: '19', fish: '2', chests: '1' };
        const errors = [];
        for (const [key, n] of Object.entries(counts)) {
          const actual = document.querySelector('[data-session-count="' + key + '"]')?.textContent;
          if (actual !== n) { errors.push(key + ': expected ' + n + ', got ' + actual); }
        }
        const totals = { fame: 13307603664, respec: 2351349126, silver: 142162640, might: 159966314, favor: 70156519, faction: 113949404 };
        for (const [metric, raw] of Object.entries(totals)) {
          const actual = document.querySelector('[data-session-metric="' + metric + '"]')?.dataset.raw;
          if (actual !== String(raw)) { errors.push(metric + ': expected raw ' + raw + ', got ' + actual); }
        }
        // F1r768 needs usable groups, not merely text that stays inside the window.
        const rect = (el) => el.getBoundingClientRect();
        const rowsFill = (selector) => {
          const group = data.querySelector(selector);
          const rows = new Map();
          for (const child of group.children) {
            const r = rect(child);
            const top = Math.round(r.top);
            rows.set(top, Math.max(rows.get(top) ?? 0, r.right));
          }
          if ([...rows.values()].some((right) => Math.abs(right - rect(group).right) > 1)) {
            errors.push(selector + ': a partial row leaves unused space');
          }
        };
        rowsFill('.lb-stats');
        const header = document.querySelector('.lb-head');
        const action = header.querySelector('[data-new-session]');
        if (Math.abs(rect(action).right - rect(data).right) > 1) {
          errors.push('New session is not at the right edge of the page');
        }
        if (innerWidth < 1024) {
          rowsFill('.lb-activity-cards');
          for (const card of data.querySelector('.lb-activity-cards').children) {
            if (rect(card).width < 300) { errors.push('An activity card is too narrow for its counters'); }
          }
          const sources = [...data.querySelector('.lb-sources').children];
          if (sources.length !== 2 || Math.abs(rect(sources[0]).top - rect(sources[1]).top) > 1) {
            errors.push('The narrow page stacks the two source cards');
          }
        }
        for (const time of data.querySelectorAll('.lb-feed time')) {
          const range = document.createRange();
          range.selectNodeContents(time);
          if (range.getClientRects().length > 1) { errors.push('A feed timestamp wraps onto another line'); }
        }
        for (const stats of data.querySelectorAll('.lb-mini-stats')) {
          const widths = [...stats.children].map((cell) => rect(cell).width);
          if (Math.max(...widths) - Math.min(...widths) > 1) {
            errors.push('Activity counters do not occupy equal-width columns');
          }
        }
        return errors;
      })()`)
          : [];
      const pveErrors = showingPve ? await pveProof(win, load.sc.session) : [];
      const detailErrors = load.sc.session != null && load.stateName !== "session-next" ? await detailProof(win, load.sc.session) : [];
      const all = [
        ...detailErrors,
        ...pveErrors,
        ...replayProof,
        ...pressFailed,
        ...(waitingFor.length > 0 ? [`the page never settled: no ${waitingFor.join(", no ")}`] : []),
        ...problems,
        ...refused.map((r) => `the content-security policy refused ${r}`),
        ...logged.map((m) => `the page logged an error: ${m}`),
        ...offered.filter((r) => !expectedRoutes.includes(r)).map((r) => `the sidebar offers #/${r}, which is not a route`),
        ...expectedRoutes.filter((r) => !offered.includes(r)).map((r) => `the sidebar does not offer #/${r}`),
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
    if (load.expect.dialog || load.expect.drawer || load.expect.panel != null) {
      // Measured at every width, the dialog, the drawer or the connection's panel is answered at the
      // last one: no scenario of its own (the count stays the product of the lists), its faults are
      // the last width's.
      const keys = load.expect.dialog
        ? await dialogKeys(win)
        : load.expect.drawer
          ? await settingsKeys(win, load)
          : await connectionKeys(win, load);
      const last = results.at(-1);
      if (keys.length > 0 && last != null) {
        if (last.all.length === 0) {
          failed += 1;
        }
        last.all.push(...keys);
      }
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
  for (const load of animatedLoads) {
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
