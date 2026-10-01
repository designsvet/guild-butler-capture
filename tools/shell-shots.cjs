#!/usr/bin/env node
/**
 * Pictures of the v5 shell, for putting beside the boards. `pnpm build && electron tools/shell-shots.cjs`
 * (OUT=<dir>; by default a gbc-shell-shots folder in the OS's temp directory, never the repo).
 *
 * This drives the BUILT page (dist/web/app — what ships) in an offscreen Electron window behind the
 * layout check's stub bridge (layout-check-preload.cjs), which answers from a scenario instead of
 * the main process: a capture state, paired or not, a theme, a language, a platform. Nothing talks
 * to an engine, a bot or the disk.
 *
 * What a shot cannot show is what the OS draws over the window: a Mac's three lights and Windows'
 * three caption buttons are not in the page. So that the bar's padding can be judged against the
 * boards, the tool draws a stand-in for each where the OS puts them (Fh1's positions) — dashed
 * outlines, marked as the tool's, never the app's. OS_CHROME=0 leaves them out.
 *
 * Reduced motion is forced, as in the layout check: the lit sidebar icon is shot arrived and lit,
 * and the running light under a live tab does not run. SCALE=2 shoots at 2x (default 1x, so a
 * 1440×900 window is a 1440×900 picture). ONLY=<substring> shoots the scenarios whose name has it.
 *
 * The one thing it shoots in motion is the title bar's Start/Stop changing face (StartStop.tsx):
 * the `morph-*` scenarios open a window in one capture state with motion allowed again (DevTools'
 * media emulation over the switch above), push the next state through the stub bridge, stop every
 * animation in the button the moment the change lands, and photograph the bar at each of FRAMES —
 * the page's own animations, sought to that millisecond, not a timer racing them. Then they lay the
 * frames out side by side in one picture, `morph-strip.png` (STRIP=<file name> for another name;
 * FRAMES=<ms,ms,…> for other moments — the sheen, say, which laps on long after the drain).
 *
 * The notices (board Fh5) and the broken decoder's dialog (Fh4, option D): the `notice-*` scenarios
 * shoot every notice in the band, at 1440 and at 768, in both themes, and the `dialog-*` ones the
 * dialog over the page. A scenario's `press` clicks a button first, as a member would — the fix that
 * reports back (the password prompt closed), the driver install that is still fetching, "Later" on
 * the dialog so the band shows on its own. Each band is also cropped out and laid in a sheet per theme
 * and width, `notices-<theme>-<width>.png`, in Fh5's order (ONLY=notice for those alone).
 *
 * Not a check: it measures nothing and passes everything. tools/shell-layout-check.cjs measures.
 */

"use strict";

const { app, BrowserWindow } = require("electron");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const morph = require("./shell-morph.cjs");

const ROOT = resolve(__dirname, "..");
const PAGE = join(ROOT, "dist", "web", "app", "index.html");
const OUT = resolve(process.env.OUT ?? join(tmpdir(), "gbc-shell-shots"));
const SCALE = process.env.SCALE ?? "1";
const OS_CHROME = process.env.OS_CHROME !== "0";
const ONLY = process.env.ONLY ?? "";
const STRIP = process.env.STRIP ?? "morph-strip.png";

/**
 * The morph in both directions, as the logger really goes: Start pressed (idle → starting: the gold
 * drains to a dimmed, refusing Stop with the sheen over it) and the logger stopped (stopping → idle:
 * the gold refills). Then the same for the error state's neutral Start, whose lifted surface is the
 * one that drains and refills: Start pressed again (error → starting) and the logger failing as it
 * starts (starting → error). Frames every 110ms across the 440ms drain (FRAMES=… for others), the
 * first one the instant of the change, the last its end. ONLY=morph-st shoots the gold pair alone.
 */
const MORPHS = [
  { morph: "start", from: "idle", to: "starting", title: "Start capture → Stop", note: "Start pressed: idle → starting" },
  { morph: "stop", from: "stopping", to: "idle", title: "Stop → Start capture", note: "the logger stopped: stopping → idle" },
  { morph: "retry", from: "error", to: "starting", title: "Start capture (neutral) → Stop", note: "Start pressed in the error state: error → starting" },
  { morph: "fail", from: "starting", to: "error", title: "Stop → Start capture (neutral)", note: "the logger failed as it started: starting → error" },
];
const FRAMES = (process.env.FRAMES ?? "0,110,220,330,440").split(",").map(Number);
/** The bar's right end, where the change happens: the status's end, the button, the version, the gear. */
const CROP_WIDTH = 520;

