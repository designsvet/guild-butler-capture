#!/usr/bin/env node
/**
 * Build the v5 shell (Loot Butler, raid-bot ADR 0159) into dist/web/app/. Part of `pnpm build`,
 * after build-static.mjs, which keeps building the old window exactly as before; which of the two
 * a window loads is the flag in src/main (`wantsV5Shell`).
 *
 * The old renderer gets by without a bundler. This page cannot: it renders with React and the
 * design system's components, so —
 *
 * - esbuild bundles src/app/main.tsx, React and the package's React entry included, into one ES
 *   module, main.js. The page keeps the old window's content-security policy, so everything it
 *   runs has to be in that one file of its own.
 * - PostCSS builds app.css: postcss-import inlines the package's stylesheets and Tailwind's layers
 *   in the order app.css lists them, then Tailwind writes the utilities the sources use (the
 *   package's preset, tailwind.config.mjs). An @import left in the output would name a
 *   node_modules path the app does not ship, and one postcss-import skipped never arrives at all,
 *   so the build fails on either instead.
 * - The faces are the package's fonts/ directory, copied whole: the woff2 files, the fonts.css
 *   that declares them by relative path, and the four OFL texts the licence asks to travel with
 *   the files (a bundler emits the fonts and leaves the licences behind). Whole, not by list:
 *   each file name carries a hash that changes when a face is reissued.
 * - The crest is resources/icons/crest-mark.png, the same mark the old window's title bar uses.
 * - Approved F1/F3 Albion sprites and their provenance travel as resources/albion/. Dynamic
 *   item art still goes through the main process's restricted official-service handler.
 *
 * GBC_DIST_DIR points the output somewhere else, as it does for build-static:
 * test/appDesignSystem.test.ts builds into a temp dir and checks what comes out.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import postcss from "postcss";
import postcssImport from "postcss-import";
import tailwindcss from "tailwindcss";

import tailwindConfig from "../tailwind.config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = process.env.GBC_DIST_DIR ? resolve(process.env.GBC_DIST_DIR) : join(root, "dist");
const src = join(root, "src", "app");
const dest = join(dist, "web", "app");
rmSync(dest, { recursive: true, force: true }); // nothing from an earlier build survives this one
mkdirSync(dest, { recursive: true });

// Electron 37 is Chromium 138: the one engine this page ever runs in.
await build({
  entryPoints: [join(src, "main.tsx")],
  outfile: join(dest, "main.js"),
  tsconfig: join(root, "tsconfig.app.json"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome138",
  jsx: "automatic",
  minify: true,
  // React's production build; without this the bundle carries its development checks.
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const cssFrom = join(src, "app.css");
const css = await postcss([postcssImport(), tailwindcss(tailwindConfig)]).process(readFileSync(cssFrom, "utf8"), {
  from: cssFrom,
  to: join(dest, "app.css"),
});
// Fatal, not printed: postcss-import WARNS about an @import placed after a rule and then drops it,
// so a warning here is a stylesheet that silently never arrived.
const warnings = css.warnings();
if (warnings.length > 0) {
  throw new Error(`app.css:\n${warnings.map((warning) => `  ${warning.toString()}`).join("\n")}`);
}
const leftover = [];
css.root.walkAtRules("import", (rule) => {
  leftover.push(rule.params);
});
if (leftover.length > 0) {
  throw new Error(`app.css: @import survived the build (${leftover.join(", ")}) — postcss-import leaves a remote one in place`);
}
writeFileSync(join(dest, "app.css"), css.css);

cpSync(join(src, "index.html"), join(dest, "index.html"));
cpSync(join(root, "resources", "icons", "crest-mark.png"), join(dest, "crest.png"));
cpSync(join(root, "resources", "albion"), join(dest, "albion"), { recursive: true });

const require = createRequire(import.meta.url);
const fonts = dirname(require.resolve("@guild-butler/design-system/fonts/fonts.css"));
cpSync(fonts, join(dest, "fonts"), { recursive: true });

const kb = (file) => `${Math.round(statSync(join(dest, file)).size / 1024)} KB`;
console.log(`app → ${dest} (main.js ${kb("main.js")}, app.css ${kb("app.css")}, fonts from the design system)`);
