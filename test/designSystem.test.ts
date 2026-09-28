import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The renderer reads the design system (@guild-butler/design-system, ADR 0145)
 * from the pinned package instead of carrying a copy. These tests keep it that
 * way: a hand-copied token coming back, a retired one (ADR 0150) being used,
 * the stylesheets linked out of order, or the build not shipping what the page
 * links would each pass every other suite and only show as a wrong colour.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const require = createRequire(import.meta.url);
const packageFile = (name: string): string => require.resolve(`@guild-butler/design-system/${name}`);

const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties a stylesheet DECLARES — `--name:` — as opposed to reads. */
const declaredTokens = (css: string): Set<string> => {
  return new Set([...stripCssComments(css).matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].flatMap((m) => m[1] ?? []));
};

/** One theme block's declarations: the dark default (:root) or the light theme. */
const themeBlock = (css: string, selector: RegExp): string => {
  const body = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(stripCssComments(css))?.[1];
  if (body === undefined) {
    throw new Error(`no block for ${selector}`);
  }
  return body;
};

const tokenValue = (block: string, name: string): string => {
  const value = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  if (value === undefined) {
    throw new Error(`${name} not in block`);
  }
  return value.toLowerCase();
};

const STYLES = read("src/renderer/styles.css");
const INDEX = read("src/renderer/index.html");
const PACKAGE_TOKENS = readFileSync(packageFile("tokens.css"), "utf8");

/**
 * The one deliberate override: the package names Rubik / Onest / IBM Plex Mono,
 * which the app does not bundle until plan step P6 brings the fonts. When P6
 * lands, the override leaves styles.css and this list empties — the test fails
 * until it does, so the exception cannot outlive its reason.
 */
const FONT_OVERRIDES_UNTIL_P6 = ["--gb-font-body", "--gb-font-display", "--gb-font-mono"];

/** ADR 0150's retired tokens, plus the app's own --gb-popover (now the vellum overlay). */
const RETIRED = [
  "--gb-line",
  "--gb-line-soft",
  "--gb-line-strong",
  "--gb-line-gold",
  "--gb-inset",
  "--gb-panel",
  "--gb-panel-2",
  "--gb-card-gold",
  "--gb-shadow-card",
  "--gb-shadow-panel",
  "--gb-callout-bg",
  "--kb-tint-active",
  "--gb-popover",
];

/** Whole tokens only: `--gb-line` must not match inside `--gb-line-soft`, nor the reverse. */
const usesToken = (source: string, name: string): boolean => {
  return new RegExp(`${name.replace(/-/g, "\\-")}(?![\\w-])`).test(source);
};

describe("design-system tokens", () => {
  it("styles.css declares no token the package defines, except the P6 font override", () => {
    const packageTokens = declaredTokens(PACKAGE_TOKENS);
    expect(packageTokens.size).toBeGreaterThan(100); // the parse found the package, not an empty file
    const copies = [...declaredTokens(STYLES)].filter((name) => packageTokens.has(name)).sort();
    expect(copies).toEqual(FONT_OVERRIDES_UNTIL_P6);
  });

  it("no retired token is used or declared anywhere in the renderer", () => {
    const packageTokens = declaredTokens(PACKAGE_TOKENS);
    const sources = {
      "styles.css": stripCssComments(STYLES),
      "index.html": INDEX,
      "renderer.ts": read("src/renderer/renderer.ts"),
    };
    for (const name of RETIRED) {
      // the list is right only while the package itself has none of them
      expect(packageTokens.has(name), `${name} is back in the package — not retired`).toBe(false);
      for (const [file, source] of Object.entries(sources)) {
        expect(usesToken(source, name), `${file} uses retired ${name}`).toBe(false);
      }
    }
  });

  it("themes are the package's words: no selector targets parchment or obsidian", () => {
    // The stored setting keeps "obsidian"/"parchment"; the page wears
    // data-theme="dark"/"light" (renderer.ts applyTheme), so a rule written
    // against the old words would silently never match.
    expect(STYLES).not.toMatch(/data-theme="(parchment|obsidian)"/);
    expect(read("src/renderer/renderer.ts")).toMatch(/dataset\.theme = next === "parchment" \? "light" : "dark"/);
  });

  it("the grounds drawn outside the token layer match the package's --gb-bg", () => {
    const dark = tokenValue(themeBlock(PACKAGE_TOKENS, /:root,\s*\[data-theme="dark"\]/), "--gb-bg");
    const light = tokenValue(themeBlock(PACKAGE_TOKENS, /\[data-theme="light"\]/), "--gb-bg");
    // the window's pre-paint background (src/main/index.ts)
    const main = /backgroundColor: theme === "parchment" \? "(#[0-9a-f]+)" : "(#[0-9a-f]+)"/i.exec(
      read("src/main/index.ts"),
    );
    expect(main?.[1]?.toLowerCase()).toBe(light);
    expect(main?.[2]?.toLowerCase()).toBe(dark);
    // the theme tiles preview the OTHER theme's ground, which no token can reach
    expect(tokenValue(themeBlock(STYLES, /\.tile-parchment/), "background")).toBe(light);
    expect(tokenValue(themeBlock(STYLES, /\.tile-obsidian/), "background")).toBe(dark);
  });
});

describe("design-system stylesheets reach the page", () => {
  const linked = [...INDEX.matchAll(/href="\.\/ds\/([^"]+\.css)"/g)].flatMap((m) => m[1] ?? []);

  it("index.html links ds/tokens.css, then ds/surfaces.css, before styles.css", () => {
    const at = (href: string): number => INDEX.indexOf(`href="${href}"`);
    expect(at("./ds/tokens.css")).toBeGreaterThan(-1);
    expect(at("./ds/surfaces.css")).toBeGreaterThan(at("./ds/tokens.css"));
    expect(at("./styles.css")).toBeGreaterThan(at("./ds/surfaces.css"));
    for (const file of linked) {
      expect(at(`./ds/${file}`), `${file} must load before styles.css`).toBeLessThan(at("./styles.css"));
    }
  });

  // The real build step, run into a temp dir so the test never restamps dist/.
  const out = mkdtempSync(join(tmpdir(), "gbc-static-"));
  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it("build-static copies exactly the linked files, byte for byte from the package", () => {
    execFileSync(process.execPath, [join(ROOT, "tools", "build-static.mjs")], {
      env: { ...process.env, GBC_DIST_DIR: out },
      stdio: "pipe",
    });
    const dsDir = join(out, "web", "renderer", "ds");
    expect(readdirSync(dsDir).sort()).toEqual([...linked].sort());
    for (const file of linked) {
      expect(readFileSync(join(dsDir, file), "utf8"), `${file} differs from the package`).toBe(
        readFileSync(packageFile(file), "utf8"),
      );
    }
    // and the page that ships is the one that links them
    expect(readFileSync(join(out, "web", "renderer", "index.html"), "utf8")).toBe(INDEX);
  });
});