/** "Later" on the broken decoder's dialog: the band alone, as it stays. */
const LATER = "[data-dialog-later]";

/**
 * Every notice of board Fh5, in its order: what the stub bridge answers (layout-check-preload.cjs)
 * and, where the board draws a notice after a press, the press. On the platform each belongs to;
 * the decoder's own and the update's on Windows (the only platform that updates itself), except the
 * Mac's "Get the update". The decoder's notices over a paired capture, so the foot says "Held until
 * the update".
 */
const NOTICES = [
  { notice: "mac-permission", title: "Capture is blocked — macOS", state: "error", access: "no-permission", platform: "darwin" },
  { notice: "mac-cancelled", title: "…after the password prompt was closed", state: "error", access: "no-permission", fixOutcome: "cancelled", press: '[data-notice-action="fix-mac"]', platform: "darwin" },
  { notice: "npcap-missing", title: "Capture is blocked — Windows", state: "errorNpcap", access: "npcap-missing", platform: "win32" },
  { notice: "npcap-fetching", title: "…while it fetches", state: "errorNpcap", access: "npcap-missing", npcapPending: true, press: '[data-notice-action="install-npcap"]', platform: "win32" },
  { notice: "npcap-admin", title: "The driver is there but locked to administrators", state: "error", access: "npcap-admin-only", platform: "win32" },
  { notice: "engine-missing", title: "The engine folder is missing (idle: the setup probe knows)", state: "idle", engineMissing: true, platform: "darwin" },
  { notice: "abi", title: "The engine needs a rebuild", state: "errorAbi", platform: "darwin" },
  { notice: "decoder-ready", title: "A game update broke the decoder — the fix is downloaded", state: "health", update: { phase: "ready", version: "0.9.1" }, paired: true, upload: "held", press: LATER, platform: "win32" },
  { notice: "decoder-not-out", title: "…the fix is not out yet", state: "health", update: { phase: "up-to-date" }, paired: true, upload: "held", press: LATER, platform: "win32" },
  { notice: "decoder-downloading", title: "…while the fix downloads", state: "health", update: { phase: "downloading", version: "0.9.1", percent: 40 }, paired: true, upload: "held", press: LATER, platform: "win32" },
  { notice: "decoder-manual", title: "…on a Mac, which does not update by itself", state: "health", update: { phase: "off" }, paired: true, upload: "held", press: LATER, platform: "darwin" },
  { notice: "logger-stopping", title: "The logger keeps stopping (the fourth restart in a row)", state: "restartingAgain", paired: true, platform: "darwin" },
  { notice: "update-ready", title: "An update is ready", state: "idle", update: { phase: "ready", version: "0.9.1" }, platform: "win32" },
  { notice: "update-ready-capturing", title: "…while capturing", state: "capturing", update: { phase: "ready", version: "0.9.1" }, paired: true, platform: "win32" },
];
/** The dialog a broken decoder interrupts with (Fh4, option D): once found, and once the fix is down. */
const DIALOGS = [
  { dialog: "fix-ready", state: "health", update: { phase: "ready", version: "0.9.1" }, paired: true, upload: "held", platform: "win32" },
  { dialog: "not-out", state: "health", update: { phase: "up-to-date" }, paired: true, upload: "held", platform: "darwin" },
];

app.commandLine.appendSwitch("force-prefers-reduced-motion");
app.commandLine.appendSwitch("force-device-scale-factor", SCALE);
app.commandLine.appendSwitch("disable-gpu");

