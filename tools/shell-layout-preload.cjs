/**
 * The stub bridge for tools/shell-layout-check.cjs: the old check's (layout-check-preload.cjs —
 * the same `window.gbc`, answering from a scenario), plus one thing the v5 check needs and the old
 * one does not: every `securitypolicyviolation` the page raises, from its first moment.
 *
 * A preload runs before any of the page's own scripts, so a listener added here hears a refusal
 * the parser or the first render causes; one added later by executeJavaScript would not. The
 * listener lives in the preload's isolated world, which shares the page's DOM and so its events.
 * What it heard is handed to the check as `window.gbcCheck.refused()`, a name the page itself
 * never reads.
 *
 * Unsandboxed, as the old stub is (it reads the scenario from argv); it never ships —
 * electron-builder.yml packages tools/mock-engine.cjs and nothing else here.
 */

"use strict";

const { contextBridge } = require("electron");

const refused = [];
document.addEventListener("securitypolicyviolation", (event) => {
  refused.push(`${event.violatedDirective} ${event.blockedURI === "" ? "(inline)" : event.blockedURI}`);
});
contextBridge.exposeInMainWorld("gbcCheck", { refused: () => refused.slice() });

require("./layout-check-preload.cjs");
