"use strict";
// Built-only UI acceptance. Fake bridge + denied HTTP(S); no native capture/profile or production report.
const { app, BrowserWindow, session } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const ROOT = resolve(__dirname, "..");
const OUT = resolve(process.env.OUT || join(ROOT, "dist/qa/desktop-support"));
app.setPath("userData", join(OUT, "profile"));
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("force-prefers-reduced-motion");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const waitFor = async (win, expression) => { for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(expression)) return; await sleep(50); } throw new Error(`Timed out: ${expression}`); };
const press = async (win, label) => {
  const found = await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && b.getClientRects().length && !b.disabled); if(!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true; })()`);
  if (!found) throw new Error(`Missing enabled button ${label}`);
  await sleep(50);
};
const capture = async (win, label) => { await sleep(500); const img = await win.webContents.capturePage(); const [width, height] = win.getContentSize(); writeFileSync(join(OUT, label + ".png"), img.resize({width, height, quality: "best"}).toPNG()); };
const run = async () => {
  const { supportStrings } = await import(pathToFileURL(join(ROOT, "dist/web/shared/supportStrings.js")).href);
  mkdirSync(OUT, { recursive: true });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_d, cb) => cb({ cancel: true }));
  const results = [];
  for (const renderer of ["renderer"]) for (const theme of ["obsidian", "parchment"]) for (const [width, height, lang] of (renderer === "app" ? [[768, 620, "en"], [1440, 900, "en"], [768, 620, "de"]] : [[660, 620, "en"], [660, 620, "uk"], [660, 620, "ru"], [660, 620, "de"], [660, 620, "fr"], [660, 620, "pt"]])) {
    const sc = { platform: "darwin", lang, theme, state: "idle", paired: false, support: true };
    const s = supportStrings(lang);
    const label = `${renderer}-${theme}-${lang}-${width}`;
    const errors = [];
    const win = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { preload: join(__dirname, "desktop-support-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, additionalArguments: [`--gbc-scenario=${Buffer.from(JSON.stringify(sc)).toString("base64")}`] } });
    win.webContents.on("console-message", (_e, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadFile(join(ROOT, "dist/web", renderer, "index.html"));
    await waitFor(win, `document.body.innerText.includes(${JSON.stringify(s.decline)})`);
    await capture(win, label + "-consent");
    await press(win, s.decline);
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(renderer === "app" ? "[data-settings-gear]" : "#btn-settings")}).click()`);
    await sleep(350);
    if (renderer === "renderer") {
      const bounds = await win.webContents.executeJavaScript(`(() => { const p = document.querySelector('#settings-popover').getBoundingClientRect(); const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(s.report)}); const b = button.getBoundingClientRect(); return { top:p.top, bottom:p.bottom, buttonTop:b.top, buttonBottom:b.bottom, height:innerHeight }; })()`);
      if (bounds.top < 0 || bounds.bottom > bounds.height || bounds.buttonTop < 0 || bounds.buttonBottom > bounds.height) throw new Error(`Settings support controls clipped: ${JSON.stringify(bounds)}`);
    }
    await capture(win, label + "-settings");
    await press(win, s.report);
    await waitFor(win, `document.querySelector(${JSON.stringify(renderer === "app" ? ".lb-support-form" : ".desktop-report-form")}) != null`);
    const formSelector = renderer === "app" ? ".lb-support-form" : ".desktop-report-form";
    await win.webContents.executeJavaScript(`(() => {
      const form = document.querySelector(${JSON.stringify(formSelector)});
      const inputs = [...form.querySelectorAll('input:not([type=checkbox]), textarea')];
      const values = ['Loot stopped appearing', 'Capture says running, but loot has not arrived for a week.', 'Loot should appear in the guild dashboard.', 'discord: fixture-user'];
      inputs.forEach((input, index) => { const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, values[index]); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); });
    })()`);
    await sleep(80);
    await capture(win, label + "-form");
    // User can omit diagnostics; review must carry that exact choice before sending.
    const diagnosticSelector = renderer === "app" ? '.lb-support-form button[role="switch"]' : '.desktop-report-form input[type="checkbox"]';
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(diagnosticSelector)}).click()`);
    await press(win, s.review);
    await waitFor(win, `document.body.innerText.includes(${JSON.stringify(s.preview)})`);
    const omitted = await win.webContents.executeJavaScript(`gbcStub.calls().filter(c => c.name === 'desktopReportPreview').at(-1).args[0]`);
    if (omitted.includeDiagnostics !== false || omitted.summary !== 'Loot stopped appearing') throw new Error('Draft or diagnostic choice lost before review');
    await press(win, s.back);
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(diagnosticSelector)}).click()`);
    await press(win, s.review);
    await waitFor(win, `document.body.innerText.includes(${JSON.stringify(s.preview)})`);
    await capture(win, label + "-preview");
    await press(win, s.send);
    await waitFor(win, `document.body.innerText.includes(${JSON.stringify(s.error)})`);
    await press(win, s.send);
    await waitFor(win, `document.body.innerText.includes('#42')`);
    await capture(win, label + "-receipt");
    const proof = await win.webContents.executeJavaScript(`(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, calls: gbcStub.calls(), csp: gbcCheck.refused() }))()`);
    if (proof.scrollWidth > proof.width) errors.push("Horizontal viewport overflow");
    if (proof.csp.length) errors.push(...proof.csp);
    const submissions = proof.calls.filter(c => c.name === "desktopReportSubmit");
    if (submissions.length !== 2 || submissions[0].args[0] !== submissions[1].args[0]) errors.push("Report retry lost stable identifier");
    if (proof.calls.some(c => c.name === "desktopSupportConsent" && c.args[0] !== false)) errors.push("Unexpected analytics opt-in");
    results.push({ label, errors, reportAttempts: submissions.length });
    win.destroy();
    if (errors.length) throw new Error(`${label}: ${errors.join('; ')}`);
    console.log(`PASS ${label}`);
  }
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ network: "HTTP(S) denied", fixture: true, scenarios: results }, null, 2));
};
app.whenReady().then(run).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });
setTimeout(() => { console.error("Support UI timeout"); app.exit(1); }, 120000).unref();