const scenarios = () => {
  const list = [];
  const add = (sc) => {
    const size = `${sc.width}x${sc.height}`;
    const pairing = sc.paired ? `-paired${sc.upload ? `-${sc.upload}` : ""}` : "";
    list.push({ lang: "en", paired: false, ...sc, name: sc.name ?? `${sc.state}${pairing}-${sc.theme}-${sc.platform}-${size}` });
  };
  for (const platform of ["darwin", "win32"]) {
    for (const theme of ["obsidian", "parchment"]) {
      for (const state of ["waiting", "waitingLong", "idle", "capturing", "capturingNew", "starting", "restarting", "error"]) {
        add({ state, theme, platform, width: 1440, height: 900 });
      }
    }
    for (const [width, height] of [
      [1024, 768],
      [768, 620],
    ]) {
      add({ state: "waiting", theme: "obsidian", platform, width, height });
      add({ state: "capturing", theme: "obsidian", platform, width, height, paired: true, sentAgoMs: 60_000 });
    }
  }
  // The foot's states (board Fh2), on the Mac at full width.
  for (const upload of ["up-to-date", "sending", "retrying", "unauthorized", "blocked", "bot-outdated"]) {
    add({ state: "capturing", theme: "obsidian", platform: "darwin", width: 1440, height: 900, paired: true, upload, sentAgoMs: 60_000 });
  }
  add({ state: "capturing", theme: "obsidian", platform: "darwin", width: 1440, height: 900, paired: true, uploadEnabled: false, name: "capturing-paired-off-obsidian-darwin-1440x900" });
  add({ state: "stopping", theme: "obsidian", platform: "darwin", width: 1440, height: 900 });
  // The keyboard's view: the skip link, focused; in the rail a page's label comes back as a tooltip
  // on focus (board Fa). `focus` names what holds the focus in the shot.
  add({ state: "waiting", theme: "obsidian", platform: "darwin", width: 1440, height: 900, focus: ".gb-skip", name: "keyboard-skip-link-obsidian-darwin-1440x900" });
  add({ state: "waiting", theme: "obsidian", platform: "win32", width: 1024, height: 768, focus: ".lb-nav", name: "keyboard-rail-tooltip-obsidian-win32-1024x768" });
  add({ state: "waiting", theme: "parchment", platform: "win32", width: 1024, height: 768, focus: ".lb-nav", name: "keyboard-rail-tooltip-parchment-win32-1024x768" });
  // Long words: the bar and the cards in the languages that run longest.
  for (const lang of ["de", "ru", "uk"]) {
    add({ state: "restarting", theme: "obsidian", platform: "win32", width: 768, height: 620, lang, name: `restarting-${lang}-obsidian-win32-768x620` });
    add({ state: "waitingLong", theme: "obsidian", platform: "darwin", width: 1024, height: 768, lang, name: `waitingLong-${lang}-obsidian-darwin-1024x768` });
  }
  // Windows high contrast (DevTools' forced-colours emulation): the button's layers give way to the
  // system's own border, and Stop keeps its square. `forced` turns the emulation on.
  for (const state of ["idle", "capturing", "starting", "error"]) {
    add({ state, theme: "obsidian", platform: "win32", width: 1440, height: 900, forced: true, name: `forced-colors-${state}-win32-1440x900` });
  }
  // …and a notice in the band, and the dialog, under it (not laid in the sheets).
  const npcap = NOTICES.find((n) => n.notice === "npcap-missing");
  add({ ...npcap, theme: "obsidian", width: 1440, height: 900, forced: true, sheet: false, name: "forced-colors-notice-npcap-missing-win32-1440x900" });
  add({ ...DIALOGS[0], theme: "obsidian", width: 1440, height: 900, forced: true, name: "forced-colors-dialog-fix-ready-win32-1440x900" });
  // The notices in the band (Fh5) and the broken decoder's dialog (Fh4 D), at 1440 and 768, both themes.
  for (const theme of ["obsidian", "parchment"]) {
    for (const [width, height] of [
      [1440, 900],
      [768, 620],
    ]) {
      for (const n of NOTICES) {
        add({ ...n, theme, width, height, name: `notice-${n.notice}-${theme}-${n.platform}-${width}x${height}` });
      }
      for (const d of DIALOGS) {
        add({ ...d, theme, width, height, name: `dialog-${d.dialog}-${theme}-${d.platform}-${width}x${height}` });
      }
    }
  }
  // The Start/Stop morph, frame by frame (board Fh1's button), in both themes.
  for (const theme of ["obsidian", "parchment"]) {
    for (const m of MORPHS) {
      add({ ...m, state: m.from, theme, platform: "darwin", width: 1440, height: 900, name: `morph-${m.morph}-${theme}` });
    }
  }
  return list.filter((sc) => sc.name.includes(ONLY));
};

