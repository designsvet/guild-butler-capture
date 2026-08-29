#!/usr/bin/env node
/**
 * Copy the renderer's static files beside the tsc output. Part of `pnpm build`;
 * deliberately a tiny script instead of a bundler — the app has no dependency
 * graph a bundler would earn its keep on.
 *
 * A directory SCAN, not a file list: everything in src/renderer that tsc does
 * not compile (html, css, fonts/, licences) ships verbatim. The raid-bot repo
 * paid for the hand-list version of this twice in one week (ADR 0065 — a
 * schema file that never reached the image, a backup script that never learned
 * a second store), so nothing here enumerates filenames.
 *
 * The brand mark is the one exception to "everything lives in src/renderer":
 * it is resources/icons/icon-256.png — the same art the OS shows on the dock
 * and installer — copied in at build time so the repo does not carry the same
 * pixels twice.
 */

import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, "dist", "web", "renderer");
mkdirSync(dest, { recursive: true });

cpSync(join(root, "src", "renderer"), dest, {
  recursive: true,
  filter: (src) => !src.endsWith(".ts"),
});

// The header mark is the crest WITHOUT the app-tile ring and background —
// `website/guild-butler-capture-mark-1024.png` from the owner's icon set,
// downscaled once and committed. The app/dock icon keeps the full tile; this
// one sits on the app's own titlebar, where a second border reads as a sticker.
cpSync(join(root, "resources", "icons", "crest-mark.png"), join(dest, "crest.png"));

// Stamp the build so the window and the app log can say WHICH build is
// running — package.json's version is static across dev builds, and the first
// hardware pass spent a round-trip on a stale instance nobody could identify.
writeFileSync(join(root, "dist", "buildstamp.json"), JSON.stringify({ builtAt: new Date().toISOString() }));
console.log(`static → ${dest}`);
