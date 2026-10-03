# Loot Butler — slice 2, in progress

Scope: PvE, Gathering and Fishing, with journal completions in the engine. Acceptance remains all
three pages on recorded data at 1440, 1024 and 768, in both themes, with the shell's
locale/keyboard/CSP checks and inspection against their approved references. Follow the
[data-first design implementation flow](design/implementation-flow.md); report data correctness,
visual fidelity and live-game verification separately. PvE is offered under This session after a
kill or chest is recorded.
Gathering and Fishing remain unbuilt and absent from navigation. This branch is stacked on slice 1;
neither slice is merged or released by this work.

## Design state

Build the already approved PvE page first. The owner corrected the order on 2026-10-02: work on the
existing approved screens takes priority over proposing new Gathering/Fishing pages. The latter
proposals are paused while the approved PvE page is completed. PvP and DPS are also designed; the
overall plan places them in slices 5 and 6 because their data sources and decoding still need work.

PvE's approved board is F3 on the [v5 canvas](https://claude.ai/artifact/FbLQ85VeKLddohadcMNqYT).
Its HTML export was recovered from the signed-in canvas on 2026-10-02 and saved at
`~/albion/loot-butler-build/boards/F3.dc.html`, with the original ZIP under `source-exports/`. The
[PvE proof](design/pve-proof.md) records the source hash, implemented sections and data-dependent
gaps. The exported runtime is not executed or packaged. Following the owner’s native-icon correction on 2026-10-03, only the approved sprite/portrait subset is copied into the app, with provenance recorded in `resources/albion/PROVENANCE.md`.

Gathering/Fishing have two proposals drawn with the existing `lb.py` vocabulary: Fgf1 in the local
`~/albion/loot-butler-canvas` project ([rendered proposals](design/slice2-proposals.png)). A shares
totals above a haul table, with a secondary summary and journals; B groups resource kinds/catches
into separate blocks. A is recommended. The owner's concept-first rule requires a choice before
building either page. Both proposals use the September 21 recording's observed resources/catches.
Prices, best catch by value, partial journal progress and activity-specific fame have no proven
source and are omitted.

## Approved PvE page

`#/pve` consumes the same main-process snapshot as Session. The sidebar adds it only after a
recorded kill or chest; a fame-only session cannot establish PvE. A direct hash without those events
falls back to Session. Navigation focuses the main region and announces its title. New session
resets the page, filters and link; Stop preserves the page and freezes its visit clocks.

F3's observed sections are implemented: the six metric positions (unknown or zero currencies remain
absent), chronological visits with content filters, mobs sorted by Kills or Recent, Most killed /
Last kill, and recent chests. Currencies above the table are explicitly for the whole session. Visit
fame and silver include every recorded activity in that interval: neither they nor the whole-session
fame are labeled as combat-only. The reducer keeps visits separately from zone aggregates, complete
rarity counts, and the latest timestamp/location for each mob. Counts survive the 61-event feed
limit. Repeated visits remain separate; late lines match both zone and interval. An event without a
matching interval is visibly unplaced, with no invented start, duration or established visit count.
Mob details come from their kill events, not nearby fame gains. The 61-chest preview retains the
latest timestamps; complete counts and per-visit rarities stay in the model.

Unknown dungeon UUIDs remain Dungeon: solo/group size, parent zone, party, camps and bosses are not
guessed. Per-mob fame, the Fame sort and Biggest kill have no proven linkage and are omitted. No
item count/value is attributed to a chest. Mob imagery uses matching supplied F3 portraits or the native skull; the three supplied chest rarities use their native sprites. Filters derive from observed content only.
History ranges, Export and Share are still unbuilt and are not offered.

At 1440 the six metrics share a row; narrower windows use three columns so all six languages fit.
Below 1280 the visit duration moves under When and the mob's location under its name. At 768 the
visit content/currency fields move under Where and the main columns stack. No field requires
horizontal scrolling. The shared card/metric/number components also remain Session's components.

## Completed-journal contract

Event 292 is addressed to the current Join id. Parameters 1 and 2 carry the full book's item index
and positive whole quantity. The engine emits:

```json
{
  "v": 1,
  "t": "journal",
  "at": 1789578160537,
  "char": "Me",
  "zone": "…",
  "item": "T8_JOURNAL_WARRIOR_FULL",
  "index": 12055,
  "qty": 1
}
```

The decoder rejects missing, zero, fractional, negative or unsafe actor/index/count fields. Other
players' events and an old zone's self id do not count. A missing item table preserves
`UNKNOWN_<index>`; the app keeps its raw index and warning. The app's strict parser accepts the new
kind, the immutable reducer aggregates `journals` by item/index, New session resets it and Stop
retains it in the atomic summary. Completions also appear in Session's existing localized feed.
Journal names come from the unchanged pinned localization inputs, through the normal name-table
generator (full-book labels only), with the existing English fallback. No currency or fame gain is
inferred from completing a book.

Event 35 is an inventory snapshot, also visible when browsing bank/chest books. It does not
establish ownership or session progress. Across the four inspected recordings, gathering/fishing
snapshots were seen but no corresponding completion packets. The handler accepts those item IDs
through the same contract when observed; live gathering/fishing completion coverage still needs
proof. Missing journal data is not printed as zero. No payload deduplication is added.

## Evidence and bundle delivery

The engine worktree is based on `designsvet/ao-loot-logger@ab6cc6b` (`protocol18`). Its journal
fixture was produced by the allow-list extractor, then narrowed to the preceding Join and all six
event-292 packets from September 16. The app keeps only that Join and the first three genuine
completion packets; the frozen mapping and source-table hash are in
[test/fixtures/journals](../test/fixtures/journals). The quantities are `1, 4, 1`: six full crafting
books. Two genuine single-book packets are identical. The old dump contains no Photon sequence
metadata; the later block's resend status is inferred from timing and the surrounding craft. It is
not used as proof of journal sequence deduplication. Existing real-packet parser tests separately
prove live reliable-command filtering; a new instrumented journal recording remains necessary.

