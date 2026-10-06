/** Incremental, byte-addressed tails for BOTH streams. Rotation never chooses only the newest file. */
import {
  isLootHeader,
  isSessionFile,
  parseActivityLine,
  parseLootLine,
  type TSessionEvent,
} from "../shared/session/events.js";
export type TSessionFile = { path: string; size: number };
export type TSessionLine = {
  file: string;
  line: number;
  event: TSessionEvent | null;
  originByte: number;
  fromByte: number;
  toByte: number;
};
type TCursor = { offset: number; pending: string; line: number; originByte: number };
export type TSessionTailDeps = {
  initialOffsets?: Map<string, number>;
  list: () => Promise<TSessionFile[]>;
  read: (path: string, offset: number, length: number) => Promise<string>;
  onLines: (lines: TSessionLine[]) => void;
  log: (message: string) => void;
};
const READ_BYTES = 256 * 1024;
export const createSessionTail = (deps: TSessionTailDeps) => {
  const cursors = new Map<string, TCursor>();
  // Decode UTF-8 only after a complete line, including lines split across byte reads.
  let running: Promise<void> | null = null;
  const scan = async (): Promise<void> => {
    const batch: TSessionLine[] = [];
    for (const file of (await deps.list())
      .filter((f) => isSessionFile(f.path.split(/[\\/]/).at(-1) ?? ""))
      .sort((a, b) => a.path.localeCompare(b.path))) {
      let cursor = cursors.get(file.path);
      if (cursor == null) {
        const offset = deps.initialOffsets?.get(file.path) ?? 0;
        cursor = { offset, originByte: offset, pending: "", line: 0 };
        cursors.set(file.path, cursor);
      }
      if (file.size < cursor.offset) {
        // A replaced/truncated raw file is not a second copy of yesterday's events.
        deps.log(`[session] truncated ${file.path}; continuing at its new end`);
        cursor.offset = file.size;
        cursor.pending = "";
        continue;
      }
      if (file.size === cursor.offset) {
        continue;
      }
      // Drain the captured size of every file before timestamp sorting. Sorting independent chunks
      // can put a newer file's join ahead of an older file's unread gains. New appends wait for next poll.
      while (cursor.offset < file.size) {
        const length = Math.min(READ_BYTES, file.size - cursor.offset);
        let bytes: string;
        try {
          bytes = await deps.read(file.path, cursor.offset, length);
        } catch (err) {
          deps.log(`[session] read failed ${file.path}: ${String(err)}`);
          break;
        }
        if (bytes.length === 0) {
          break;
        }
        let fromByte = cursor.offset - cursor.pending.length;
        cursor.offset += bytes.length;
        const lines = (cursor.pending + bytes).split("\n");
        cursor.pending = lines.pop() ?? "";
        for (const raw of lines) {
          cursor.line += 1;
          const toByte = fromByte + raw.length + 1;
          const line = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))).replace(/\r$/, "");
          if (line.trim() !== "" && !isLootHeader(line)) {
            const event = file.path.endsWith(".jsonl") ? parseActivityLine(line) : parseLootLine(line);
            batch.push({ file: file.path, line: cursor.line, event, originByte: cursor.originByte, fromByte, toByte });
          }
          fromByte = toByte;
        }
      }
    }
    // Source order breaks timestamp ties; do not group or dedupe identical events.
    batch.sort((a, b) => (a.event?.at ?? 0) - (b.event?.at ?? 0));
    if (batch.length > 0) {
      deps.onLines(batch);
    }
  };
  return {
    poll: (): Promise<void> => {
      if (running != null) {
        return running;
      }
      running = scan().finally(() => {
        running = null;
      });
      return running;
    },
    /** Snapshot at New session, after a final poll: the next summary starts after these lines. */
    positions: (): Map<string, number> => new Map([...cursors].map(([path, cursor]) => [path, cursor.line])),
    caughtUp: (): Promise<boolean> =>
      deps.list().then((files) => files.every((f) => (cursors.get(f.path)?.offset ?? 0) >= f.size)),
  };
};
