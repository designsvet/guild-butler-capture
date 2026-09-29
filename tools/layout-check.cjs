#!/usr/bin/env node
/**
 * Does every state fit the window? `pnpm check:layout` (CI runs it under xvfb).
 *
 * The window is one fixed 660x620 for every state (owner ruling, 2026-08-29), so
 * a layout mistake does not scroll or wrap — it CLIPS, silently, and only in the
 * states nobody happens to open. It has happened twice: the waiting hints
 * (fixed 2026-08-30) and the not-yet-paired card, which pushed the Start button
 * under itself and the status line off the top in every not-paired state, in all
 * six languages, from 0.8.5 to 0.8.7 — found by hand on 2026-09-21 and shipped
 * twice more before it was fixed. Unit tests could not see it; only the real
 * renderer at the real size can.
 *
 * So this drives the BUILT renderer (dist/web/renderer — what ships) in an
 * Electron window at 660x620, behind a stub bridge (layout-check-preload.cjs)
 * that answers from a scenario: six languages × five capture states × paired or
 * not, plus every overlay opened. For each it measures the greeting and fails on:
 * a greeting line or the Start/Stop pill cut by the greeting's edges, the pill
 * squashed or under the pairing card, the card off the window, an overlay under
 * the title bar, the waiting reasons or the connected details over the pill, the
 * pairing pitch clamped, anything wider than the window.
 *
 * Plain CommonJS, run by Electron itself: `electron tools/layout-check.cjs`.
 * OUT=<dir> also writes a PNG per scenario — the quickest way to look at all of
 * them. Exits 1 on any failure.
 */

"use strict";

const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const PAGE = join(ROOT, "dist", "web", "renderer", "index.html");
const OUT = process.env.OUT ? resolve(process.env.OUT) : null;
const WIDTH = 660; // src/main/index.ts createWindow — content size
const HEIGHT = 620;
const TITLE_BAR = 48; // .app-header

// Final frames, not mid-transition ones: every duration collapses to zero.
app.commandLine.appendSwitch("force-prefers-reduced-motion");
// CI runs as root in a container-like runner, where Chromium's sandbox cannot start.
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");

const LANGS = ["en", "uk", "ru", "de", "fr", "pt"]; // src/shared/i18n.ts SUPPORTED_LANGS
const STATES = ["idle", "waiting", "waitingLong", "capturing", "health"];

const scenarios = () => {
  const list = [];
  for (const lang of LANGS) {
    const base = { lang, platform: "darwin", theme: "obsidian" };
    for (const state of STATES) {
      for (const paired of [false, true]) {
        list.push({ ...base, state, paired, name: `${lang}-${state}-${paired ? "paired" : "unpaired"}` });
      }
    }
    list.push({ ...base, state: "idle", paired: false, click: ["btn-pair-open"], name: `${lang}-pair-steps` });
    list.push({
      ...base,
      state: "capturing",
      paired: false,
      click: ["btn-pair-open"],
      type: "ABCD-EFGH",
      then: ["btn-pair"],
      name: `${lang}-pair-steps-refused`,
    });
    list.push({ ...base, state: "capturing", paired: true, click: ["btn-pairing-more"], name: `${lang}-pair-details` });
    list.push({ ...base, state: "waitingLong", paired: false, click: ["btn-waiting-hints"], name: `${lang}-waiting-hints` });
  }
  // The Windows header pads the other side; parchment is the other set of tokens.
  list.push({ lang: "en", platform: "win32", theme: "obsidian", state: "idle", paired: false, name: "en-win32-idle" });
  list.push({ lang: "en", platform: "darwin", theme: "parchment", state: "idle", paired: false, name: "en-parchment-idle" });
  return list;
};

