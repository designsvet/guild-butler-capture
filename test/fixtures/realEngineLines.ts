/**
 * Lines recorded from the REAL engine — ao-loot-logger (madvac fork, branch
 * protocol18, banner "AO Loot Logger - v0.0.0-development") — captured
 * 2026-08-20 on macOS via tools/record-engine-output.mjs: a few minutes on the
 * Europe server with one loot pickup. Player names and paths are the session's
 * own, verbatim (the leading tab on the detection lines included).
 *
 * This file is the adapter's ground truth. When the engine changes, RE-RECORD
 * and extend it — never edit a line here to fit a pattern.
 */

/** Signal lines: each must parse to the exact event asserted in the test. */
export const REAL = {
  detected: "\tALBION DETECTED. Loot events should be logged.",
  logAnnounce:
    "Logs will be written to /Users/boris/Library/CloudStorage/Dropbox/Discord Bot/ao-loot-logger/loot-events-2026-08-20-08-40-13.txt",
  logAnnouncedPath:
    "/Users/boris/Library/CloudStorage/Dropbox/Discord Bot/ao-loot-logger/loot-events-2026-08-20-08-40-13.txt",
  /** Every ~60s until the first zone change — the character field is a PHRASE. */
  heartbeatUnknown: "[status] character: not identified yet (change zone once) · lines written: 0",
  heartbeatNamed: "[status] character: Bors · lines written: 1",
  /**
   * Source-derived (designsvet/ao-loot-logger@protocol18, src/index.js): the
   * heartbeat appends a third `held: N` field while self-loots are pending.
   * Not seen in the recording (nothing was held) but the code can emit it.
   */
  heartbeatWithHeld: "[status] character: Bors · lines written: 4 · held: 1",
  /**
   * The daily bonus rotation (raid-bot ADR 0100), recorded 2026-08-28 on Europe — the FIRST
   * real `FestivitiesUpdate`, which also confirmed the Photon event code is **518**.
   *
   * Ticks are verbatim, unconverted: the engine reports what the wire said, and this app's
   * adapter is the thing that turns them into epoch milliseconds. Note the empty `category` on
   * the seasonal rows and `GENERAL` on the production pair — neither was predicted.
   */
  festivities:
    '[festivities] {"server":"europe","code":518,"entries":[' +
    '{"kind":0,"category":"","uniqueName":"DRAGON_LEAD_UP_PHASE_1","startTicks":639187560000000000,"endTicks":639237672000000000},' +
    '{"kind":1,"category":"ACTIVITIES","uniqueName":"MISTS","startTicks":639234216000000000,"endTicks":639236808000000000},' +
    '{"kind":2,"category":"GENERAL","uniqueName":"COMMON_BOW","startTicks":639235080000000000,"endTicks":639235944000000000}' +
    "]}",
} as const;

/**
 * Diagnostic lines that must stay noise: never fatal, never a character or
 * log-file event. Includes the recoverable photon-decoder warnings and samples
 * of the huge [debug] event dumps (header lines and untagged continuation
 * lines both), whose payloads are full of player and item strings.
 */
export const REAL_NOISE: readonly string[] = [
  "AO Loot Logger - v0.0.0-development",
  "Listening to en6",
  "Listening to lo0",
  'You can always press "d" to start a new log file.',
  "Join the Discord server: https://discord.gg/fvNMF2abXr (Ctrl + click to open).",
  "AO Loot Logger Viewer can be found here: https://loot-logger.ddns.net/ao-loot-logger-viewer (Ctrl + click to open).",
  "\tCURRENT SERVER: Europe (Europe)",
  "05:42:00 UTC: {UA} [VITRYLA] Bors looted 1x Expert's Rune from @MOB_MORGANA_CROSSBOWMAN_CHAMPION.",
  "2026-08-20T05:41:26.792Z [warn]: error parsing photon packet outofboundread [",
  "2026-08-20T05:41:26.793Z [warn]: packet [ 'E9 71 2D D5 01 01 00 00 20 CB EF E2 16 63 06 BE' ]",
  "2026-08-20T05:40:41.502Z [debug]: EvNewSimpleItem [",
  "2026-08-20T05:41:58.164Z [debug]: EvNewLoot [",
  "2026-08-20T05:41:58.998Z [debug]: EvOtherGrabbedLoot [",
  "2026-08-20T05:41:17.347Z [debug]: EvNewCharacter [",
  "2026-08-20T05:41:17.381Z [debug]: UNPROCESSED_EVENT NAMES A PLAYER [",
  "  { playerName: 'KISELUGA', guildName: 'VITRYLA', allianceName: 'UA' },",
  '    itemName: "Adept\'s Tome of Insight",',
  "    lootedBy: 'Bors',",
  "    '6': 'Bors',",
] as const;
