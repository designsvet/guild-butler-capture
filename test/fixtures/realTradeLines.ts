/**
 * The trade journal as the REAL engine writes it (raid-bot ADR 0168; the build plan's "contract v1").
 *
 * PRINTED BY THE ENGINE ITSELF, not typed: designsvet/ao-loot-logger feat/player-trades 9ae23c0
 * (PR #20), its replay of the owner's two recordings that hold trades (2026-09-16 and 2026-09-21,
 * `test/fixtures/trades-2026-09-16-21.jsonl` through the real dispatcher, as its
 * `test/trade-replay.test.js` does) with `TRADE_EVENTS` on — the seven lines of the
 * `trade-events-*.jsonl` it wrote, byte for byte. Names are the fixture's scrubbed placeholders
 * (the member "Me", partners "Partner1…7", the guild "OurGuild"); numbers are as recorded.
 *
 * Four are silver-only payouts (0, 1, 2, 4), which never leave the machine; three moved items (3, 5,
 * 6), two of them with silver coming back (3: 5,000,000; 5: 10,000), which goes with them. Line 6 is
 * the plan's example, and the text the bot's own pin (test/fixtures/realTradeLine.ts, slice A) holds.
 *
 * When the engine changes the record, RE-RECORD — never edit a line here to fit a rule.
 */
export const REAL_TRADE_LINES: readonly string[] = [
  '{"v":1,"t":"trade","at":"2026-09-16T15:25:52.210Z","server":"europe","zone":"@HIDEOUT@1354@314c8461-1bf5-7be9-eebe-c29129d0616f","tradeId":295,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner1","guild":"OurGuild","hidden":false},"revision":10,"acceptedRevision":10,"complete":true,"gave":[],"got":[],"silverGave":60000000,"silverGot":0}',
  '{"v":1,"t":"trade","at":"2026-09-16T15:28:43.301Z","server":"europe","zone":"@HIDEOUT@1354@314c8461-1bf5-7be9-eebe-c29129d0616f","tradeId":298,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner2","guild":"OurGuild","hidden":false},"revision":13,"acceptedRevision":13,"complete":true,"gave":[],"got":[],"silverGave":41956000,"silverGot":0}',
  '{"v":1,"t":"trade","at":"2026-09-16T15:29:57.357Z","server":"europe","zone":"@HIDEOUT@1354@314c8461-1bf5-7be9-eebe-c29129d0616f","tradeId":300,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner3","guild":"OurGuild","hidden":false},"revision":12,"acceptedRevision":12,"complete":true,"gave":[],"got":[],"silverGave":16678000,"silverGot":0}',
  '{"v":1,"t":"trade","at":"2026-09-16T17:46:26.095Z","server":"europe","zone":"@ISLAND@0348586a-f6d4-04ec-b303-b66b5e4c7217","tradeId":327,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner4","guild":"OurGuild","hidden":false},"revision":22,"acceptedRevision":22,"complete":true,"gave":[{"index":9484,"item":"T8_2H_KNUCKLES_SET3","qty":4,"quality":4},{"index":9484,"item":"T8_2H_KNUCKLES_SET3","qty":5,"quality":3}],"got":[],"silverGave":0,"silverGot":5000000}',
  '{"v":1,"t":"trade","at":"2026-09-16T17:51:28.426Z","server":"europe","zone":"@ISLAND@61639f98-d9f7-1251-827e-daa6a624d40d","tradeId":377,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner5","guild":"OurGuild","hidden":false},"revision":9,"acceptedRevision":9,"complete":true,"gave":[],"got":[],"silverGave":5436000,"silverGot":0}',
  '{"v":1,"t":"trade","at":"2026-09-16T18:52:27.045Z","server":"europe","zone":"@HIDEOUT@1354@314c8461-1bf5-7be9-eebe-c29129d0616f","tradeId":459,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner6","guild":"OurGuild","hidden":false},"revision":10,"acceptedRevision":10,"complete":true,"gave":[{"index":9233,"item":"T8_MAIN_MACE","qty":1,"quality":4},{"index":9225,"item":"T6_MAIN_MACE@2","qty":1,"quality":4}],"got":[],"silverGave":0,"silverGot":10000}',
  '{"v":1,"t":"trade","at":"2026-09-21T18:14:36.986Z","server":"europe","zone":"2218","tradeId":1766,"initiator":"self","self":{"name":"Me","guild":"OurGuild","alliance":"OurAlliance"},"partner":{"name":"Partner7","guild":"OurGuild","hidden":false},"revision":3,"acceptedRevision":3,"complete":true,"gave":[{"index":570,"item":"T7_POTION_REVIVE","qty":11,"quality":1}],"got":[],"silverGave":0,"silverGot":0}',
];