/** The frames, side by side: a row per direction, a section per theme, the times along the top. */
const stripPage = (rows) => {
  const cell = (png) => `<img src="data:image/png;base64,${png.toString("base64")}" width="${CROP_WIDTH}" height="48" alt="">`;
  const body = rows
    .map(
      (row) => `<section><h2>${row.title} <span>${row.theme} · ${row.note}</span></h2><div class="row">${row.frames
        .map((f) => `<figure>${cell(f.png)}<figcaption>${f.t} ms · ${f.width.toFixed(1)}px wide</figcaption></figure>`)
        .join("")}</div></section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 28px 32px 32px; background: #1b1a20; color: #e9e5dc; font: 13px/1.4 system-ui, sans-serif; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    p { margin: 0 0 22px; color: #a7a39b; max-width: 1100px; }
    h2 { margin: 18px 0 8px; font-size: 14px; }
    h2 span { font-weight: 400; color: #a7a39b; }
    .row { display: flex; gap: 14px; }
    figure { margin: 0; }
    img { display: block; border-radius: 6px; outline: 1px solid rgba(128, 128, 128, .35); }
    figcaption { margin-top: 5px; font: 11px/1.3 ui-monospace, monospace; color: #a7a39b; }
  </style></head><body><h1>The title bar's Start / Stop — the morph, frame by frame</h1>
  <p>The built page, the gold — in the error state the neutral, lifted surface — draining off the ember face beneath it over 440 ms and refilling on the way back, the words rolling (out upward 170 ms, in from below 260 ms), the box easing to the new words' width while the version and the gear stay put. Each frame is the page's own animations stopped at that millisecond (tools/shell-shots.cjs).</p>
  ${body}</body></html>`;
};

/**
 * The OS's own buttons, drawn by this tool where the OS draws them (board Fh1): a Mac's three 12px
 * lights from 18px in, centred on the 48px bar; Windows' three 46×48 caption buttons at the right.
 * Dashed, so no one mistakes them for the page's.
 */
const osChrome = (platform) => `(() => {
  // Built through the CSSOM: the page's policy refuses style attributes, and so it should.
  const el = (tag, css) => {
    const node = document.createElementNS(tag === 'svg' || tag === 'path' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
    if (css) node.style.cssText = css;
    return node;
  };
  const layer = el('div', 'position:fixed;inset:0 0 auto 0;height:48px;pointer-events:none;z-index:9999');
  layer.setAttribute('data-shot-stand-in', 'the OS draws these, not the page');
  if (${JSON.stringify(platform)} === 'darwin') {
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((colour, i) => {
      layer.append(el('span', 'position:absolute;top:18px;left:' + (18 + i * 20) + 'px;width:12px;height:12px;border-radius:50%;opacity:.9;background:' + colour));
    });
  } else {
    ['M5 12h14', 'M5 5h14v14h-14z', 'M6 6l12 12M18 6l-12 12'].forEach((d, i) => {
      const button = el('span', 'position:absolute;top:0;right:' + (2 - i) * 46 + 'px;width:46px;height:48px;display:flex;align-items:center;justify-content:center;outline:1px dashed rgba(128,128,128,.35);outline-offset:-1px;color:var(--gb-muted)');
      const svg = el('svg');
      for (const [k, v] of Object.entries({ width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round' })) svg.setAttribute(k, String(v));
      const path = el('path');
      path.setAttribute('d', d);
      svg.append(path);
      button.append(svg);
      layer.append(button);
    });
  }
  document.body.append(layer);
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const strip = [];
  /** The bands, cropped, by theme and width — laid out as one sheet each (sheetPage). */
  const sheets = new Map();
  for (const sc of scenarios()) {
    const win = new BrowserWindow({
      show: false,
      width: sc.width,
      height: sc.height,
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
    // The policy's refusals while the page loads reach the console; after it, the event below.
    const refusedAtLoad = [];
    const onConsole = (event) => {
      if (/Refused to|Content Security Policy/i.test(event.message ?? "")) {
        refusedAtLoad.push(event.message);
      }
    };
    win.webContents.on("console-message", onConsole);
    await win.loadFile(PAGE);
    // the boot promises settle, the stored language and theme land, the faces arrive; anything the
    // page's policy refused meanwhile is counted (the stand-ins below go in after)
    const refused = await win.webContents.executeJavaScript(
      "new Promise((r) => { const seen = []; document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective + ' ' + e.blockedURI)); document.fonts.ready.then(() => setTimeout(() => r(seen), 500)); })",
    );
    if (sc.focus != null) {
      // An offscreen window takes no keys and is never the focused window, so Chromium is told to
      // treat the page as focused (DevTools' focus emulation) and the focus is given as a keyboard
      // would leave it.
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sc.focus)}).focus({ focusVisible: true })`);
    }
    if (sc.forced) {
      // Windows' high contrast, as Chromium draws it there: the system's colours over the page's own
      if (!win.webContents.debugger.isAttached()) {
        win.webContents.debugger.attach("1.3");
      }
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    }
    win.webContents.off("console-message", onConsole);
    refused.push(...refusedAtLoad);
    if (sc.press != null) {
      // as a member would: the button, pressed (an offscreen window takes no clicks, so the page's own)
      const pressed = await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(sc.press)}); el?.click(); return el != null; })()`,
      );
      if (!pressed) {
        throw new Error(`${sc.name}: nothing to press at ${sc.press}`);
      }
      await wait(150);
    }
    if (OS_CHROME) {
      await win.webContents.executeJavaScript(osChrome(sc.platform));
    }
    if (sc.morph != null) {
      strip.push(await shootMorph(win, sc, refused));
      win.destroy();
      continue;
    }
    await wait(150);
    if (sc.notice != null && sc.sheet !== false) {
      const band = await win.webContents.executeJavaScript(
        "(() => { const r = document.querySelector('.lb-notice')?.getBoundingClientRect(); return r == null ? null : { x: r.x, y: r.y, width: r.width, height: r.height, kind: document.querySelector('.lb-notice').dataset.notice }; })()",
      );
      if (band == null) {
        throw new Error(`${sc.name}: no notice in the band`);
      }
      const pad = 12;
      const crop = {
        x: Math.max(0, Math.floor(band.x - pad)),
        y: Math.max(0, Math.floor(band.y - pad)),
        width: Math.ceil(band.width + 2 * pad),
        height: Math.ceil(band.height + 2 * pad),
      };
      const shot = await win.webContents.capturePage(crop);
      const px = Math.round(crop.width * Number(SCALE));
      const png = (shot.getSize().width === px ? shot : shot.resize({ width: px, quality: "best" })).toPNG();
      const key = `${sc.theme}-${sc.width}`;
      sheets.set(key, [...(sheets.get(key) ?? []), { title: sc.title, kind: band.kind, png, width: crop.width, height: crop.height }]);
    }
    // Offscreen windows render at the screen's own scale whatever the switch says: bring the
    // picture to the scale asked for, so SCALE=1 gives a 1440×900 window as 1440×900 pixels.
    const shot = await win.webContents.capturePage();
    const width = Math.round(sc.width * Number(SCALE));
    const picture = shot.getSize().width === width ? shot : shot.resize({ width, quality: "best" });
    writeFileSync(join(OUT, `${sc.name}.png`), picture.toPNG());
    win.destroy();
    console.log(`${refused.length > 0 ? "CSP " : "shot"} ${sc.name}${refused.length > 0 ? `  refused: ${refused.join(" | ")}` : ""}`);
  }
  if (strip.length > 0) {
    await shootStrip(strip);
  }
  for (const [key, rows] of sheets) {
    await shootSheet(`notices-${key}.png`, key, rows);
  }
};

/** The bands of one theme and width, one under another in Fh5's order, each under its scenario's name. */
const shootSheet = async (file, key, rows) => {
  const dark = key.startsWith("obsidian");
  const body = rows
    .map(
      (row) =>
        `<section><h2>${row.title} <span>${row.kind}</span></h2><img src="data:image/png;base64,${row.png.toString("base64")}" width="${row.width}" height="${row.height}" alt=""></section>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px 28px 28px; background: ${dark ? "#1b1a20" : "#e8e1d0"}; color: ${dark ? "#e9e5dc" : "#2a2418"}; font: 13px/1.4 system-ui, sans-serif; }
    h1 { margin: 0 0 14px; font-size: 17px; }
    h2 { margin: 16px 0 6px; font: 600 12px/1.3 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; }
    h2 span { font-weight: 400; opacity: .6; text-transform: none; letter-spacing: 0; }
    img { display: block; }
  </style></head><body><h1>The notices in the band — ${key.replace("-", " · ")} px (board Fh5's order; tools/shell-shots.cjs)</h1>${body}</body></html>`;
  const win = new BrowserWindow({ show: false, width: 1600, height: 400, useContentSize: true, frame: false, webPreferences: { offscreen: true } });
  // From a file, not a data: URL — fourteen bands of pictures run past what a URL may carry.
  const page = join(OUT, `.${file}.html`);
  writeFileSync(page, html);
  await win.loadFile(page);
  rmSync(page, { force: true });
  const size = await win.webContents.executeJavaScript("[document.documentElement.scrollWidth, document.documentElement.scrollHeight]");
  win.setContentSize(size[0], size[1]);
  await wait(300);
  const shot = await win.webContents.capturePage();
  const px = Math.round(size[0] * Number(SCALE));
  writeFileSync(join(OUT, file), (shot.getSize().width === px ? shot : shot.resize({ width: px, quality: "best" })).toPNG());
  win.destroy();
  console.log(`sheet ${file} (${rows.length} notices)`);
};