`resources/engine-patches/0002-journal-completions.patch` carries the handler into both platform CI
bundles. CI already applies patches idempotently and refuses drift. `prepare-engine-dist.mjs` copies
a previously patched runtime; it does not patch the owner checkout. Local assembly must likewise
apply patches in an isolated staging tree first. The new
`tools/check-journal-bundle.mjs <engine-dist>` runs the assembled activity tracker and its real file
writer, then parses those bytes through the app's actual reducer: four lines, three completion
packets, six books. It also refuses malformed/foreign events and visible inventory snapshots. Both
packaging jobs run this gate against `engine-dist` before packaging.

`0003-faction-city-currency.patch` also repairs generic currency updates: only positive earned
city IDs 1–6 establish faction activity; ID 7 is Favor. The model handles older mislabeled JSONL
without changing the raw files. Both jobs run `tools/check-currency-bundle.mjs engine-dist` to
verify assembled writer bytes through the actual app parser/reducer, preserving Might/Favor and
accepting a synthetic positive city probe. The [live Favor-only excerpt](../test/fixtures/currencies/README.md)
pins the owner's regression independently of the earlier evening and journal excerpts.
The currency patch retains nonempty trailing context and encodes blank context as unchanged
blank removals/additions. This is necessary for Windows CRLF checkouts: a bare blank context
line can pass on Mac and fail there. Forward and reverse application were verified in both
LF and CRLF, producing exactly the tested engine source after normalizing line endings.

## Verification and remaining work

Engine: the full Node test suite covers completions, ownership, unknown items, malformed quantities,
the real excerpt and the existing sequence filter. App: typecheck, the full unit suite, build,
old/v5 layout gates and replay gate. The v5 matrix includes an independent journal-only excerpt in
every theme, locale, platform and width, asserting the rendered feed's three events/six books and
absence of inferred fame. It does not combine that excerpt with the September 21 evening. Built
journal-feed screenshots extend the [Session proof](design/session-proof.md). PvE's recorded
active/stopped/reset cases and unknown/chest-only/missing-currency edge cases run in every theme,
language, platform and width, testing content filtering and both mob sort orders against the actual
snapshot. A journal-only direct PvE route checks the fallback. The real main/preload replay
additionally navigates to PvE, filters its visits, verifies focus, resets it, and checks visit/mob
metadata and closed visit clocks in the persisted summary. There is no new motion; the established
fold/feed behavior is reused.

Remaining: the selected Gathering/Fishing layout and three-width proofs; live self-owned
gathering/fishing completions and original journal sequence metadata; Mac/Windows native
capture/flush and VoiceOver/NVDA checks. R5 pricing, partial journal progress, History/export and a
beta release remain outside this increment. Package identity/version and the opt-in v5 flag are
unchanged.

## PvE increment validation — 2026-10-02

Passed: typecheck, 588 unit tests, build, 86 default-renderer layout cases,
all 6,336 v5 renderer scenarios, and the real main/preload replay gate. The full
matrix includes 4,608 still layouts and 1,728 Start/Stop morph frames. Screenshot
proofs include both themes at all three requested sizes, with scrolled content.
Native capture and assistive-technology checks remain outstanding as listed above.

## Visual correction — 2026-10-03

The owner confirmed live tracking but found Session/PvE visually incomplete against F1/F3. Restore
the supported approved details before starting PvP: native currency/activity/chest sprites,
hourly currency rates, source shares and ranked neutral bars, category markers, keyboard-reachable
PvE card/chest links, complete rarity strips, feed art/gains/place/time and recent-loot times. The
previous proof incorrectly deferred all rates; captured currencies already support session averages.
These changes leave the recorder and session storage unchanged. The model still cannot associate
fame with individual mobs or items/value with individual chests; their charts remain a documented gap.
On 2026-10-03 the owner supplied the F1 ZIP and explicitly corrected the outline substitution.
The approved native sprite subset is bundled locally with provenance and byte-parity checks.
Eight supplied F3 mob portraits resolve through the pinned dump's avatar keys; unsupported
portraits/rarities have honest fallbacks. This supersedes the earlier outline-only drawing rule,
while Q58's wider public redistribution question remains open. Fr defines five fixed KPI columns
at 1024 and 3 + 2 for five tiles at 768; rates share the value baseline and wrap if needed.
Activity cards retain four fixed column slots above 1280 and two below it, with F1's compact
headers and spacing. The previous full-width sparse-card correction departed from those slots;
the owner caught that drift alongside a phantom Faction value. The decoder had mislabeled every
generic currency update as faction. The source and legacy replay are now guarded by city ID and
positive gain, with an independent real Favor-only case in the renderer matrix. Built comparisons
and remaining scope are recorded in the [Session proof](design/session-proof.md).
Native captures themselves remain private in the ignored preview folder.

## Currency/grid correction verification — 2026-10-03

Passed on the final build: typecheck, 594 app tests, 177 engine tests, both assembled engine
bundle gates, real main/preload replay, 86 default-renderer layouts and all 1,152 v5 data-state
scenarios (themes, six locales, both platform layouts and four widths). The full shell/morph
matrix remains CI's default; this focused rerun covers the affected Session/PvE data routes.
Both-theme three-width regression/evening proofs were regenerated and inspected against the
retained F1/responsive composition. The journal-only empty-wrapper alignment also remains covered.
The complete F1 and fresh real faction/Windows/accessibility verification remain partial.
