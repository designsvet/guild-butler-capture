/**
 * App settings — one tiny JSON file in Electron's userData dir. Tolerant of
 * absence and corruption (a broken file means defaults, never a crash).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type TSettings = {
  /** User-chosen engine folder (Advanced). Empty/absent = auto-discover. */
  enginePath?: string;
};

export const settingsFilePath = (userDataDir: string): string => {
  return join(userDataDir, "settings.json");
};

export const loadSettings = (file: string): TSettings => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed == null) {
      return {};
    }
    const raw = parsed as Record<string, unknown>;
    const out: TSettings = {};
    if (typeof raw.enginePath === "string" && raw.enginePath.trim().length > 0) {
      out.enginePath = raw.enginePath;
    }
    return out;
  } catch {
    return {};
  }
};

export const saveSettings = (file: string, settings: TSettings): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
};
