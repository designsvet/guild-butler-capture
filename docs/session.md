# Session — slice 1 of Loot Butler

The v5 shell reads the engine's real activity JSONL and loot CSV into one
main-process session. It remains opt-in; the default 0.8.8 window and package
identity stay unchanged. This implements raid-bot ADR 0159's Session slice.

## Data and boundaries

`src/shared/session/events.ts` validates the v1 activity contract and the 11-field
loot format. Malformed or future-version lines are refused and logged with their
file and line. `model.ts` folds immutable snapshots, keeps fixed-point currency
integers until display, and groups gains by the event's own zone. Gains without a zone remain in an
explicit unknown source; they never disappear from source totals. Silver received
is gross yield less cluster, guild and alliance taxes; Might and Favor each
include their own bonus and premium fields. Faction remains a separate currency.
Two equal payloads can be two genuine gains: only the tail's byte cursor prevents
repeat delivery.

`src/main/sessionFiles.ts` owns byte cursors for both streams and all rotations.
Each read is at most 256 KiB; a poll drains the file sizes captured at its start,
then sorts the complete batch by timestamp, preserving source order on ties.
Partial lines and split UTF-8 wait for the next read. Overlapping polls coalesce.
A live Start baselines existing files at EOF; an engine that appends to a reused
same-second filename still contributes its new lines. A truncated file is logged
and resumed at its new end rather than counted twice.

`sessionTracker.ts` emits dirty snapshots on a 250 ms timer. New session drains
pending data, atomically saves the completed summary, then resets counters and
raw ranges without stopping capture. Current character, zone and fame-audit
baseline carry forward: staying in the same zone does not require another join.
A failed save refuses the reset and preserves its counters. A failed Stop save
still closes the rendered session; its error is logged and the raw files remain. Stop drains after
engine exit. Quit waits for the engine's graceful exit (bounded by four seconds)
and the final summary before closing. Empty sessions create no history entry.

Summaries are `sessions/<id>/session.json` beside live captures. Each names the
source file and an absolute half-open byte range `[fromByte, toByte)`, plus
`originByte` and line numbers counted from that origin. Origin is zero for a new
file/replay and the initial EOF for an existing live file. The `context` records
character, zone and audit state carried at a manual boundary. To rebuild a
summary, start a fresh session at its recorded time, restore that context, fold
its raw byte ranges in timestamp order, then close at `endedAt`. Raw files remain
the authority. The feed is bounded to 61 events, recent loot to six, and the chest
preview to 61; aggregate counts retain the complete session. No database is added.

The fame audit checks each engine file separately: sums of fame gains between
joins must equal the join's running-total delta. It never treats the gap between
two separate engine runs as a continuously observed span. Unknown IDs and audit
failures have a Session warning rather than an invented name or zero.

## Names and images

`pnpm session:names <dump-folder> <revision>` regenerates the committed world,
mob and resource-name tables. It consumes `clusters.json` (cluster/world.json),
`mobs.json`, `worldsettings.json` and `localization.json` from
[ao-bin-dumps at the pinned revision](https://github.com/ao-data/ao-bin-dumps/tree/47e4f5aca4d30b7495afa5a625ce0d5795e32050).
`docs/session-names.json` pins input hashes, output hash and row counts; a test
checks the committed bytes. Mob indices preserve file order with the protocol's
16-entry offset, also used by
[Statistics Analysis Tool](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/GameFileData/MobsData.cs).
Dynamic dungeon UUIDs say Dungeon; they do not reveal solo/group size, a name,
tier or colour. An unknown mob keeps its index. `UNKNOWN_<index>` items warn
across harvesting, fishing, journal completions and loot. The same pinned
localization generator now includes journal names; unavailable localized names
retain the existing English fallback, and genuinely unknown IDs stay visible.

Item images use `albion-art://item/<ID>`. Main accepts only canonical uppercase
item IDs, fetches only Albion's official HTTPS render service, refuses redirects,
limits requests to eight seconds and one MiB PNGs, coalesces concurrent loads,
and atomically caches under the app's `item-art/` folder. Cached art works offline;
an unavailable image uses a neutral icon. Electron exempts this tightly handled
secure custom scheme from CSP; the page's CSP text stays unchanged and no arbitrary
remote URL can enter the handler. There is no extracted client art (Q58 remains
open). Layout proofs stub the protocol locally for deterministic offline checks.

## The F1 page

The built page uses one snapshot: observed currency tiles (with full precision
in accessible labels/tooltips), own loot quantity, PvE/Gathering/Fishing summaries,
fame and silver sources, recent loot by actual looter, visited zones and elapsed
time, chest openings, the event feed and the session's file action. Missing
metrics are omitted. Fish quantity excludes seaweed; both remain in the model.
Instance IDs count known dungeon visits without guessing dungeon size. Sources
use the same totals as their tiles. Cards can fold from the keyboard. Six locales
use the existing plural rules, including Ukrainian/Russian few and many.

At 768 × 620, currency tiles wrap in three columns and the unpriced loot quantity
uses a compact full-width row. Activity summaries use two columns, with an odd last
card filling its row. Fame and silver sources remain side by side after the main
columns stack. Each activity card divides its counters into equal-width columns.
New session stays at the right of the header, aligned with its title.
Below 1280, the metadata has its own 20px line with 8px of clear space below the
glowing tab underline; a negative margin must not pull it into the glow. Feed
timestamps take their natural width so the OS's 12-hour format stays on one line.

R5's public price endpoint does not exist yet. Loot/resource/catch item values,
value rates, comparisons, party, journal progress, PvP and other pages wait for their own
slices. Recent loot explicitly says Not priced. Only Session is in the sidebar;
there are no links into unbuilt pages. New session is unavailable after Stop.
Slice 2's observed journal completions appear in the existing activity feed and
are retained by item/index in summaries; an empty journal map does not establish
zero books or zero progress. [Slice 2](slice2.md) records the evidence and limits.

## Proof and checks

`pnpm dev:replay <folder>` runs recorded files through the real tracker/model,
preload and renderer, without packet capture. It uses `.dev-replay-data/`, disables
auto-update and bypasses capture permissions. Replay summaries go under that
isolated data folder's `replays/sessions/`, leaving fixture inputs untouched.
Replay and mock sources cannot upload or forward to the bot (`talksToBot`).

The [scrubbed recording](../test/fixtures/session/README.md) pins every currency
and activity total, including 38 successful fame-audit spans. `pnpm check:replay`
checks the real IPC, page, New session, persisted summaries, Stop, active quit, a
warning even when every new line is refused, and absence of
bot traffic. `pnpm check:layout:v5` adds replay-active, stopped, and New session
states to every width/theme/locale/platform combination; it checks the rendered
raw totals and counts as well as geometry, row packing, narrow activity/source
composition, timestamp wrapping and CSP. `pnpm check:layout` keeps the
old renderer's gate intact.

`ONLY=session OUT=<folder> pnpm exec electron --no-sandbox tools/shell-shots.cjs`
produces built-page screenshots at 1440, 1024 and 768 in both themes, plus stopped
and reset states. The screenshots use scrubbed real data and stub art. Put these
beside the approved local F1/F1r1024/F1r768 boards before release. OS caption
controls are marked stand-ins, not proof of native chrome.

Hardware verification remains: real Mac/Windows capture, engine activity flag,
Stop/quit file flushing, item art cached then offline, and VoiceOver/NVDA. None of
these is asserted by an offscreen renderer. No beta or public release is made by
this slice; the existing beta-pipeline prerequisites remain open.
