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
 *
 * The design system is the other: `@guild-butler/design-system` (ADR 0145),
 * pinned in package.json. The renderer is sandboxed under `style-src 'self'`
 * with no bundler, so it cannot import from node_modules — its stylesheets are
 * copied beside the page, into ds/. Which ones is DERIVED from index.html's
 * `./ds/*.css` links rather than listed here, so linking a new package file is
 * the whole change; each resolves through the package's exports map, and a
 * name the package does not export fails the build instead of shipping a page
 * with a dead link. test/designSystem.test.ts runs this script and checks the
 * copies against the package byte for byte.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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

// The design system's stylesheets, the ones index.html links from ./ds/.
const require = createRequire(import.meta.url);
const html = readFileSync(join(root, "src", "renderer", "index.html"), "utf8");
const dsFiles = [...html.matchAll(/href="\.\/ds\/([^"]+\.css)"/g)].map((m) => m[1]);
rmSync(join(dest, "ds"), { recursive: true, force: true }); // nothing unlinked survives a rebuild
mkdirSync(join(dest, "ds"), { recursive: true });
for (const file of dsFiles) {
  cpSync(require.resolve(`@guild-butler/design-system/${file}`), join(dest, "ds", file));
}

// Stamp the build so the window and the app log can say WHICH build is
// running — package.json's version is static across dev builds, and the first
// hardware pass spent a round-trip on a stale instance nobody could identify.
writeFileSync(join(root, "dist", "buildstamp.json"), JSON.stringify({ builtAt: new Date().toISOString() }));
console.log(`static → ${dest} (design system: ${dsFiles.join(", ") || "none"})`);
