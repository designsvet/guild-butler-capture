import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { IPC } from "../src/shared/ipc.js";

/**
 * The preload is deliberately self-contained (no relative imports) so the
 * renderer can run fully sandboxed — which means its channel names are
 * LITERALS that could drift from src/shared/ipc.ts. This test is the tether.
 *
 * Read as text rather than imported: importing the preload would execute
 * `contextBridge.exposeInMainWorld`, which only exists inside Electron.
 */

const PRELOAD = fileURLToPath(new URL("../src/preload/index.cts", import.meta.url));

describe("preload channel literals", () => {
  it("every shared IPC channel appears verbatim in the preload, and vice versa", () => {
    const source = readFileSync(PRELOAD, "utf8");
    for (const [key, channel] of Object.entries(IPC)) {
      expect(source.includes(`"${channel}"`), `${key} (${channel}) missing from preload`).toBe(true);
    }
    // vice versa: every literal channel-looking string in the preload's CH map
    // must be a known shared channel (catches a renamed channel left behind)
    const chBlock = /const CH = \{(.*?)\} as const;/s.exec(source)?.[1] ?? "";
    for (const match of chBlock.matchAll(/"([a-z-]+:[a-z-]+)"/g)) {
      expect(Object.values(IPC) as string[], `preload channel ${match[1]} unknown to shared ipc.ts`).toContain(
        match[1],
      );
    }
    expect(chBlock.length).toBeGreaterThan(0);
  });
});
