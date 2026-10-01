/**
 * The v5 shell's entry (Loot Butler, raid-bot ADR 0159). A window loads it instead of the old
 * greeting only behind GBC_SHELL=v5 or settings.shell (src/main/settings.ts); bundled into
 * dist/web/app/main.js by tools/build-app.mjs, React included.
 *
 * So far the frame: the title bar with the crest and the wordmark, and one of the design
 * system's React components, which is what proves the toolchain end to end under the old
 * window's content-security policy. The store that mirrors the bridge — and with it the stored
 * theme and language — the sidebar and the pages come next.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { detectLang } from "../shared/i18n.js";
import { stringsFor } from "../shared/strings.js";
import { Shell } from "./Shell.js";

// The preload's bridge (src/preload/index.cts) carries the platform synchronously, and the title
// bar pads around the OS's own buttons by it. Read narrowly here; the bridge's full type moves
// to src/shared with the store.
const bridge = (window as unknown as { gbc?: { platform?: unknown } }).gbc;
const platform = typeof bridge?.platform === "string" ? bridge.platform : "unknown";

// The OS's language for now: the stored override is a setting, and settings arrive with the store.
const lang = detectLang(navigator.language);
const strings = stringsFor(lang);

document.documentElement.dataset.platform = platform;
document.documentElement.lang = lang;
document.title = strings.shell.appName;

const root = document.getElementById("root");
if (root == null) {
  throw new Error("index.html has no #root to render into");
}
createRoot(root).render(
  <StrictMode>
    <Shell strings={strings} />
  </StrictMode>,
);
