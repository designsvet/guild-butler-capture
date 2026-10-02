/**
 * A broken decoder, remembered across app restarts: `decoder-verdict.json` in the data folder.
 *
 * The engine calls a handler broken only after five failures and half its calls in ten minutes, and
 * the app's verdict is sticky for one app session. So a member who quits and reopens a build whose
 * decoder is still broken would upload, for up to ten minutes, lines decoded wrong — the very lines
 * the held upload exists to keep from the guild (uploader.ts). The fix for a broken decoder only ever
 * arrives as a new app version, so the verdict is kept with the version it was reached on: the same
 * version reopened is broken from the first second; a different version starts clean, and the file is
 * forgotten.
 *
 * Written to a temp file and renamed (a crash mid-write keeps the previous verdict); never throws —
 * it runs inside the engine's line handler.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TBrokenHandler } from "../shared/captureTypes.js";

export const decoderVerdictFilePath = (userDataDir: string): string => {
  return join(userDataDir, "decoder-verdict.json");
};

const isHandler = (value: unknown): value is TBrokenHandler => {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.handler === "string" && typeof v.failures === "number" && typeof v.calls === "number";
};

/**
 * The verdict this version reached before, or null. `stale` is true when a verdict is there for
 * ANOTHER version — the caller forgets it (the update that fixes a decoder is a new version).
 */
export const loadDecoderVerdict = (
  file: string,
  appVersion: string,
): { broken: TBrokenHandler[] | null; stale: boolean } => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { broken: null, stale: false };
  }
  if (typeof raw !== "object" || raw == null) {
    return { broken: null, stale: true };
  }
  const r = raw as { appVersion?: unknown; broken?: unknown };
  if (r.appVersion !== appVersion) {
    return { broken: null, stale: true };
  }
  const broken = Array.isArray(r.broken) ? r.broken.filter(isHandler) : [];
  return { broken: broken.length > 0 ? broken : null, stale: false };
};

export const saveDecoderVerdict = (file: string, appVersion: string, broken: readonly TBrokenHandler[]): boolean => {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify({ appVersion, broken, at: new Date().toISOString() }, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // a stray temp file is harmless; the next save replaces it
    }
    return false;
  }
};

export const forgetDecoderVerdict = (file: string): void => {
  try {
    rmSync(file, { force: true });
  } catch {
    // nothing to forget, or a read-only folder: the next version check reads it as stale again
  }
};
