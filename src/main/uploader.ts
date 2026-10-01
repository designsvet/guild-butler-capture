/**
 * The uploader (ADR 0092 P2 slice 4) — pushes captured lines to the bot while
 * capture runs.
 *
 * Design rule, and it outranks everything else here: **uploading must never
 * interfere with capturing.** The file on disk is the fallback and the
 * drag-and-drop path still works, so every failure in this module is reported
 * and retried, never escalated. Nothing here can stop the engine, block a
 * Start, or throw into the capture session.
 *
 * One thing outranks even that, and it is about the guild's numbers, not the
 * member's capture: **while the decoder is broken where loot is concerned, nothing
 * is sent, and what the engine writes meanwhile is never sent** (raid-bot ADR
 * 0159, amendment 2026-10-01). A game update had bank deposits logged as loot for
 * five days in September 2026, and 72 of them were cleaned out of the bot by hand.
 * So while `held()` says so, every pass records where the hold began in the file
 * it would read (`THeldRange`, kept on disk by heldUploads.ts so an app restart —
 * the update — does not forget it), and sends nothing; and every pass, held or
 * not, sends a file only up to its hold.
 *
 * Every dependency is injected — no Electron, no direct `fs`, no timers of its
 * own beyond the tick it is driven by — so the whole loop is testable.
 */

import {
  EUploadOutcome,
  isRetryable,
  uploadBatch,
  type TFetchLike,
  type TUploadResult,
} from "./uploadClient.js";
import {
  advanceCursor,
  ENewRunReason,
  heldRangeFor,
  heldRangeOn,
  MAX_BATCH_LINES,
  newRunReason,
  nextBatch,
  sendableLines,
  splitLines,
  type THeldRange,
  type TUploadCursor,
} from "./uploadPlan.js";

export enum EUploaderState {
  /** No pairing — nothing to do, and not an error. */
  Unpaired = "unpaired",
  /** Paired, but the member switched auto-upload off. */
  Disabled = "disabled",
  /** Paired and quiet: everything captured so far has been sent. */
  UpToDate = "up-to-date",
  /** Mid-flight. */
  Sending = "sending",
  /** Failed and will try again — the file on disk is safe meanwhile. */
  Retrying = "retrying",
  /** The token no longer works. Needs the member to pair again. */
  Unauthorized = "unauthorized",
  /** The server refused the batch's shape: a bug here, not a transient. */
  Blocked = "blocked",
  /**
   * This guild's bot has no upload route yet. Kept separate from Retrying so
   * the UI does not blame the network for something only an officer can fix —
   * but it IS retried, so the app resumes by itself once the bot is updated.
   */
  BotOutdated = "bot-outdated",
  /**
   * The decoder is broken where loot is concerned: nothing is sent until the
   * app updates, and what is logged meanwhile never is ("Held until the
   * update" in the v5 shell's sidebar foot).
   */
  Held = "held",
}

export type TUploaderStatus = {
  state: EUploaderState;
  /** Lines this capture session has had accepted (duplicates not counted). */
  sentTotal: number;
  /** Last successful upload, epoch ms. */
  lastSentAt: number | null;
  /** Consecutive failures — drives the backoff and the UI's "retrying" line. */
  failures: number;
  /** Last failure's reason, for the UI sentence and the app log. */
  lastError: EUploadOutcome | null;
};

export const initialUploaderStatus: TUploaderStatus = {
  state: EUploaderState.Unpaired,
  sentTotal: 0,
  lastSentAt: null,
  failures: 0,
  lastError: null,
};

export type TUploaderDeps = {
  fetchLike: TFetchLike;
  /** Base URL of the bot. */
  base: string;
  /** Null when unpaired or the token could not be decrypted. */
  token: () => string | null;
  /** False when the member switched auto-upload off. */
  enabled: () => boolean;
  /** The log file to read, or null when capture has not produced one. */
  currentFile: () => string | null;
  readFile: (path: string) => Promise<string>;
  /** Fresh run id per file — see `newRunReason`. */
  newRunId: () => string;
  now: () => number;
  log: (line: string) => void;
  /**
   * The decoder is broken where loot is concerned (src/shared/engineHealth.ts
   * `lootBroken` over the session's sticky list): hold everything.
   */
  held: () => boolean;
  /** The held ranges, remembered across app restarts (heldUploads.ts). */
  holds: {
    list: () => readonly THeldRange[];
    add: (range: THeldRange) => boolean;
  };
};

