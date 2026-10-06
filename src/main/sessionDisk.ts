import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { TSession } from "../shared/session/model.js";
import { isSessionFile } from "../shared/session/events.js";
import type { TSessionFile } from "./sessionFiles.js";

export const listSessionFiles = async (dir: string): Promise<TSessionFile[]> => {
  const result: TSessionFile[] = [];
  for (const name of await fs.readdir(dir)) {
    if (isSessionFile(name)) {
      const path = join(dir, name);
      try {
        const stat = await fs.stat(path);
        if (stat.isFile()) {
          result.push({ path, size: stat.size });
        }
      } catch {
        // Rotation between readdir and stat; try the next tick.
      }
    }
  }
  return result;
};
export const readSessionBytes = async (path: string, offset: number, length: number): Promise<string> => {
  const file = await fs.open(path, "r");
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await file.read(bytes, 0, length, offset);
    return bytes.subarray(0, bytesRead).toString("latin1");
  } finally {
    await file.close();
  }
};
/** One directory per session, beside its raw captures. Atomic replacement cannot overwrite another session. */
export const saveSessionSummary = async (dir: string, session: TSession): Promise<void> => {
  if (!/^[a-zA-Z0-9-]+$/.test(session.id)) {
    throw new Error("invalid session id");
  }
  const path = join(dir, "sessions", session.id, "session.json");
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(`${path}.tmp`, JSON.stringify(session) + "\n", "utf8");
  await fs.rename(`${path}.tmp`, path);
};
