/** Check the shipped PNGs in Chromium and the real renderer's portrait/error fallback sinks.
 * pnpm check:portraits — recorded data behind the stub bridge; no game, engine or bot traffic.
 */
"use strict";
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");
const { favorOnlySession, replayedSession, fromSource } = require("./session-fixture.cjs");
const stubItemArt = require("./item-art-stub.cjs");
const ROOT = resolve(__dirname, "..");
const PAGE = join(ROOT, "dist/web/app/index.html");
const IMP = "./albion/mob-MORGANADEMONIMP1.png";
const SKULL = "./albion/u-skull_gold.png";
// Concurrent local renderer tools must never share Chromium's default profile.
app.setPath("userData", mkdtempSync(join(tmpdir(), "gbc-portrait-check-")));
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-prefers-reduced-motion");
app.on("window-all-closed", () => {});
setTimeout(() => {
  console.error("Portrait check timed out");
  app.exit(1);
}, 120_000).unref();

const run = async () => {
  stubItemArt();
  const manifest = JSON.parse(readFileSync(join(ROOT, "dist/web/app/albion/mob-portraits.json"), "utf8"));
  const selected = new Set(manifest.portraits.map((row) => row.avatar));
  const { mobInfo } = fromSource("src/shared/session/names.ts");
  const open = (session) =>
    new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      useContentSize: true,
      frame: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        sandbox: false,
        preload: join(__dirname, "layout-check-preload.cjs"),
        additionalArguments: [
          `--gbc-scenario=${Buffer.from(JSON.stringify({ state: "capturing", theme: "obsidian", lang: "en", platform: "darwin", session })).toString("base64")}`,
        ],
      },
    });
  const load = async (win, route) => {
    await win.loadFile(PAGE, { hash: `/${route}` });
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const root = document.querySelector('[data-${route === "pve" ? "pve" : "session"}-data]');
        if (root && [...root.querySelectorAll('img')].every((img) => img.complete)) { resolve(); }
        else if (Date.now() >= deadline) { reject(new Error('Portrait renderer did not settle')); }
        else { setTimeout(check, 25); }
      };
      document.fonts.ready.then(check);
    })`);
  };
  let win = open(favorOnlySession());
  await load(win, "pve");
  const countLoaded = (file) =>
    win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('img')).filter((img) => img.getAttribute('src') === ${JSON.stringify(file)} && img.naturalWidth > 0).length`,
    );
  assert.equal(await countLoaded(IMP), 3, "Summoned Imp must render in the mob list and both standouts");
  assert.deepEqual(
    await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.lb-pve-mobs .lb-mob-portrait, .lb-pve-standouts .lb-mob-portrait')).map((frame) => [frame.getBoundingClientRect().width, frame.getBoundingClientRect().height])`,
    ),
    [
      [56, 56],
      [44, 44],
      [44, 44],
    ],
    "Portrait sizes must match approved F3",
  );
  assert.deepEqual(
    await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.lb-pve-mobs .lb-mob-portrait, .lb-pve-standouts .lb-mob-portrait')).map((frame) => { const box = frame.getBoundingClientRect(); const image = frame.querySelector('img').getBoundingClientRect(); return [Math.round(image.width / box.width * 1000), Math.round((box.left - image.left) / image.width * 1000), Math.round((box.top - image.top) / image.height * 1000)]; })`,
    ),
    [
      [2000, 250, 250],
      [2000, 250, 250],
      [2000, 250, 250],
    ],
    "Source padding must be cropped to F3's visible native medallion",
  );
  const decoded = await win.webContents.executeJavaScript(`(async () => {
    const files = ${JSON.stringify(manifest.portraits)};
    const errors = [];
    for (let offset = 0; offset < files.length; offset += 16) {
      await Promise.all(files.slice(offset, offset + 16).map(async (row) => {
        const image = new Image();
        image.src = './albion/' + row.file;
        try {
          await image.decode();
          if (image.naturalWidth !== row.width || image.naturalHeight !== row.height) { errors.push(row.file + ': wrong dimensions'); }
        } catch { errors.push(row.file + ': failed to decode'); }
      }));
    }
    return errors;
  })()`);
  assert.deepEqual(decoded, [], "Every packaged portrait must decode in the shipping browser");
  console.log(`Decoded ${manifest.portraits.length} built portrait PNGs.`);
  await load(win, "session");
  assert.equal(await countLoaded(IMP), 1, "Session's recorded kill must use the same portrait");
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Network.enable");
  await cdp.sendCommand("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.sendCommand("Network.setBlockedURLs", { urls: ["*mob-MORGANADEMONIMP1.png"] });
  await load(win, "pve");
  // onError updates React after the failed image event; wait for all three actual sinks.
  const fallback = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const images = [...document.querySelectorAll('.lb-pve-mobs img, .lb-pve-standouts img')];
      const correct = images.length === 3 && images.every((img) => img.getAttribute('src') === ${JSON.stringify(SKULL)} && img.naturalWidth > 0);
      if (correct || Date.now() >= deadline) { resolve(correct); } else { setTimeout(check, 25); }
    };
    check();
  })`);
  assert.equal(fallback, true, "A failed portrait must become a loaded skull, never a broken image");
  console.log("Summoned Imp PvE/feed and forced-failure skull passed.");
  // An identical file URL can keep the same React tree; a new renderer is a fresh app view.
  win.destroy();
  win = open(favorOnlySession());
  await load(win, "pve");
  assert.equal(await countLoaded(IMP), 3, "A fresh render must recover after the failed request");
  win.destroy();

  const recorded = open(replayedSession());
  await load(recorded, "pve");
  const rows = await recorded.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('[data-pve-mob]')).map((row) => ({ id: Number(row.dataset.pveMob), src: row.querySelector('img')?.getAttribute('src'), loaded: row.querySelector('img')?.naturalWidth > 0 }))`,
  );
  assert.equal(rows.length, 29);
  for (const row of rows) {
    const avatar = mobInfo(row.id)?.avatar;
    assert.equal(
      row.src,
      selected.has(avatar) ? `./albion/mob-${avatar}.png` : SKULL,
      `Wrong recorded mob portrait: ${row.id}`,
    );
    assert.equal(row.loaded, true, `Recorded portrait did not load: ${row.id}`);
  }
  recorded.destroy();
  console.log(
    `Portraits: ${manifest.portraits.length} built PNGs decoded; 29 recorded kinds matched; Summoned Imp PvE/feed, failed-image skull and recovery passed.`,
  );
};

app
  .whenReady()
  .then(() => run())
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    },
  );
