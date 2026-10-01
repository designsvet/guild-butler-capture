import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import preset from "@guild-butler/design-system/tailwind-preset";

/**
 * Tailwind for the v5 shell (src/app; built by tools/build-app.mjs). The old window does not use
 * it.
 *
 * The theme is the design system's preset, the one the dashboard draws with, so `bg-card` or
 * `text-muted` means the same thing here as on the web; a `theme` written in this file would be a
 * second home for it. ESM on purpose: a CommonJS config that `require()`s the preset without
 * `.default` gets an EMPTY theme and says nothing.
 *
 * `content` is every file whose classes are drawn, the package's compiled components included —
 * Tailwind writes a utility only for a class it has seen, and a preset cannot add to this list.
 * Absolute, with forward slashes: the build may run from any directory, and Windows CI builds too.
 */
const root = dirname(fileURLToPath(import.meta.url)).replaceAll("\\", "/");

/** @type {import("tailwindcss").Config} */
export default {
  presets: [preset],
  content: [
    `${root}/src/app/**/*.{ts,tsx,html}`,
    `${root}/node_modules/@guild-butler/design-system/dist/react/**/*.js`,
  ],
  plugins: [],
};