/** Backoff between retries, capped. Uploading is not urgent; the file is safe. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];

export const retryDelayMs = (failures: number): number => {
  const i = Math.min(Math.max(failures - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 300_000;
};

export type TUploader = {
  /** Run one pass. Safe to call on a timer; overlapping calls are ignored. */
  tick: () => Promise<void>;
  status: () => TUploaderStatus;
  /** New capture session: forget the cursor so the next file starts a new run. */
  resetSession: () => void;
  /** The member paired or unpaired — re-evaluate on the next tick. */
  refresh: () => void;
};

export const createUploader = (deps: TUploaderDeps): TUploader => {
  let status: TUploaderStatus = { ...initialUploaderStatus };
  let cursor: TUploadCursor | null = null;
  let running = false;
  let nextAttemptAt = 0;
  /**
   * Line ceiling for the next attempt. Shrinks on a refusal, resets on a send.
   *
   * A refusal used to park this uploader in `Blocked` for good — see
   * `onFailure`. Most refusals are about the SIZE of the batch (a body over the
   * route's limit, a cap that drifted between the two repos), and sending less
   * is the cheapest thing that could possibly make the next attempt succeed.
   */
  let batchCap = MAX_BATCH_LINES;
  /**
   * How many lines the LAST attempt actually carried.
   *
   * The retry halves this rather than `batchCap`, and the difference is the
   * whole fix: a 40-line file refused under a 500-line ceiling would have been
   * "halved" to 250 and re-sent at exactly 40, four times over, before anything
   * moved. Shrinking what was really sent is the only version that converges.
   */
  let lastBatchLines = MAX_BATCH_LINES;

  const set = (patch: Partial<TUploaderStatus>): void => {
    status = { ...status, ...patch };
  };

  /**
   * The hold reaches the file the engine is writing: from where this uploader stands in it, or
   * from its first line when it has sent none of it. Once per file — the first record is the one
   * that counts, and a later pass, standing no further on, would only say the same.
   */
  const recordHold = (): void => {
    const file = deps.currentFile();
    if (file == null || heldRangeOn(deps.holds.list(), file) != null) {
      return;
    }
    const range = heldRangeFor(cursor, file, deps.now());
    deps.holds.add(range);
    deps.log(`[upload] held: nothing from line ${range.from} of ${file} on is sent — the decoder is broken`);
  };

  /** Held shows unless the device itself needs a human first (pairing again, a stuck line). */
  const showHeld = (): void => {
    if (status.state !== EUploaderState.Unauthorized && status.state !== EUploaderState.Blocked) {
      set({ state: EUploaderState.Held });
    }
  };

  const onFailure = (result: Extract<TUploadResult, { outcome: Exclude<EUploadOutcome, EUploadOutcome.Accepted> }>) => {
    const failures = status.failures + 1;
    if (result.outcome === EUploadOutcome.Unauthorized) {
      // Not retryable and not a transient: the member revoked this device, or
      // the token was minted against a guild the bot no longer serves. Say so
      // once and stop, instead of hammering a door that will not open.
      deps.log(`[upload] unauthorized — this device needs pairing again`);
      set({ state: EUploaderState.Unauthorized, failures, lastError: result.outcome });
      return;
    }
    if (!isRetryable(result.outcome)) {
      // A refusal is not automatically fatal, and treating it as one is how a
      // member's whole raid could go missing behind one line in the UI. The
      // sibling branch above already got this right for NotDeployed — "it heals
      // by itself, so keep trying rather than parking in a dead state they must
      // clear" — and the same is true here: nearly every refusal we can
      // actually provoke is about the batch being too big for the route, which
      // a smaller batch fixes. So halve and try again, all the way down to a
      // single line; only when ONE line is still refused is the batch not the
      // problem and a human needed.
      if (lastBatchLines > 1) {
        batchCap = Math.max(1, Math.floor(lastBatchLines / 2));
        nextAttemptAt = deps.now() + retryDelayMs(failures);
        deps.log(`[upload] refused: ${result.outcome} — retrying with ${batchCap} line(s)`.trim());
        set({ state: EUploaderState.Retrying, failures, lastError: result.outcome });
        return;
      }
      deps.log(`[upload] refused even one line at a time: ${result.outcome} ${result.detail ?? ""}`.trim());
      set({ state: EUploaderState.Blocked, failures, lastError: result.outcome });
      return;
    }
    const delay = retryDelayMs(failures);
    nextAttemptAt = deps.now() + delay;
    deps.log(`[upload] ${result.outcome} (${result.detail ?? "no detail"}) — retrying in ${Math.round(delay / 1000)}s`);
    set({
      // Same retry mechanics, different sentence: a missing route is not a
      // network hiccup and saying so would send the member chasing their wifi.
      state: result.outcome === EUploadOutcome.NotDeployed ? EUploaderState.BotOutdated : EUploaderState.Retrying,
      failures,
      lastError: result.outcome,
    });
  };

  const tick = async (): Promise<void> => {
    if (running) {
      // A slow request must not have a second pass stacked behind it: the
      // server is idempotent, but two in-flight batches would fight over the
      // cursor. Same lesson as the bot's own non-overlapping sweeps.
      return;
    }
    if (deps.held()) {
      // First, before pairing, the switch or a backoff can return: the hold is
      // about the lines, whoever might send them later, and it must be on disk
      // before the app can restart into the fixed build.
      recordHold();
    }
    const token = deps.token();
    if (token == null) {
      set({ state: EUploaderState.Unpaired });
      return;
    }
    if (!deps.enabled()) {
      set({ state: EUploaderState.Disabled });
      return;
    }
    if (status.state === EUploaderState.Unauthorized || status.state === EUploaderState.Blocked) {
      // Both need a human. Keep the state visible rather than flapping.
      return;
    }
    if (deps.held()) {
      set({ state: EUploaderState.Held });
      return;
    }
    if (deps.now() < nextAttemptAt) {
      return;
    }
    const file = deps.currentFile();
    if (file == null) {
      return;
    }

    running = true;
    try {
      let text: string;
      try {
        text = await deps.readFile(file);
      } catch {
        // The engine may have rolled the file between our look and our read.
        // Next tick sees the new one; nothing to report.
        return;
      }
      if (deps.held()) {
        // The verdict landed while the file was read: what was read may already
        // hold its lines. Nothing goes; the finally below records where.
        return;
      }
      const lines = splitLines(text);
      const hold = heldRangeOn(deps.holds.list(), file);
      // A held file's cursor stands at its hold, so a file shorter than that reads as "shrank" on
      // every pass; it is not a new run — nothing from the hold on is ever sent anyway.
      const found = newRunReason(cursor, file, lines.length);
      const reason = found === ENewRunReason.FileShrank && hold != null ? null : found;
      if (reason != null) {
        // A new file gets a NEW run id, or its line numbers would collide with
        // the previous file's under the server's (run, line_no) key and be
        // swallowed as duplicates. See `newRunReason`. A held file instead
        // resumes the run its first lines went under, at its hold: nothing
        // before it is sent twice, and nothing after it ever.
        cursor =
          hold != null
            ? { run: hold.run ?? deps.newRunId(), file, sentThrough: hold.from }
            : { run: deps.newRunId(), file, sentThrough: 0 };
        if (reason !== ENewRunReason.FirstFile) {
          deps.log(`[upload] new run for ${file} (${reason})`);
        }
        if (hold != null) {
          deps.log(`[upload] ${file} is held from line ${hold.from}: nothing from there on is sent`);
        }
      }
      const active = cursor;
      if (active == null) {
        return;
      }
      const sendable = sendableLines(deps.holds.list(), file, lines.length);
      const batch = nextBatch(active.sentThrough, lines.slice(0, sendable), batchCap);
      if (batch == null) {
        set({ state: EUploaderState.UpToDate, failures: 0, lastError: null });
        return;
      }

      set({ state: EUploaderState.Sending });
      lastBatchLines = batch.lines.length;
      const result = await uploadBatch(deps.fetchLike, deps.base, token, active.run, file, batch);
      if (result.outcome !== EUploadOutcome.Accepted) {
        onFailure(result);
        return;
      }
      active.sentThrough = advanceCursor(active.sentThrough, batch, result.reply.nextFrom);
      nextAttemptAt = 0;
      // Back to full size: whatever the refusal was about, it is behind us.
      batchCap = MAX_BATCH_LINES;
      lastBatchLines = MAX_BATCH_LINES;
      set({
        state: active.sentThrough >= sendable ? EUploaderState.UpToDate : EUploaderState.Sending,
        sentTotal: status.sentTotal + result.reply.accepted,
        lastSentAt: deps.now(),
        failures: 0,
        lastError: null,
      });
    } finally {
      running = false;
      if (deps.held()) {
        // The verdict landed during this pass — mid-read, or while a batch read
        // before it was in flight: the hold starts where this pass left off.
        recordHold();
        showHeld();
      }
    }
  };

  return {
    tick,
    status: () => status,
    resetSession: () => {
      cursor = null;
      nextAttemptAt = 0;
      status = { ...initialUploaderStatus, state: status.state };
    },
    refresh: () => {
      nextAttemptAt = 0;
      if (status.state === EUploaderState.Unauthorized || status.state === EUploaderState.Blocked) {
        // Pairing again is the fix for both; let the next tick re-evaluate.
        status = { ...initialUploaderStatus };
      }
    },
  };
};