/**
 * One direction of the morph in one theme: motion allowed in this window alone, the change pushed,
 * the button's animations stopped at its first frame, then sought through FRAMES in order — forwards
 * only, since a frame past an animation's end lets the page tidy up after it (the old words go, the
 * width lets go), as it does in use.
 */
const shootMorph = async (win, sc, refused) => {
  await morph.allowMotion(win);
  await wait(150);
  const playing = await morph.play(win, sc.to);
  if (playing == null) {
    throw new Error(`${sc.name}: the button did not change when ${sc.to} was pushed`);
  }
  const crop = { x: sc.width - CROP_WIDTH, y: 0, width: CROP_WIDTH, height: 48 };
  const frames = [];
  for (const t of FRAMES) {
    const { width, held } = await morph.seekTo(win, t);
    const shot = await win.webContents.capturePage(crop);
    const px = Math.round(CROP_WIDTH * Number(SCALE));
    const png = (shot.getSize().width === px ? shot : shot.resize({ width: px, quality: "best" })).toPNG();
    writeFileSync(join(OUT, `${sc.name}-${String(t).padStart(3, "0")}ms.png`), png);
    frames.push({ t, width, held, png });
  }
  // and the width the button rests at once the morph has played out
  const after = await morph.playOut(win);
  const rest = await morph.seekTo(win, 0);
  console.log(
    `${refused.length > 0 ? "CSP " : "shot"} ${sc.name} ×${FRAMES.length}  (${playing.join(", ")})${refused.length > 0 ? `  refused: ${refused.join(" | ")}` : ""}`,
  );
  console.log(
    `      widths ${frames.map((f) => `${f.t}:${f.width.toFixed(2)}${f.held ? "*" : ""}`).join(" ")} · at rest ${rest.width.toFixed(2)}${after.held ? " (STILL HELD)" : ""} (* the ease holds it)`,
  );
  return { title: sc.title, note: sc.note, theme: sc.theme === "parchment" ? "Parchment" : "Obsidian", frames };
};

const shootStrip = async (rows) => {
  const win = new BrowserWindow({ show: false, width: 1600, height: 400, useContentSize: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(stripPage(rows))}`);
  const size = await win.webContents.executeJavaScript("[document.documentElement.scrollWidth, document.documentElement.scrollHeight]");
  win.setContentSize(size[0], size[1]);
  await wait(300);
  const shot = await win.webContents.capturePage();
  const px = Math.round(size[0] * Number(SCALE));
  writeFileSync(join(OUT, STRIP), (shot.getSize().width === px ? shot : shot.resize({ width: px, quality: "best" })).toPNG());
  win.destroy();
  console.log(`strip ${STRIP} (${rows.length} rows × ${FRAMES.length} frames)`);
};

app.on("window-all-closed", () => {});

app.whenReady().then(
  () =>
    run().then(
      () => app.exit(0),
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
