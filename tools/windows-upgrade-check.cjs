"use strict";
/** Real NSIS + electron-updater acceptance. Run only on disposable GitHub Windows runners.
 * Uses fixture DPAPI credentials, loopback backend/feed, and per-program outbound firewall rules.
 * Never changes a published feed, release/tag, or an owner's profile. Evidence omits credentials. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const ROOT = path.resolve(__dirname, "..");
const hash = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const args = process.argv.slice(2);
const argument = (name) => { const i = args.indexOf(name); assert.ok(i >= 0 && args[i + 1], `${name} is required`); return path.resolve(args[i + 1]); };
const baseline = argument("--baseline");
const candidate = argument("--candidate");
const evidencePath = argument("--evidence");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version;
assert.equal(process.platform, "win32", "Requires native Windows, never emulation");
assert.equal(process.env.GITHUB_ACTIONS, "true", "Only a disposable hosted runner may execute this installer test");
assert.ok(process.env.RUNNER_TEMP && process.env.APPDATA);
assert.equal(version, "0.8.10", "Review acceptance before advancing the candidate version");
const scratch = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, "capture-upgrade-"));
const installDirectory = path.join(scratch, "installed");
const exe = path.join(installDirectory, "Guild Butler Capture.exe");
const profiles = ["Guild Butler Capture", "guild-butler-capture"].map((name) => path.join(process.env.APPDATA, name));
for (const profile of profiles) assert.ok(!fs.existsSync(profile), "Never overwrite a pre-existing app profile");
const candidateBytes = fs.readFileSync(candidate);
const fixture = { installationId: randomUUID(), installationSecret: randomBytes(32).toString("base64url"), captureToken: `fixture-${randomBytes(24).toString("hex")}` };
const requests = [];
const feedRequests = [];
const evidence = { schemaVersion: 1, platform: "win32", arch: process.arch, sourceSha: process.env.SOURCE_SHA, checkoutSha: process.env.CHECKOUT_SHA, buildRun: process.env.CANDIDATE_RUN_ID, at: new Date().toISOString(), baseline: { version: "0.8.9", sha256: hash(fs.readFileSync(baseline)) }, candidate: { version, sha256: hash(candidateBytes), sha512: hash(candidateBytes, "sha512", "base64"), size: candidateBytes.length }, checks: [], limitations: ["No live Albion session or physical network capture; Npcap/game acceptance is separate.", "Auto-update is exercised through an isolated loopback feed override; the public stable feed is never changed."] };
assert.equal(evidence.baseline.sha256, "e7e949bf1ee0e7bb977a7582352d8de2259af7556e5e0b682ae13577fa08d2b4", "Released baseline checksum changed");
let server;
let child;
let currentClient;
let knownProfile;
let before;
const ruleName = `Capture acceptance ${randomUUID()}`;
const command = (file, argv, options = {}) => {
  const result = spawnSync(file, argv, { encoding: "utf8", timeout: 180_000, windowsHide: true, ...options });
  assert.equal(result.status, 0, `${path.basename(file)} failed: ${(result.stderr || result.stdout || result.error || "").toString().slice(-2000)}`);
  return result.stdout;
};
const ps = (script, env = {}) => command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env } });
const record = (name, extra = {}) => { evidence.checks.push({ name, passed: true, ...extra }); console.log(`PASS ${name}`); };
const waitFor = async (probe, label, ms = 30_000) => { const until = Date.now() + ms; while (Date.now() < until) { const result = await probe(); if (result) return result; await delay(250); } throw new Error(`Timed out: ${label}`); };
const stopApp = async () => {
  currentClient?.close(); currentClient = null;
  // Bound to our GUID install directory; never terminate by a global executable name.
  ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:ACCEPTANCE_INSTALL, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`, { ACCEPTANCE_INSTALL: installDirectory + path.sep });
  child = null; await delay(400);
};
const cdp = async (port) => {
  const target = await waitFor(async () => { try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return list.find((t) => t.type === "page" && t.url.startsWith("file:")); } catch { return false; } }, "native app window");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener("message", (event) => { const response = JSON.parse(event.data); const task = pending.get(response.id); if (!task) return; pending.delete(response.id); clearTimeout(task.timer); response.error ? task.reject(new Error(response.error.message)) : task.resolve(response.result); });
  socket.addEventListener("close", () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("Native renderer closed")); } pending.clear(); });
  const send = (method, params) => new Promise((resolve, reject) => {
    const number = ++id;
    const timer = setTimeout(() => { pending.delete(number); reject(new Error(`Timed out: ${method}`)); }, 20_000);
    pending.set(number, { resolve, reject, timer }); socket.send(JSON.stringify({ id: number, method, params }));
  });
  return { close: () => socket.close(), evaluate: async (expression) => { const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, `Shipping renderer exception: ${result.exceptionDetails?.text}`); return result.result?.value; } };
};
const launch = async (port, updates = false) => {
  const env = { ...process.env, GBC_NO_AUTO_UPDATE: updates ? "0" : "1" };
  delete env.ELECTRON_RUN_AS_NODE; delete env.GBC_MOCK_ENGINE; delete env.GBC_NO_TELEMETRY;
  child = spawn(exe, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], { env, stdio: "ignore", windowsHide: true });
  currentClient = await cdp(port);
  await waitFor(() => currentClient.evaluate("Boolean(window.gbc)"), "shipping preload");
  return currentClient;
};
const install = (file) => {
  ps(`$p = Start-Process -FilePath $env:ACCEPTANCE_INSTALLER -ArgumentList @('/S', ('/D=' + $env:ACCEPTANCE_INSTALL)) -PassThru -Wait; if ($p.ExitCode -ne 0) { throw ('NSIS exited ' + $p.ExitCode) }`, { ACCEPTANCE_INSTALLER: file, ACCEPTANCE_INSTALL: installDirectory });
  assert.ok(fs.existsSync(exe), "NSIS did not install the executable at the disposable target");
};
const files = () => {
  const settings = JSON.parse(fs.readFileSync(path.join(knownProfile, "settings.json")));
  return { settings, identity: hash(fs.readFileSync(path.join(knownProfile, "desktop-identity.json"))), capture: hash(fs.readFileSync(path.join(knownProfile, "captures/loot-events-upgrade-fixture.txt"))) };
};
const assertPreserved = () => {
  const after = files();
  for (const field of ["apiBase", "autoCapture", "uploadEnabled", "language", "theme", "pairing"]) assert.deepEqual(after.settings[field], before.settings[field], `Lost ${field} during installation`);
  assert.equal(after.identity, before.identity, "Installation identity or encrypted secret changed");
  assert.equal(after.capture, before.capture, "Existing capture file changed");
};
const appVersion = () => ps(`(Get-Item -LiteralPath $env:ACCEPTANCE_EXE).VersionInfo.ProductVersion`, { ACCEPTANCE_EXE: exe }).trim();
const main = async () => {
  server = http.createServer(async (req, res) => {
    const route = new URL(req.url, "http://127.0.0.1").pathname;
    if (route.startsWith("/updates/")) feedRequests.push({ path: route, method: req.method });
    if (route === "/updates/latest.yml") {
      res.setHeader("Content-Type", "text/yaml");
      res.end(`version: ${version}\nfiles:\n  - url: candidate.exe\n    sha512: ${evidence.candidate.sha512}\n    size: ${candidateBytes.length}\npath: candidate.exe\nsha512: ${evidence.candidate.sha512}\nreleaseDate: '${new Date().toISOString()}'\n`); return;
    }
    if (route === "/updates/candidate.exe") {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
      const start = range ? Number(range[1]) : 0; const end = range && range[2] ? Number(range[2]) : candidateBytes.length - 1;
      if (range) { res.statusCode = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${candidateBytes.length}`); }
      res.setHeader("Content-Length", end - start + 1); res.setHeader("Accept-Ranges", "bytes");
      res.end(req.method === "HEAD" ? undefined : candidateBytes.subarray(start, end + 1)); return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { res.statusCode = 400; res.end(); return; }
    requests.push({ path: req.url, body, pairingValid: req.headers["x-capture-token"] === fixture.captureToken, installationValid: req.headers.authorization === `Bearer ${fixture.installationSecret}` });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/control/desktop/reports") res.end(JSON.stringify({ ok: true, reportId: body.reportId, reportNumber: 42 }));
    else if (req.url === "/control/desktop/register" || req.url === "/control/desktop/heartbeat") res.end('{"ok":true,"accepted":true}');
    else { res.statusCode = 404; res.end('{"error":"fixture_route_not_allowed"}'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seedFile = path.join(scratch, "seed-input.json");
  fs.writeFileSync(seedFile, JSON.stringify({ ...fixture, profiles, apiBase: base }));
  const seedEnv = { ...process.env };
  delete seedEnv.ELECTRON_RUN_AS_NODE; // Presence alone selects Node mode, even when empty.
  for (const profile of profiles) {
    command(require("electron"), [path.join(__dirname, "windows-upgrade-seed.cjs"), seedFile, profile], { env: seedEnv });
    assert.ok(fs.existsSync(path.join(profile, "Local State")), "Native encryption key state was not flushed");
  }
  record("native-dpapi-fixtures-round-trip");
  ps(`New-NetFirewallRule -DisplayName $env:ACCEPTANCE_RULE -Direction Outbound -Program $env:ACCEPTANCE_EXE -Action Block -RemoteAddress Internet | Out-Null`, { ACCEPTANCE_RULE: ruleName, ACCEPTANCE_EXE: exe });
  record("installed-app-internet-blocked-by-scoped-firewall");
  install(baseline); await stopApp(); assert.ok(appVersion().startsWith("0.8.9"));
  const old = await launch(9231);
  assert.equal((await old.evaluate("window.gbc.getSetup()")).appVersion, "0.8.9");
  assert.equal((await old.evaluate("window.gbc.getPairing()")).guildId, "111111111111111111");
  assert.equal((await old.evaluate("window.gbc.getState()")).status, "idle");
  knownProfile = profiles.find((p) => fs.existsSync(path.join(p, "logs/capture-app.log")));
  assert.ok(knownProfile, "Could not identify the fixture profile actually used by the released app");
  before = files(); await stopApp(); record("released-0.8.9-installs-and-opens-fixture-profile", { profileName: path.basename(knownProfile) });
  install(candidate); await stopApp(); assertPreserved();
  const next = await launch(9232);
  assert.equal((await next.evaluate("window.gbc.getSetup()")).appVersion, version);
  assert.equal((await next.evaluate("window.gbc.getPairing()")).guildId, "111111111111111111");
  assert.equal((await next.evaluate("window.gbc.getState()")).status, "idle");
  assert.equal((await next.evaluate("window.gbc.desktopSupportGet()")).telemetryEnabled, true);
  const preview = await next.evaluate("window.gbc.desktopReportPreview({category:'capture',summary:'Fixture upgrade check',description:'Synthetic acceptance report',expected:'Preserve pairing and captures',includeDiagnostics:true})");
  assert.ok(preview?.reportId, "Packaged report preview unavailable");
  const receipt = await next.evaluate(`window.gbc.desktopReportSubmit(${JSON.stringify(preview.reportId)})`);
  assert.equal(receipt.ok, true, `Report result: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.reportNumber, 42);
  const request = requests.find((r) => r.path === "/control/desktop/reports");
  assert.ok(request?.pairingValid && request.installationValid, "Packaged app did not decrypt preserved DPAPI credentials");
  assert.ok(requests.some((r) => r.path === "/control/desktop/register" && r.body.installationId === fixture.installationId && r.body.version === version));
  assertPreserved(); await stopApp(); record("native-nsis-upgrade-preserves-settings-pairing-captures-identity", { from: "0.8.9", to: version, reportReceipt: 42, dpapiDecryptedByPackagedApp: true });
  const engine = path.join(installDirectory, "resources/engine");
  const decoder = command(exe, [path.join(__dirname, "verify-engine-protocol.cjs"), engine], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  assert.ok(decoder.includes("Packaged decoder verified"));
  evidence.engine = JSON.parse(fs.readFileSync(path.join(ROOT, "resources/engine-lock.json")));
  record("installed-engine-source-hashes-and-october-decoder-fixtures");
  const builder = createRequire(require.resolve("electron-builder")); const lib = createRequire(builder.resolve("app-builder-lib")); const asar = lib("@electron/asar");
  const archive = path.join(installDirectory, "resources/app.asar");
  const builtFiles = (directory) => fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? builtFiles(file) : [file];
  });
  const manifest = builtFiles("dist").filter((file) => file !== path.join("dist", "buildstamp.json")).sort().map((file) => {
    const expected = hash(fs.readFileSync(path.join(ROOT, file)));
    // ASAR's directory walker splits on the native separator on Windows.
    assert.equal(hash(asar.extractFile(archive, path.normalize(file))), expected, `Artifact/source mismatch ${file}`);
    return { file: file.split(path.sep).join("/"), sha256: expected };
  });
  evidence.candidate.compiledFileCount = manifest.length;
  evidence.candidate.compiledManifestSha256 = hash(JSON.stringify(manifest));
  evidence.candidate.asarSha256 = hash(fs.readFileSync(archive)); record("installed-app-matches-reviewed-source-build");
  install(candidate); await stopApp(); assertPreserved(); record("native-reinstall-preserves-existing-profile");
  // Real updater path: only this disposable baseline copy's provider is redirected.
  install(baseline); await stopApp();
  assert.ok(appVersion().startsWith("0.8.9"), "Disposable baseline downgrade did not restore 0.8.9");
  const configFile = path.join(installDirectory, "resources/app-update.yml");
  evidence.updaterConfigOriginalSha256 = hash(fs.readFileSync(configFile));
  fs.writeFileSync(configFile, `provider: generic\nurl: ${base}/updates/\nupdaterCacheDirName: capture-acceptance-${path.basename(scratch)}\n`);
  const updating = await launch(9233, true);
  assert.equal((await updating.evaluate("window.gbc.getSetup()")).appVersion, "0.8.9");
  await updating.evaluate("window.gbc.updateCheckNow()");
  await waitFor(async () => {
    const status = await updating.evaluate("window.gbc.getUpdate()");
    if (status.phase === "error") throw new Error(`Local updater failed: ${status.error}`);
    return status.phase === "ready";
  }, "loopback update download", 180_000);
  assert.equal((await updating.evaluate("window.gbc.getState()")).status, "idle");
  const restarted = await updating.evaluate("window.gbc.updateRestart()").catch((error) => { if (error.message !== "Native renderer closed") throw error; return { ok: true, rendererClosed: true }; });
  assert.ok(restarted.ok);
  currentClient?.close(); currentClient = null;
  await waitFor(() => { try { return appVersion().startsWith(version); } catch { return false; } }, "native updater installer replacement", 180_000);
  await delay(4000); await stopApp();
  assert.equal(hash(fs.readFileSync(archive)), evidence.candidate.asarSha256, "Updater installed different app bytes");
  assertPreserved();
  const reopened = await launch(9234);
  assert.equal((await reopened.evaluate("window.gbc.getSetup()")).appVersion, version);
  assert.equal((await reopened.evaluate("window.gbc.getPairing()")).guildId, "111111111111111111");
  const afterUpdatePreview = await reopened.evaluate("window.gbc.desktopReportPreview({category:'update',summary:'Fixture after real update',description:'Synthetic acceptance report',expected:'Preserve encrypted credentials',includeDiagnostics:false})");
  assert.ok(afterUpdatePreview?.reportId);
  assert.equal((await reopened.evaluate(`window.gbc.desktopReportSubmit(${JSON.stringify(afterUpdatePreview.reportId)})`)).ok, true);
  assert.ok(feedRequests.some((r) => r.path === "/updates/latest.yml") && feedRequests.some((r) => r.path === "/updates/candidate.exe"));
  assertPreserved(); await stopApp(); record("real-electron-updater-0.8.9-to-0.8.10-via-isolated-loopback-feed");
  evidence.passed = true;
};
main().catch((error) => { evidence.passed = false; evidence.error = error.message; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  try { await stopApp(); } catch {}
  try { ps(`Get-NetFirewallRule -DisplayName $env:ACCEPTANCE_RULE -ErrorAction SilentlyContinue | Remove-NetFirewallRule`, { ACCEPTANCE_RULE: ruleName }); } catch {}
  server?.close();
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  // Never serialize fixture tokens, request headers, profile files or the seed input.
  evidence.backendRequestPaths = requests.map((r) => r.path);
  evidence.loopbackFeedRequests = feedRequests;
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
});
