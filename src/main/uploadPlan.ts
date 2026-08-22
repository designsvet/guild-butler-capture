/**
 * What to send next — the pure half of the uploader (ADR 0092 P2 slice 4).
 *
 * The bot's ingest is idempotent on `UNIQUE (run_id, line_no)`, where `line_no`
 * is a line's index IN THE FILE. That is what lets this client retry blindly
 * after a crash, a dropped network or a sleeping laptop: re-sending a batch
 * stores nothing. Every rule here exists to keep that key meaningful.
 */

/** The bot's own batch cap (`MAX_BATCH_LINES`). Cross-repo constant. */
export const MAX_BATCH_LINES = 500;

/** The bot's own per-line cap (`MAX_LINE_LENGTH`). Cross-repo constant. */
export const MAX_LINE_LENGTH = 2000;

export type TUploadCursor = {
  /** Run id minted at Start capture (and again whenever the file changes). */
  run: string;
  /** Absolute path of the file this run is reading. */
  file: string;
  /** How many of that file's lines the server has confirmed. */
  sentThrough: number;
};

export enum ENewRunReason {
  /** First upload of a capture session. */
  FirstFile = "first-file",
  /** The engine rolled to a new file (it names them by timestamp). */
  FileChanged = "file-changed",
  /** The file is shorter than what we already sent — it was replaced or truncated. */
  FileShrank = "file-shrank",
}

/**
 * Does this file need a NEW run id, rather than continuing the current one?
 *
 * The subtle one is `FileChanged`, and getting it wrong loses data silently.
 * The engine rolls its log at midnight, so one capture session can span two
 * files — and the second file's line numbering starts at 0 again. Continuing
 * the same run would send those lines under indices the first file already
 * used, and the server's UNIQUE key would swallow every one of them as a
 * duplicate. No error, no warning, just a member's evening missing from the
 * report.
 *
 * A new run id per file keeps `line_no` unique within its run and makes the
 * server's stored file name true. The member still sees one capture session —
 * runs are an upload detail, and the raid claims by timestamp regardless.
 */
export const newRunReason = (cursor: TUploadCursor | null, file: string, lineCount: number): ENewRunReason | null => {
  if (cursor == null) {
    return ENewRunReason.FirstFile;
  }
  if (cursor.file !== file) {
    return ENewRunReason.FileChanged;
  }
  if (lineCount < cursor.sentThrough) {
    return ENewRunReason.FileShrank;
  }
  return null;
};

/**
 * Cap a line's length without dropping it.
 *
 * Truncating corrupts one line; SKIPPING it would shift every later index and
 * break the key the whole retry story rests on. And leaving it alone is worse
 * than either: the server refuses the entire batch with `line_too_long`, this
 * client retries the same batch forever, and one corrupt line wedges a
 * member's uploads permanently. A real loot line is ~120 characters, so
 * anything past the cap is already damaged — the server will count the
 * truncated line as unparseable, which is the honest outcome.
 */
export const clampLine = (line: string): string => {
  return line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
};

export type TBatch = { from: number; lines: string[] };

/**
 * The next batch to send, or null when the server is already up to date.
 *
 * `from` is the index of the first line in the FILE — including the header row
 * and any unparseable lines, because the server counts what was SENT rather
 * than what it managed to store. A client that skipped lines locally would
 * drift out of step with the offsets already recorded.
 */
export const nextBatch = (sentThrough: number, lines: readonly string[]): TBatch | null => {
  if (sentThrough >= lines.length) {
    return null;
  }
  const slice = lines.slice(sentThrough, sentThrough + MAX_BATCH_LINES).map(clampLine);
  return { from: sentThrough, lines: slice };
};

/**
 * Split a file's text into uploadable lines.
 *
 * A trailing newline must NOT produce a final empty line: the engine appends,
 * so the file almost always ends in one, and counting it would send an empty
 * string whose index the next append then wants to reuse.
 */
export const splitLines = (text: string): string[] => {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

/**
 * Where to resume after a server reply.
 *
 * Trusts the server's own `nextFrom` when it is sane, because the server is the
 * thing that knows what it stored; falls back to local arithmetic when the
 * reply is missing or absurd. Never moves BACKWARD — a stale or malformed reply
 * must not make the client re-send a batch it has already had accepted.
 */
export const advanceCursor = (sentThrough: number, batch: TBatch, serverNextFrom: unknown): number => {
  const local = batch.from + batch.lines.length;
  const server = typeof serverNextFrom === "number" && Number.isSafeInteger(serverNextFrom) ? serverNextFrom : null;
  return Math.max(sentThrough, local, server ?? 0);
};