// Runs in the page. Returns the list of problems (empty = fits).
const MEASURE = `(() => {
  const problems = [];
  const box = (id) => {
    const e = document.getElementById(id);
    if (e == null || e.closest('[hidden], .hidden') != null) return null;
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? b : null;
  };
  const overlaps = (a, b) => a != null && b != null && a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;
  const hero = box('hero');
  const pill = box('btn-primary');
  const card = box('pairing-panel');
  for (const id of ['status-label', 'hero-character', 'stat-loot', 'stat-loot-label', 'traffic-chip', 'status-hint', 'btn-primary']) {
    const b = box(id);
    if (b != null && hero != null && (b.top < hero.top - 0.5 || b.bottom > hero.bottom + 0.5)) problems.push(id + ' is cut by the greeting');
  }
  if (pill == null) problems.push('the Start/Stop pill is not drawn');
  if (pill != null && pill.height < 50) problems.push('the pill is squashed to ' + Math.round(pill.height) + 'px');
  if (pill != null && card != null && pill.bottom > card.top + 0.5) problems.push('the pill is under the pairing card');
  if (card != null && card.bottom > ${HEIGHT} + 0.5) problems.push('the pairing card runs off the window');
  for (const id of ['pairing-steps', 'pairing-details', 'waiting-hints', 'settings-popover']) {
    const b = box(id);
    if (b != null && b.top < ${TITLE_BAR} - 0.5) problems.push(id + ' opens under the title bar');
  }
  // These two exist to leave the pill reachable (index.html). The pairing steps
  // cover it on purpose: pairing is its own task, and they close on a click.
  for (const id of ['pairing-details', 'waiting-hints']) {
    if (overlaps(box(id), pill)) problems.push(id + ' covers the pill');
  }
  const intro = box('pairing-intro');
  if (intro != null) {
    const e = document.getElementById('pairing-intro');
    if (e.scrollHeight > e.clientHeight + 1) problems.push('the pairing pitch is clamped');
  }
  for (const row of document.querySelectorAll('.pair-step')) {
    if (row.closest('[hidden], .hidden') != null) continue;
    const r = row.getBoundingClientRect();
    for (const c of row.children) {
      const b = c.getBoundingClientRect();
      if (b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5)) problems.push('a pairing step spills: ' + (c.id || c.className));
    }
  }
  if (document.documentElement.scrollWidth > ${WIDTH}) problems.push('the page is wider than the window');
  const spare = hero == null ? null : (() => {
    const stack = document.getElementById('hero-stack');
    const used = (stack.offsetParent == null ? 0 : stack.getBoundingClientRect().height) + document.querySelector('.cta-row').getBoundingClientRect().height + 24;
    return Math.round(hero.height - used);
  })();
  return { problems, spare };
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const click = async (win, ids) => {
  for (const id of ids ?? []) {
    await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`);
    await wait(150);
  }
};

const run = async () => {
  if (OUT != null) {
    mkdirSync(OUT, { recursive: true });
  }
  let failed = 0;
  for (const sc of scenarios()) {
    const win = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: HEIGHT,
      useContentSize: true,
      frame: false,
      webPreferences: {
        offscreen: true,
        preload: join(__dirname, "layout-check-preload.cjs"),
        contextIsolation: true,
        sandbox: false,
        additionalArguments: [`--gbc-scenario=${Buffer.from(JSON.stringify(sc)).toString("base64")}`],
      },
    });
    await win.loadFile(PAGE);
    // the boot promises (state, settings → language, pairing) settle, the swaps finish
    await wait(700);
    await click(win, sc.click);
    if (sc.type != null) {
      await win.webContents.executeJavaScript(`document.getElementById('pairing-code').value = ${JSON.stringify(sc.type)}`);
    }
    await click(win, sc.then);
    await wait(250);
    const { problems, spare } = await win.webContents.executeJavaScript(MEASURE);
    if (OUT != null) {
      writeFileSync(join(OUT, `${sc.name}.png`), (await win.webContents.capturePage()).toPNG());
    }
    win.destroy();
    failed += problems.length > 0 ? 1 : 0;
    console.log(`${problems.length > 0 ? "FAIL" : "ok  "} ${sc.name.padEnd(30)} spare ${String(spare).padStart(4)}px  ${problems.join("; ")}`);
  }
  console.log(failed > 0 ? `\n${failed} state(s) do not fit ${WIDTH}x${HEIGHT}.` : `\nEvery state fits ${WIDTH}x${HEIGHT}.`);
  return failed;
};

// Destroying the last window must not end the run between scenarios.
app.on("window-all-closed", () => {});

app.whenReady().then(
  () =>
    run().then(
      (failed) => app.exit(failed > 0 ? 1 : 0),
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
