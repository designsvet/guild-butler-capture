/**
 * The v5 shell's entry (Loot Butler, raid-bot ADR 0159). A window loads it instead of the old
 * greeting only behind GBC_SHELL=v5 or settings.shell (src/main/settings.ts); bundled into
 * dist/web/app/main.js by tools/build-app.mjs, React included.
 *
 * It makes the two stores the page reads — the bridge's mirror (store.ts) and the hash router
 * (router.ts) — boots the first, and renders the shell over them. Booting happens here, once,
 * outside React, so StrictMode's double effects cannot subscribe twice.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { TGbc } from "../shared/bridge.js";
import { createRouter } from "./router.js";
import { Shell } from "./Shell.js";
import { createShellStore } from "./store.js";

const gbc = (window as unknown as { gbc: TGbc }).gbc;

// The title bar pads around the OS's own buttons by platform (shell.css), so it is on <html>
// before the first paint.
document.documentElement.dataset.platform = gbc.platform;

const store = createShellStore(gbc, window);
const router = createRouter(window);
void store.boot();

const root = document.getElementById("root");
if (root == null) {
  throw new Error("index.html has no #root to render into");
}
createRoot(root).render(
  <StrictMode>
    <Shell store={store} router={router} platform={gbc.platform} />
  </StrictMode>,
);
