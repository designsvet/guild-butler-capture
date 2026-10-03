# Favor-only live excerpt — 2026-10-03

The first 18 activity lines from the owner's current Mac preview, recorded after leaving a
hideout for Timberslope Bridge, one recorded mob kill and returning. The owner confirmed no
faction activity. Only the emitted activity contract's allowlisted fields are retained;
character name is `Recorder` and the hideout UUID is replaced with a stable fake. No raw packet
dump, player/guild identities, chat or loot from other players is included.

This preserves the old engine's three wrongly named `faction` lines with currency discriminator
`city:7`. Each base amount equals the adjacent Might/Favor record's `favor`, and its running
total increases by that amount. They establish Favor updates, not city-faction gains. The app
must ignore them for faction totals while keeping all legitimate Might/Favor gains intact.
The repaired engine refuses this discriminator before writing a faction line.

Actual city currency IDs are 1–6, verified against the reference tool's
[UpdateCurrencyEvent decoder](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/Network/Events/UpdateCurrencyEvent.cs)
(blob `5215d0317a9de70d83bbab6a061782d0f2b78433`). The two older engine packet fixtures also
contain only currency ID 7; their replay now asserts that no faction event is emitted.

This excerpt proves the regression and supplies a deterministic partial-data layout case. It
does not prove a real faction-city gain, real Windows capture or sequence deduplication.
