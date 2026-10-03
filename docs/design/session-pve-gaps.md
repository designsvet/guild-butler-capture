# Session and PvE — remaining approved-design work

Audit: 2026-10-03, renderer head `c833481`. Session and PvE are functional increments, not
completed screens. The next work is to close the omissions below before advancing to another
full page. Existing approved cards and data requirements remain part of the implementation;
their absence is not resolved by assigning them to an unspecified later phase.

## Sources and evidence

- F1: owner's `source-exports/F1-approved-2026-10-03.zip`, member `F1.dc.html`, SHA-256
  `d02ff8143da934b4170ddfa43d74359ee86cf2fbf86a35224314caee66d7bd0f`.
  The loose `boards/F1.dc.html` has SHA-256
  `56af422ec48765d7a8b9a6b09d5644b4ea8d38432787708995ae6b199ebb0949`; its visible text matches,
  but the owner's ZIP is the authoritative F1 export. Responsive scope comes from F1r1024,
  F1r768 and Fr. Files are under `~/albion/loot-butler-build/`.
- F3: retained `boards/F3.dc.html`, SHA-256
  `e4cf429c781287c7be2023f44ccfca68562ec0a7011fd3cab8b4238099eea7e5`.
- Compared against `src/app/SessionData.tsx`, `PvePage.tsx`, `Shell.tsx`, `PageHeader.tsx`,
  `src/shared/session/events.ts`, `model.ts`, `names.ts` and the recorded fixtures.
  Engine evidence comes from the companion worktree's `src/activity/activity.js`,
  `PartyLootItems` handler and packet extractor. Exported scripts were not executed.

"Available" below means captured or derivable with a truthful scope. It does not mean that a
bounded feed can replace a complete aggregate, or that a matching timestamp establishes a
relationship between two events.

## F1 — Session

| Designed element | Missing from the build | Required work |
| --- | --- | --- |
| Header context | Started/elapsed context; party size | Started/elapsed already exist. Party size needs an observed roster. |
| Currency tiles | Fame/Respec last-10-minute gains; Might/Favor session captions | Timestamped gains and totals exist. Add complete rolling aggregation in main/raw replay; the 61-event feed is insufficient. Session captions are renderer work. |
| Loot KPI | Silver plus item value, combined loot total and value/hour | Silver/quantities exist; expose and consume the agreed R5 price service, with explicit unpriced/quality handling. |
| PvP summary card | Fights/last fight, kills, fame, loot taken and Open | Public-API ingestion/session model; valuation for the money field. The full PvP page is a separate destination. |
| PvE summary card | Activity duration/context subtitle | Zone/visit clocks exist, but do not establish exclusive PvE activity time. Establish the duration's meaning before claiming the reference's activity duration. |
| Gathering/Fishing cards | Approved value/fame/journal counters, last time/place context and Open | Prices for value; proven gathering-fame attribution; retain event context; render known full-book completion counts by type. Their destinations remain unbuilt. |
| Items value / Average per item | Entire summary pair, rate, average, item count, above-threshold count, party/yours split | Quantities exist. Prices enable money/ranking; a roster additionally enables the party split. |
| Recently looted / Most valuable | Prices, ranked second column and complete valued-row metadata | Prices plus retained row history. Current recent six/looter/time/quantity is only part of this card. |
| Party | Entire occupancy/leader/roster/weapon/role card and Open | Party/equipment decoding and recorded verification. Nearby looters are not a proven party. |
| Where you've been | Grouping by content, known zone colours and zones/content/elapsed footer | Existing names/content/colour/clocks support these corrections. Camps, fights, bosses and parent/portal context require additional evidence. |
| Chests opened | Total/per-chest values, item counts and boss/run context | Prices and a proven chest-to-loot relationship; some chest-name context is already captured. |
| As it happens | Reference's eight-row preview and Open log; linked fame/context and PvP/death/gear-value rows | Preview count is UI work. The log destination, event attribution, PvP and valuation are separate missing capabilities. |
| Session details | Instance summary and file-type labels; fights/longest fight | Instance/file information exists. Fight boundaries need combat tracking. |
| Today / 7 days / History / Export / Share | Range selection, history query, export and sharing workflows | Saved summaries/raw ranges are a foundation, not these capabilities. Export needs a copy command; Share needs its upload/store/link contract. |
| Links/navigation | Loot, Party, Gathering, Fishing, PvP, DPS, Trades, Crafts and log destinations | Implement their own data/page contracts. Do not present dead controls. Approved F1 summary cards do not require redesigning those cards. |

