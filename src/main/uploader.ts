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
import { advanceCursor, ENewRunReason, newRunReason, nextBatch, splitLines, type TUploadCursor } from "./uploadPlan.js";

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

  const set = (patch: Partial<TUploaderStatus>): void => {
    status = { ...status, ...patch };
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
      deps.log(`[upload] refused: ${result.outcome} ${result.detail ?? ""}`.trim());
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
      const lines = splitLines(text);
      const reason = newRunReason(cursor, file, lines.length);
      if (reason != null) {
        // A new file gets a NEW run id, or its line numbers would collide with
        // the previous file's under the server's (run, line_no) key and be
        // swallowed as duplicates. See `newRunReason`.
        cursor = { run: deps.newRunId(), file, sentThrough: 0 };
        if (reason !== ENewRunReason.FirstFile) {
          deps.log(`[upload] new run for ${file} (${reason})`);
        }
      }
      const active = cursor;
      if (active == null) {
        return;
      }
      const batch = nextBatch(active.sentThrough, lines);
      if (batch == null) {
        set({ state: EUploaderState.UpToDate, failures: 0, lastError: null });
        return;
      }

      set({ state: EUploaderState.Sending });
      const result = await uploadBatch(deps.fetchLike, deps.base, token, active.run, file, batch);
      if (result.outcome !== EUploadOutcome.Accepted) {
        onFailure(result);
        return;
      }
      active.sentThrough = advanceCursor(active.sentThrough, batch, result.reply.nextFrom);
      nextAttemptAt = 0;
      set({
        state: active.sentThrough >= lines.length ? EUploaderState.UpToDate : EUploaderState.Sending,
        sentTotal: status.sentTotal + result.reply.accepted,
        lastSentAt: deps.now(),
        failures: 0,
        lastError: null,
      });
    } finally {
      running = false;
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
