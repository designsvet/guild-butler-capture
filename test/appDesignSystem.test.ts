import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { type ChildNode, type Rule } from "postcss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The v5 shell (src/app) reads the design system (@guild-butler/design-system, ADR 0145) through
 * a bundler and Tailwind, where the old window copies stylesheets by hand — so the ways it can go
 * quietly wrong are different, and each of them would pass every other suite and show only as a
 * wrong colour, a missing face or a dead link: an @import left unresolved, the package's sheets
 * arriving out of order (preflight after controls.css erases every button's fill), a token
 * redeclared by the app, a font file that is not the package's, a face shipped without its
 * licence. This builds the app for real — tools/build-app.mjs, into a temp dir — and reads what
 * comes out.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const packageFile = (name: string): string => require.resolve(`@guild-butler/design-system/${name}`);
const PACKAGE_FONTS = dirname(packageFile("fonts/fonts.css"));
const SHEETS = ["tokens.css", "base.css", "controls.css", "surfaces.css"] as const;

const out = mkdtempSync(join(tmpdir(), "gbc-app-"));
const APP = join(out, "web", "app");
let built = "";

beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, "tools", "build-app.mjs")], {
    env: { ...process.env, GBC_DIST_DIR: out },
    stdio: "pipe",
  });
  built = readFileSync(join(APP, "app.css"), "utf8");
}, 60_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A colour written out rather than named: a hex, or an rgb()/hsl() call. */
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;

/** One spelling per colour, so `rgba(244, 241, 234, 0.06)` and the package's `rgba(244,241,234,.06)` compare equal. */
const normalColour = (value: string): string => value.toLowerCase().replace(/\s+/g, "").replace(/([(,])0\./g, "$1.");

/** How many times each custom property is DECLARED (`--name:`), as opposed to read. */
const declarations = (css: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const m of stripCssComments(css).matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) {
    const name = m[1] ?? "";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
};

/** Where a package sheet's top-level rules start in the built CSS, as one unbroken run; -1 if they do not. */
const runStart = (haystack: string[], needle: string[]): number => {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((node, j) => haystack[i + j] === node)) {
      return i;
    }
  }
  return -1;
};

describe("the v5 shell's build", () => {
  it("ships the page, its bundle, its stylesheet, the crest and the faces — nothing else", () => {
    expect(readdirSync(APP).sort()).toEqual(["app.css", "crest.png", "fonts", "index.html", "main.js"]);
    expect(readFileSync(join(APP, "index.html"), "utf8")).toBe(readFileSync(join(ROOT, "src", "app", "index.html"), "utf8"));
    expect(readFileSync(join(APP, "crest.png")).equals(readFileSync(join(ROOT, "resources", "icons", "crest-mark.png")))).toBe(
      true,
    );
  });

  it("keeps the old window's content-security policy, word for word", () => {
    const policy = (file: string): string | undefined =>
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(readFileSync(join(ROOT, file), "utf8"))?.[1];
    expect(policy("src/renderer/index.html")).toBeDefined();
    expect(policy("src/app/index.html")).toBe(policy("src/renderer/index.html"));
  });
});

