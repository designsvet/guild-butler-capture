# Recorded September 21 evening

Two real `ACTIVITY_EVENTS=1` engine runs recorded on 2026-09-21 (38 + 323 activity
lines), with their two loot logs. Numeric payloads, item IDs, mob IDs, world IDs,
event times, source order and running fame totals are unchanged. Player names
are replaced with `Recorder` / `PlayerN`, guild/alliance fields are cleared, and
instance UUIDs are replaced consistently. No packet dumps or guild dumps are
included. These files are a decoder/reducer fixture, never a price fixture.

All currency fields below are fixed-point integers at 10,000 units per displayed
point or silver. Keep fractions until display; do not floor individual gains.

| Total                                   |      Raw units |
| --------------------------------------- | -------------: |
| Fame                                    | 13,307,603,664 |
| Respec credits gained                   |  2,351,349,126 |
| Respec silver paid                      |  2,720,068,000 |
| Silver gross                            |    159,818,447 |
| Silver tax (cluster + guild + alliance) |     17,655,807 |
| Silver received                         |    142,162,640 |
| Might (base + bonus + premium)          |    159,966,314 |
| Favor (base + bonus + premium)          |     70,156,519 |
| Faction points                          |    113,949,404 |

There are 40 mob kills, 19 gathered resources (base + bonus + premium), one
landed catch containing two fish and two seaweed, one escaped catch, and one
chest opening. Across the two engine files, all 38 join-to-join fame spans
reconcile. Fame accumulated while capture was stopped between files is excluded
from gains; that gap is not an audited span. The session duration is the elapsed
recorded evening, including the gap, rather than a measured active-play duration.

`sessionModel.test.ts` pins these totals and independently sums the raw gain
fields. `sessionTracker.test.ts` exercises real byte tails, file rotations,
partial UTF-8, New session, summaries, same-file restarts, and backwards timestamps.
`tools/session-fixture.cjs` shares the same reducer with the built layout check
and screenshot proofs. `pnpm check:replay` drives the real main process, preload
and renderer without a packet driver or bot traffic.
