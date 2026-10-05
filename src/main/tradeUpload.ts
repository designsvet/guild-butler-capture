/**
 * The trade upload (raid-bot ADR 0168, Q69; the build plan's slice 1): the trade journal the engine
 * writes beside the loot log, followed and sent by the same loop as the loot log (uploader.ts) — a
 * stream of its own, not a fire-and-forget forwarder like the energy readings, because a trade lost
 * while the bot was unreachable would leave a debt on the wrong member.
 *
 * Everything here is behind the v5 shell's flag (settings.ts `wantsV5Shell`, read in main as
 * `heldUploadOn`), as everything new is: the engine is asked for the file only there
 * (`withTradeEvents`), and only there is it followed. A 0.8.x old-window release neither writes nor
 * sends a trade.
 *
 * Pure: main wires it (src/main/index.ts).
 */

import { basename, dirname, join } from "node:path";

import { lootBroken, TRADE_HANDLERS } from "../shared/engineHealth.js";
import type { TBrokenHandler } from "../shared/captureTypes.js";
import { MAX_TRADE_LINE_LENGTH, tradeStreamLine } from "./tradeLines.js";
import { uploadTradeBatch } from "./uploadClient.js";
import { completeLines } from "./uploadPlan.js";
import type { TUploadStream } from "./uploader.js";

/**
 * The engine's switch for the trade journal (designsvet/ao-loot-logger#20, `src/trades/trade-log.js`):
 * off unless `TRADE_EVENTS=1`. Set for the engine child under the v5 flag and REMOVED otherwise —
 * a developer's shell exporting it must not have the old window's engine write partner names into
 * a file nothing reads.
 */
export const withTradeEvents = (env: NodeJS.ProcessEnv, on: boolean): NodeJS.ProcessEnv => {
  const next: NodeJS.ProcessEnv = { ...env };
  if (on) {
    next.TRADE_EVENTS = "1";
  } else {
    delete next.TRADE_EVENTS;
  }
  return next;
};

/**
 * The trade journal of a loot log: `loot-events-2026-10-05-17-43-51.txt` →
 * `trade-events-2026-10-05-17-43-51.jsonl`, same folder — the engine's own rule (`tradeFileFor`),
 * so the journal is found by the loot log's name, rolls when it rolls, and needs no folder scan.
 * Null for a file that is not a loot log (nothing to follow). The file itself appears only once a
 * trade finishes; until then the uploader's read fails and it waits, as it does for a rolled file.
 */
export const tradeFileFor = (lootFile: string | null): string | null => {
  if (lootFile == null) {
    return null;
  }
  const name = basename(lootFile);
  if (!name.startsWith("loot-events-") || !name.endsWith(".txt")) {
    return null;
  }
  return join(dirname(lootFile), `trade-events-${name.slice("loot-events-".length, -".txt".length)}.jsonl`);
};

/**
 * The journal this capture session follows: the current loot log's, once THIS session's engine has
 * named its own log — and nothing before that.
 *
 * A new session keeps the last session's log in main's state (captureSession.ts `user-start`, so
 * Reveal still finds it), and the uploader's cursor was just reset (startUploadLoop). Following that
 * log's journal from a reset cursor would mint a new run and send every trade in it again, under a
 * `(run, line)` key the bot cannot know for the same trade — a debt moved twice. The window is real:
 * the engine names its log only after its item table and its version check (seconds; a stalled
 * GitHub request, longer), and the first pass runs ten seconds after Start. Waiting loses nothing:
 * the last session's tail had its final pass as that session stopped (stopUploadLoop), and no
 * session goes back to an earlier session's journal.
 *
 * `lootFileAtStart` is main's `state.logFile` as the session started. (The loot log has the same
 * window, older than this slice; its uploader is unchanged here.)
 */
export const tradeFileThisSession = (lootFile: string | null, lootFileAtStart: string | null): string | null =>
  lootFile === lootFileAtStart ? null : tradeFileFor(lootFile);

/**
 * When the trade upload holds: a broken trade handler, or anything that holds the loot upload.
 *
 * The first is the trade decoder itself — a moved field in a trade packet, and what it writes is
 * wrong. The second is a choice, and the safe one: a trade's record leans on loot handlers too
 * (OpJoin names the member and the zone; EvNewCharacter and EvOtherGrabbedLoot are how the engine
 * sees that a zone hides names, so a broken one could let a masked partner's name through), and
 * what a trade moves is counted against the pickups the loot log holds — pickups that, while the
 * loot decoder is broken, are held themselves. A trade-only break, though, holds trades alone: the
 * loot upload goes on (NON_LOOT_HANDLERS lists the trade handlers).
 *
 * Held trade lines are never sent, as held loot lines are not (heldUploads.ts): the range is
 * recorded in the same store, and the journal keeps them on the member's computer.
 */
export const tradesBroken = (broken: readonly TBrokenHandler[] | null): boolean =>
  lootBroken(broken) || (broken ?? []).some((entry) => TRADE_HANDLERS.has(entry.handler));

/**
 * How long the app waits before asking a bot without the trade route (uploadClient.ts
 * `uploadTradeBatch`) again. The route comes with the bot's slice A, after this app ships: until
 * then every app would 404 on every pass, so the stream asks every half hour instead of every few
 * seconds, says so once in the app log, and keeps its lines under the cursor — never a word to the
 * member, never a pause in the loot upload (a separate uploader).
 *
 * Kept for THIS capture session: the lines go if the route appears before the session ends. The
 * cursor and the wait live per session and the next session follows its own journal, so the trades
 * of a session that ends first stay in the member's file and are never sent — acceptable while the
 * stream is behind the v5 flag, which goes default only after slice A is live.
 */
export const TRADE_MISSING_ROUTE_DELAY_MS = 30 * 60_000;

/**
 * The trade journal as an upload stream: finished lines only, each sent verbatim or withheld; a line
 * the bot refuses even alone is withheld too (`bot-refused`), and the trades after it still go —
 * each line is a record of its own, and this uploader's state is shown nowhere, so a stop would be
 * silent until the app restarts. (The bot answers a line it will not take inside a 200, never with a
 * 400 — slice A's contract; this is the app's side of the same rule.)
 */
export const TRADE_STREAM: TUploadStream = {
  tag: "trades",
  send: uploadTradeBatch,
  lines: (text) => completeLines(text).map(tradeStreamLine),
  lineCap: MAX_TRADE_LINE_LENGTH,
  missingRouteDelayMs: TRADE_MISSING_ROUTE_DELAY_MS,
  skipsRefusedLine: true,
};