describe("the v5 shell's stylesheet", () => {
  it("has no @import left in it", () => {
    let imports = 0;
    postcss.parse(built).walkAtRules("import", () => {
      imports += 1;
    });
    expect(imports).toBe(0);
    // and the other sheet the page links is the package's own, which imports nothing
    expect(readFileSync(join(APP, "fonts", "fonts.css"), "utf8")).not.toMatch(/@import\b/);
  });

  it("carries tokens → base → controls → surfaces whole and in that order, with Tailwind's preflight before controls", () => {
    const parsed = postcss.parse(built).nodes;
    const nodes = parsed.map((node: ChildNode) => node.toString());
    const starts = SHEETS.map((sheet) => {
      const own = postcss.parse(readFileSync(packageFile(sheet), "utf8")).nodes.map((node: ChildNode) => node.toString());
      expect(own.length, `${sheet} parsed to nothing`).toBeGreaterThan(0);
      const at = runStart(nodes, own);
      expect(at, `${sheet} is not in the built CSS as one unbroken run`).toBeGreaterThan(-1);
      return at;
    });
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);

    // Preflight's `[type='button'] { background-image: none }` has a variant class's specificity:
    // after controls.css it would erase every gold button's gradient.
    const preflight = parsed.findIndex(
      (node) =>
        node.type === "rule" &&
        node.selector.includes("[type='button']") &&
        node.some((child) => child.type === "decl" && child.prop === "background-image" && child.value === "none"),
    );
    expect(preflight).toBeGreaterThan(starts[1] ?? Infinity); // after base.css
    expect(preflight).toBeLessThan(starts[2] ?? -1); // before controls.css
  });

  it("redeclares no package token: each is declared exactly as often as the package declares it", () => {
    const pkg = new Map<string, number>();
    for (const sheet of SHEETS) {
      for (const [name, n] of declarations(readFileSync(packageFile(sheet), "utf8"))) {
        pkg.set(name, (pkg.get(name) ?? 0) + n);
      }
    }
    expect(pkg.size).toBeGreaterThan(100); // the parse found the package, not an empty file
    const app = declarations(built);
    for (const [name, n] of pkg) {
      expect(app.get(name), `${name} declared again outside the package`).toBe(n);
    }
  });

  it("declares only --lb-* names of its own — never a --gb-* one, the package's or the old window's", () => {
    const own = readdirSync(join(ROOT, "src", "app")).filter((file) => file.endsWith(".css"));
    expect(own.length).toBeGreaterThan(0);
    for (const file of own) {
      for (const name of declarations(readFileSync(join(ROOT, "src", "app", file), "utf8")).keys()) {
        expect(name, `src/app/${file} declares ${name}`).toMatch(/^--lb-/);
      }
    }
  });

  it("writes a raw colour only as an --lb-* value, and never one a package token holds in that theme", () => {
    // The package's value for every token, per theme. A token without a light value keeps its dark
    // one on parchment (the package README), so the light map starts as a copy of the dark.
    const dark = new Map<string, string>();
    const light = new Map<string, string>();
    postcss.parse(readFileSync(packageFile("tokens.css"), "utf8")).walkDecls(/^--gb-/, (decl) => {
      const rule = decl.parent;
      const selector = rule?.type === "rule" ? (rule as Rule).selector : "";
      (selector.includes('data-theme="light"') ? light : dark).set(decl.prop, normalColour(decl.value));
    });
    expect(dark.size).toBeGreaterThan(100); // the parse found the package, not an empty file
    const lightAll = new Map([...dark, ...light]);

    const dir = join(ROOT, "src", "app");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      if (file.endsWith(".tsx") || file.endsWith(".ts")) {
        // a Tailwind arbitrary colour (`text-[#fff]`) or an inline style is a raw colour too
        expect(source, `src/app/${file} writes a raw colour`).not.toMatch(RAW_COLOUR);
        continue;
      }
      if (!file.endsWith(".css")) {
        continue;
      }
      postcss.parse(source).walkDecls((decl) => {
        if (!RAW_COLOUR.test(decl.value)) {
          return;
        }
        expect(decl.prop, `src/app/${file}: ${decl.prop}: ${decl.value} — a raw colour outside an --lb-* value`).toMatch(
          /^--lb-/,
        );
        const rule = decl.parent;
        const onLight = rule?.type === "rule" && (rule as Rule).selector.includes('data-theme="light"');
        const theme = onLight ? lightAll : dark;
        const twin = [...theme].find(([, value]) => value === normalColour(decl.value))?.[0];
        expect(twin, `src/app/${file}: ${decl.prop} copies ${twin}'s value — name the token instead`).toBeUndefined();
      });
    }
  });

  it("draws Tailwind's utilities from the package's preset", () => {
    // A CommonJS config that takes the preset without `.default` gets an empty theme and writes
    // nothing for these, silently. The wordmark is set with both.
    expect(stripCssComments(built)).toMatch(/\.text-ink\s*\{\s*color:\s*var\(--gb-ink\)/);
    expect(stripCssComments(built)).toMatch(/\.font-serif\s*\{\s*font-family:\s*Cormorant Garamond/);
  });
});

describe("the v5 shell's faces", () => {
  it("are the package's files, byte for byte, with the stylesheet that declares them", () => {
    const files = readdirSync(PACKAGE_FONTS).sort();
    expect(files.filter((file) => file.endsWith(".woff2")).length).toBeGreaterThan(0);
    expect(readdirSync(join(APP, "fonts")).sort()).toEqual(files);
    for (const file of files) {
      expect(readFileSync(join(APP, "fonts", file)).equals(readFileSync(join(PACKAGE_FONTS, file))), `${file} differs`).toBe(
        true,
      );
    }
    // every face the stylesheet names is beside it
    const css = readFileSync(join(APP, "fonts", "fonts.css"), "utf8");
    const named = [...css.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)].flatMap((m) => m[1] ?? []);
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) {
      expect(files, `fonts.css names ${file}`).toContain(file);
    }
  });

  it("travel with each family's licence", () => {
    const shipped = readdirSync(join(APP, "fonts"));
    const families = new Set(shipped.filter((file) => file.endsWith(".woff2")).map((file) => file.replace(/-[0-9a-f]+\.woff2$/, "")));
    expect(families.size).toBe(4); // Rubik, Onest, IBM Plex Mono, Cormorant Garamond
    for (const family of families) {
      expect(shipped, `${family} ships without its licence`).toContain(`LICENSE-${family}.txt`);
    }
  });
});
