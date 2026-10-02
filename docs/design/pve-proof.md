# PvE — approved F3, built proof

The opt-in v5 PvE page consumes the main-process September 21 session: 40 kills, 29 mob kinds, one
chest and eight visits with PvE events. Full-session currencies retain their original fixed-point
totals. Visit currency amounts include all activities in that interval. No per-mob fame, biggest
kill, chest value/loot, solo/group size or parent zone is inferred.

The approved source is F3 from the [v5 canvas](https://claude.ai/artifact/FbLQ85VeKLddohadcMNqYT),
recovered through its signed-in HTML export on 2026-10-02. Local source:
`~/albion/loot-butler-build/boards/F3.dc.html`, SHA-256
`e4cf429c781287c7be2023f44ccfca68562ec0a7011fd3cab8b4238099eea7e5`. The original ZIP is retained
under that project's `source-exports/` folder. The export runtime, game sprites and portraits are
not part of the app; Q58's Tabler wells are used. These pictures show the built shipping renderer
with scrubbed recorded data and stub OS controls/version, not native capture proof.

| F3 surface         | Implemented                                                                                                     | Data-dependent gap                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Header and metrics | PvE title, Session range, New session, observed currencies and mob count                                        | Today/7 days, Export/Share require later slices; currencies explicitly cover the whole session                            |
| Where it happened  | Chronological PvE visits, observed-content filters, durations, mobs, fame, net silver and chest counts/rarities | Unplaced events have no visit clock or claimed visit count; random UUIDs do not reveal solo/group, party or a parent zone |
| Mobs killed        | Names/tier from the pinned table, complete counts, last location/time, Kills/Recent sorting                     | No per-mob fame linkage, Fame sort or portraits                                                                           |
| Standing out       | Most killed and Last kill                                                                                       | Biggest kill needs per-kill fame                                                                                          |
| Chests opened      | Complete count, latest 61 chest events with rarity, place and time                                              | No item quantity/value is linked to an individual chest                                                                   |

At 1440 the six metrics share a row. Narrower windows have three columns; any partial row spreads
across the available width. At 1024 the side column is 320px and secondary visit/mob fields move
within their row. At 768 × 620 the columns stack; visit content/currencies appear under Where.
Numbers retain precise values in their titles, names wrap and no horizontal scrolling is needed.
Times use the locale's 24-hour clock to avoid crowding adjacent counts.

| Theme                     | 1440 × 900                           | 1024 × 768                           | 768 × 620                           |
| ------------------------- | ------------------------------------ | ------------------------------------ | ----------------------------------- |
| Obsidian — header/visits  | [Proof](pve/obsidian-1440.png)       | [Proof](pve/obsidian-1024.png)       | [Proof](pve/obsidian-768.png)       |
| Parchment — header/visits | [Proof](pve/parchment-1440.png)      | [Proof](pve/parchment-1024.png)      | [Proof](pve/parchment-768.png)      |
| Obsidian — mobs           | [Proof](pve/mobs-obsidian-1440.png)  | [Proof](pve/mobs-obsidian-1024.png)  | [Proof](pve/mobs-obsidian-768.png)  |
| Parchment — mobs          | [Proof](pve/mobs-parchment-1440.png) | [Proof](pve/mobs-parchment-1024.png) | [Proof](pve/mobs-parchment-768.png) |

The narrow side cards after scrolling: [Obsidian](pve/chests-obsidian-768.png),
[Parchment](pve/chests-parchment-768.png).

The layout gate exercises recorded active/stopped/reset states, unknown IDs and chest-only data and
a missing currency, both themes, all six locales, Mac/Windows chrome spacing and 768/1024/1280/1440
widths. It checks complete counts, actual content filtering, mob sort orders, full metric rows,
current navigation and CSP. A journal-only direct PvE route falls back to Session. The real
main/preload replay additionally checks focus, reset navigation and persisted/closed visit clocks.
Native VoiceOver/NVDA and live capture checks remain in [slice 2](../slice2.md).

Regenerate after a build:

```sh
ONLY=pve OUT=<folder> pnpm exec electron --no-sandbox tools/shell-shots.cjs
```
