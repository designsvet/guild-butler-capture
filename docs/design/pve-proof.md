# PvE — approved F3, built proof

Acceptance follows the [approved design implementation flow](implementation-flow.md).

| Readiness | Current evidence / limits |
| --- | --- |
| Data correctness | Recorded counts/visits, real tracker/IPC and summary/reset/Stop checks pass for supported fields; per-mob fame and individual chest value/loot remain unavailable |
| Visual fidelity | Partial: supported F3 sections/native art are built and pictured below; a comprehensive comparison against every approved state is pending, and data-dependent omissions remain explicit |
| Live-game verification | Partial: final native Mac preview shows Summoned Imp in the list and both standouts from its existing real capture, with capture continuing; fresh game traffic, full Mac/Windows capture/flush and assistive-technology evidence remain outstanding |

The opt-in v5 PvE page consumes the main-process September 21 session: 40 kills, 29 mob kinds, one
chest and eight visits with PvE events. Full-session currencies retain their original fixed-point
totals. Visit currency amounts include all activities in that interval. No per-mob fame, biggest
kill, chest value/loot, solo/group size or parent zone is inferred.

The approved source is F3 from the [v5 canvas](https://claude.ai/artifact/FbLQ85VeKLddohadcMNqYT),
recovered through its signed-in HTML export on 2026-10-02. Local source:
`~/albion/loot-butler-build/boards/F3.dc.html`, SHA-256
`e4cf429c781287c7be2023f44ccfca68562ec0a7011fd3cab8b4238099eea7e5`. The original ZIP is retained
under that project's `source-exports/` folder. Exported runtime code is excluded. The eight supplied mob portraits retain their original bytes. Following the owner's broader coverage request, 498 additional exact avatar matches are packaged from a pinned Statistics Analysis Tool revision; the [asset manifest](../../resources/albion/mob-portraits.json) accounts for all 506 portraits and the 80 unavailable avatar identities. Unavailable or failed portraits use the native skull. The supplied currency/chest sprites also render locally; unsupported rarities retain outlines. These pictures show the built shipping renderer
with scrubbed recorded data and stub OS controls/version, not native capture proof.

| F3 surface         | Implemented                                                                                                              | Data-dependent gap                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Header and metrics | PvE title, Session range, New session, distinct currency icons, session-average hourly rates and mob count               | Today/7 days, Export/Share require later slices; currencies explicitly cover the whole session                            |
| Where it happened  | Chronological PvE visits, coloured observed-content filters, durations, mobs, fame, net silver and chest counts/rarities | Unplaced events have no visit clock or claimed visit count; random UUIDs do not reveal solo/group, party or a parent zone |
| Mobs killed        | Names/tier/avatar identity from the pinned table, 506 exact native portraits, complete counts, last location/time, Kills/Recent sorting | No per-mob fame linkage or Fame sort; 80 avatar identities have no exact source artwork and use the native skull |
| Standing out       | Most killed and Last kill                                                                                                | Biggest kill needs per-kill fame                                                                                          |
| Chests opened      | Complete count and rarity strip, distinct chest wells, latest 61 chest events with rarity, place and time                | No item quantity/value is linked to an individual chest                                                                   |

At 1440 the six metrics share a row. Narrower windows have three columns; any partial row spreads
across the available width. At 1024 the side column is 320px and secondary visit/mob fields move
within their row. At 768 × 620 the columns stack; visit content/currencies appear under Where.
Numbers retain precise values in their titles, names wrap and no horizontal scrolling is needed.
Hourly rates use the full session duration and freeze at Stop; no rate is claimed at zero elapsed time.
The rarity strip derives complete counts from visits rather than the bounded recent-chest list.
Fame bars beside mobs remain unavailable: no individual fame gain is linked to a kill.
Times use the locale's 24-hour clock to avoid crowding adjacent counts.

| Theme                     | 1440 × 900                           | 1024 × 768                           | 768 × 620                           |
| ------------------------- | ------------------------------------ | ------------------------------------ | ----------------------------------- |
| Obsidian — header/visits  | [Proof](pve/obsidian-1440.png)       | [Proof](pve/obsidian-1024.png)       | [Proof](pve/obsidian-768.png)       |
| Parchment — header/visits | [Proof](pve/parchment-1440.png)      | [Proof](pve/parchment-1024.png)      | [Proof](pve/parchment-768.png)      |
| Obsidian — mobs           | [Proof](pve/mobs-obsidian-1440.png)  | [Proof](pve/mobs-obsidian-1024.png)  | [Proof](pve/mobs-obsidian-768.png)  |
| Parchment — mobs          | [Proof](pve/mobs-parchment-1440.png) | [Proof](pve/mobs-parchment-1024.png) | [Proof](pve/mobs-parchment-768.png) |

The narrow side cards after scrolling: [Obsidian](pve/chests-obsidian-768.png),
[Parchment](pve/chests-parchment-768.png).

## Broader portrait coverage — 2026-10-03

Portraits are part of slice 2's PvE visual completion, not an unnamed later phase. The 506 packaged
identities cover 5,255 of the pinned table's 5,479 mob entries. The remaining 224 entries share 80
unavailable avatars, listed by exact key in the asset manifest. No guessed faction/family portrait
is assigned. Source, revision, hashes and the private implementation choice are in
[provenance](../../resources/albion/PROVENANCE.md).

The independent owner-recorded Favor-only excerpt contains Summoned Imp (`1833`,
`MORGANADEMONIMP1`). It now uses the same native portrait in Mobs killed, Most killed, Last kill
and Session's feed. F3 specifies frameless 56px mob images and 44px standout images; the previous
implementation put 30px images inside invented square wells. The correction uses F3's image sizes
and 64px/52px minimum row heights, allowing translated names to wrap. The renderer clips the
upstream canvas padding to its central native medallion, giving new portraits the same visible
scale as the supplied F3 files while keeping every original PNG intact. These built scrolled proofs
show that recorded state at each responsive width:

| Theme | 1440 × 900 | 1024 × 768 | 768 × 620 |
| --- | --- | --- | --- |
| Obsidian — Summoned Imp | [Proof](pve/imp-obsidian-1440.png) | [Proof](pve/imp-obsidian-1024.png) | [Proof](pve/imp-obsidian-768.png) |
| Parchment — Summoned Imp | [Proof](pve/imp-parchment-1440.png) | [Proof](pve/imp-parchment-1024.png) | [Proof](pve/imp-parchment-768.png) |

`pnpm check:portraits` decodes every built portrait in Chromium, verifies all 29 recorded mob kinds
against their exact avatar IDs, checks Summoned Imp in PvE/feed, deliberately blocks its image to
prove the skull fallback and verifies recovery in a fresh document. Unit/build checks pin the
allowlist, packaged/source hashes and complete coverage/gap accounting. The recorder, counts and
storage are unchanged. The running native Mac preview was reloaded without resetting or stopping
capture; the existing real Summoned Imp kill renders correctly in all three PvE positions. This
observation does not establish fresh packet ingestion or the outstanding platform/accessibility
checks. Broader PvE readiness remains partial as recorded above.

Final validation: typecheck, 597 unit tests, build, the portrait gate, real main/preload replay,
86 default-renderer layouts and 1,152 affected v5 data-state scenarios pass. Both themes at all
three widths were inspected beside the retained F3 source, including mixed original/new portraits,
standouts and the narrow stacked cards. The approved source specifies the portrait sizes; the
broader shared shell supplies the responsive and Parchment rules. Missing fame bars and the
other whole-screen gaps remain listed above.

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
