#!/usr/bin/env node
/**
 * Build the standalone public-repo tree for designsvet/guild-butler-capture
 * (ADR 0096: the app must be public source before any installer is handed to
 * a guildmate — the GPL source-offer).
 *
 *   node tools/extract-public-repo.mjs <out-dir> [--commit]
 *
 * Run from the STAGED layout (a raid-bot checkout). What it does:
 *  1. Copies exactly the git-TRACKED files of guild-butler-capture/ (via
 *     `git ls-files`, so no untracked local state can leak) to <out-dir>.
 *  2. De-stages the Windows workflow (.github/workflows/capture-windows.yml
 *     from the raid-bot root): plain checkout instead of sparse, paths
 *     without the guild-butler-capture/ prefix, push-to-main trigger. The
 *     result is validated to contain no staged-path remnants.
 *  3. Writes the public repo's own ci.yml (tests + typecheck on ubuntu).
 *  4. Adds the repository field to package.json and a provenance section to
 *     the README, and prints every remaining "staged"/"raid-bot" mention for
 *     a human pass — prose references to the companion bot are legitimate;
 *     the reviewer decides, not a regex.
 *  5. With --commit: git init + ONE extraction commit. Deliberately a fresh
 *     history — never a filtered export of the private repo's history.
 *
 * Publishing the result is a HUMAN action (owner ruling: nothing goes public
 * until the first installer is ready to share and the owner says go).
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stagedRoot = dirname(appRoot); // the raid-bot checkout

const outDir = process.argv[2] != null ? resolve(process.argv[2]) : null;
const doCommit = process.argv.includes("--commit");
if (outDir == null) {
  console.error("usage: node tools/extract-public-repo.mjs <out-dir> [--commit]");
  process.exit(2);
}

const git = (args, cwd = stagedRoot) => execFileSync("git", args, { cwd, encoding: "utf8" });

// --- 1. exactly the tracked tree -------------------------------------------
const tracked = git(["ls-files", "--", "guild-butler-capture"])
  .split("\n")
  .filter((l) => l.length > 0);
if (tracked.length < 30) {
  console.error(`suspiciously few tracked files (${tracked.length}) — is this the staged layout?`);
  process.exit(2);
}
rmSync(outDir, { recursive: true, force: true });
for (const rel of tracked) {
  const dest = join(outDir, rel.replace(/^guild-butler-capture\//, ""));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(stagedRoot, rel), dest);
}

// --- 2. de-stage the Windows workflow ---------------------------------------
let wf = readFileSync(join(stagedRoot, ".github", "workflows", "capture-windows.yml"), "utf8");
wf = wf.replace(
  /      - name: Checkout app \(sparse — only the capture app\)\n        uses: actions\/checkout@v5\n        with:\n          sparse-checkout: \|\n            guild-butler-capture\n          sparse-checkout-cone-mode: true\n/,
  "      - name: Checkout app\n        uses: actions/checkout@v5\n",
);
wf = wf.replace(
  /  pull_request:\n    paths:\n      - "\.github\/workflows\/capture-windows\.yml"\n/,
  '  push:\n    branches: [main]\n    tags: ["v*"]\n  pull_request:\n',
);
// Tag builds publish a GitHub Release — the download page's stable
// /releases/latest/download URL and, later, electron-updater's feed.
wf = wf.replace("permissions:\n  contents: read\n", "permissions:\n  contents: write\n");
wf = wf.replaceAll("cd guild-butler-capture && ", "");
wf = wf.replaceAll("cd guild-butler-capture\n", "");
wf = wf.replaceAll("../guild-butler-capture/resources", "../resources");
wf = wf.replaceAll("guild-butler-capture/pnpm-lock.yaml", "pnpm-lock.yaml");
wf = wf.replaceAll("guild-butler-capture/release/*.exe", "release/*.exe");
wf = wf.replaceAll(" (in the raid-bot repo while staged)", "");
wf = wf.replaceAll("(.github/workflows/capture-windows.yml in the raid-bot repo while staged)", "");
// Path-shaped remnants only — the artifact NAME guild-butler-capture-windows
// is the product's and stays.
if (/guild-butler-capture\/|cd guild-butler-capture/.test(wf)) {
  console.error("workflow de-staging incomplete — staged paths still present:");
  for (const line of wf.split("\n")) {
    if (/guild-butler-capture\/|cd guild-butler-capture/.test(line)) {
      console.error(`  ${line}`);
    }
  }
  process.exit(2);
}
// Release publishing on v* tags. STABLE_WIN_ASSET is a cross-repo contract:
// the bot's download page (src/server/downloadPage.ts) links
// releases/latest/download/<this exact name>; a rename here 404s that button
// while everything looks deployed. The bot repo pins this file's text in
// test/downloadPage.test.ts.
const STABLE_WIN_ASSET = "GuildButlerCapture-Setup.exe";
wf += `
      - name: Stable-named copy — the download page's /latest/download URL
        if: startsWith(github.ref, 'refs/tags/v')
        run: cp release/*.exe "release/${STABLE_WIN_ASSET}"

      - name: Publish GitHub Release (tag builds)
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: release/*.exe
          generate_release_notes: true
`;
for (const must of ["engine-src", "windows-2022", "electron-builder.win-ci.yml", "runs-on", STABLE_WIN_ASSET]) {
  if (!wf.includes(must)) {
    console.error(`workflow de-staging broke something — missing "${must}"`);
    process.exit(2);
  }
}
mkdirSync(join(outDir, ".github", "workflows"), { recursive: true });
writeFileSync(join(outDir, ".github", "workflows", "windows.yml"), wf);

// --- 3. the public repo's own test CI ---------------------------------------
writeFileSync(
  join(outDir, ".github", "workflows", "ci.yml"),
  `name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
`,
);

// --- 4. package.json repository field + README provenance -------------------
const pkgPath = join(outDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.repository = { type: "git", url: "https://github.com/designsvet/guild-butler-capture.git" };
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const readmePath = join(outDir, "README.md");
const sourceSha = git(["rev-parse", "HEAD"]).trim();
let readme = readFileSync(readmePath, "utf8");
readme +=
  `\n## Provenance\n\n` +
  `Extracted from the private staging tree (raid-bot@${sourceSha.slice(0, 12)}) as a\n` +
  `fresh history — the app was developed there alongside the closed Guild Butler\n` +
  `bot; see its ADR 0096. The bundled capture engine is the separate GPL project\n` +
  `[designsvet/ao-loot-logger](https://github.com/designsvet/ao-loot-logger)\n` +
  `(branch \`protocol18\`), spawned as a child process, never linked.\n`;
writeFileSync(readmePath, readme);

// --- 5. optional git init + extraction commit --------------------------------
if (doCommit) {
  git(["init", "-b", "main"], outDir);
  git(["add", "-A"], outDir);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=designsvet",
      "-c",
      "user.email=development@designsvet.com",
      "commit",
      "-m",
      `Extract Guild Butler Capture from the private staging tree\n\nSource: designsvet/raid-bot@${sourceSha} (guild-butler-capture/ + its\nWindows CI workflow, de-staged). Fresh history on purpose — the staging\nrepo is private and its history stays that way; ADR 0096 there records the\ndevelopment trail.\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
    ],
    { cwd: outDir, encoding: "utf8" },
  );
}

// --- human-review report -----------------------------------------------------
console.log(`extracted ${tracked.length} tracked files → ${outDir}${doCommit ? " (committed)" : ""}`);
console.log("\nRemaining staged/raid-bot mentions for a human pass (bot references are fine):");
let report = "";
try {
  report = execFileSync(
    "grep",
    ["-rn", "-iE", "staged|raid-bot", "--include=*.md", "--include=*.yml", "--include=*.ts", "."],
    { cwd: outDir, encoding: "utf8" },
  ).trim();
} catch {
  // grep exits 1 on zero matches — that IS the clean outcome
}
console.log(report.length > 0 ? report : "  (none)");