Observed journal **completions** are already stored by item/index/quantity. Known gathering or
fishing book identities can support completion counters when observed; this is separate from
partial journal progress. Unknown IDs cannot be assigned to an activity. The current journal
recording establishes crafting completions; live gathering/fishing completion proof remains open.

The current 11-column loot CSV has no observed item-quality field. `quality=1` in the image request
is not item-quality evidence. Valuation needs a documented quality policy or richer capture.
The agreed price oracle already exists in the bot; the public cached endpoint and desktop wiring
are unbuilt. A public price read must not imply that private party data needs uploading.

## F3 — PvE

| Designed element | Missing from the build | Required work |
| --- | --- | --- |
| Header summary | PvE visit/content/chest/mob context | Counts/content exist. Use truthful visit-duration wording rather than claiming exclusive combat time. |
| Metric captions | Last-10-minute currency gains; kills/hour and most-killed hint; Might/Favor session captions | Complete rolling gain aggregates; count-based hourly arithmetic and existing totals/mobs. |
| Visit rows/totals | Start–end/now, visible rarity icons/counts, aligned duration/fame/silver/content/rarity footer | Placed visit intervals, captured currencies and complete `visit.rarities` already support these. Unknown clocks/currencies remain unknown. Current tooltip is not the designed visible rarity breakdown. |
| Visit context | Known zone colour; camps/fights, entry zone, solo/group, party/boss details | Known static colours are UI work. Decode and verify additional run/party context; UUIDs and nearby events are insufficient. |
| Mob table | Column headings and faction labels | Existing `mobInfo().faction`, tier, counts, location/time support the headings/labels. |
| Mob fame | Fame column/bars, Fame sort, Biggest kill and fame captions | Establish an explicit kill-to-fame relationship; current emitted kill and fame events are independent. |
| Standouts | Full Most killed count/context and Last kill relative-time captions | Existing counts/last metadata/time support these. Biggest kill remains dependent on fame attribution. |
| Chest heading/context | Approved native purple-chest heading icon; captured name/family context | Packaged artwork exists; current heading uses an outline. Validate captured name tokens rather than inventing a boss kill. |
| Chest grouping | Grouped green chests, place count and complete aggregate context | Rarity/name/zone exist; extend persistent aggregates beyond the latest 61 chest events. |
| Chest items/value | Per-opening quantities, valued rows and total items/value | Preserve source identity and attribution provenance through engine/writer/parser/model; verify the join, then apply prices. |
| Today / 7 days / Export / Share | Same shared capabilities absent on Session | History/range/export/share work, separately from tracking and pricing. |

The emitted kill contract contains only mob index/HP; the fame contract contains independent
gain/total/premium. The app fixture cannot recover individual mob fame. Packet fixtures inspected
so far do not prove a victim identifier, but the extractor omits other packets/fields. This means
**linkage has not been established**, not that Albion can never provide it. Inspect complete
retained packets before deciding what can be attributed.

Chest attribution also includes lost wiring: the engine's `PartyLootItems` already parses a
source object ID and item assignments, but the current CSV and chest activity contract omit the
opening/source identity. Preserve a zone-scoped identity and demonstrate the association with
recorded evidence. Repeated chest names are not unique openings; an assignment may be abandoned
or reassigned. Free-for-all/out-of-party coverage cannot be assumed.

## Work order and acceptance

1. Restore approved details backed by existing data: headings, captions, instance/file labels,
   content grouping, known colours, visit ranges/totals/rarities and the native chest heading.
2. Extend complete temporal/context aggregates: rolling gains, known completion counters,
   activity context and chest group history. Verify them from independent raw recordings.
3. Implement R5 endpoint/desktop valuation and the approved value/average/ranking cards.
   Treat party membership and price availability separately.
4. Establish and verify kill-fame/chest-loot/run/party relationships. Add the dependent cards
   and charts only from those proven facts; record a specific unresolved field if evidence fails.
5. Complete shared History/ranges/Export and the separately planned Share contract; wire
   destinations as their capabilities become available. Then resume additional full pages.

Some cards legitimately disappear in a sparse current session: unobserved currency gains,
harvests, catches, loot, chests and places. That does not explain permanently absent Party,
Most valuable, pricing, attribution or history capabilities. Existing native portrait gaps are
separately enumerated in the [asset manifest](../../resources/albion/mob-portraits.json).

Every row stays open until its data, rendering and acceptance are verified. Update this inventory
with the [Session proof](session-proof.md) and [PvE proof](pve-proof.md); do not call either whole
screen complete from tracking/layout checks alone.
