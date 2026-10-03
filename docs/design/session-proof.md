# Session F1 — built proof, 2026-10-03

Built `dist/web/app` at 0.8.8, from the scrubbed 2026-09-21 evening through the
real reducer. Counter acceptance and provenance: [recording](../../test/fixtures/session/README.md).
Architecture and verification: [Session](../session.md).

Acceptance follows the [approved design implementation flow](implementation-flow.md).

Approved source: F1/variants and Fr on the [v5 canvas](https://claude.ai/artifact/FbLQ85VeKLddohadcMNqYT).
The owner's 2026-10-03 F1 ZIP is retained at
`~/albion/loot-butler-build/source-exports/F1-approved-2026-10-03.zip`; its `F1.dc.html` SHA-256 is
`d02ff8143da934b4170ddfa43d74359ee86cf2fbf86a35224314caee66d7bd0f`.
Responsive/state boards remain in that project's `boards/`; native asset hashes are recorded in
[provenance](../../resources/albion/PROVENANCE.md).

| Readiness | Current evidence / limits |
| --- | --- |
| Data correctness | Recorded totals, the Favor-only regression, assembled engine writer and real tracker/IPC/summary/reset/Stop/quit checks pass for supported fields; R5 and other unobserved fields remain unavailable |
| Visual fidelity | Partial: supported icon/rate/bar/link/Fr corrections are built and pictured below; a comprehensive comparison against every approved state is still pending, so the whole screen is not certified complete |
| Live-game verification | Partial: owner confirmed earlier Mac tracking; the final native renderer was reloaded while capture continued and its existing Imp kill renders correctly in PvE. Fresh game traffic, full Mac/Windows flush and assistive-technology evidence remain outstanding |

| Approved board   | Built status                                                                                                                                                                                                       | Remaining gaps                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| F1               | Approved native currency/activity icons, session-average hourly rates, ranked source bars and percentages, content markers, PvE links, loot, chest rarity strip and illustrated feed; New session and journal completions | R5 item values and comparisons; party, journal progress and unbuilt page links; unsupported native portraits/rarities retain fallbacks |
| F1r1024 / F1r768 | Rail; five KPI columns at 1024, three plus two at 768 for five tiles; four fixed activity columns at wide sizes, two below 1280 and side-by-side sources; header metadata clears the tab underline by 8px                                                   | Native Windows/assistive technology verification pending                                                                   |
| F1n              | Before-data face retained after a successful reset                                                                                                                                                                 | History/export/share controls await their slices                                                                           |

The recording contains currencies not present in the board's example: silver and
faction points also get tiles. Loot remains a quantity tile in the same strip while values are unavailable. Wide KPI rows retain five fixed column slots; narrow partial rows spread equally. Rates share the main number’s baseline and wrap when needed, as Fr specifies.
Activity counters divide the card width evenly. Partial activity rows retain four column slots at wide sizes and two below 1280, including captures with only PvE. Their compact headers have no panel divider and use F1’s 13px/15px/14px padding, 14px internal gap and 12px between cards. Rates use the full session duration and freeze at Stop; a zero-duration session has no rate. Source percentages and bars share the same captured total; fill stays neutral and dims by rank. Content squares retain F1/F3 category colours. Chest rarity counts use all visits, including unplaced events, and remain complete beyond the 61-event preview. PvE card and chest links reach the existing page. The feed uses official item art where available, matching supplied mob/chest/currency sprites or outline event icons otherwise, actual gain amounts, places and times.
A dynamic dungeon is called Dungeon: its UUID cannot tell solo from group. The
recorded elapsed evening includes time between the two engine runs. The page
scrolls to retain every observed place; the screenshots below show its different
positions. Item art is a deterministic one-pixel PNG stub in these proofs;
the official protocol/cache has independent tests. Native sprites retain the owner’s F1/F3 export bytes; the broader portrait request adds 498 exact native matches from a pinned source. All 506 portraits render as real packaged bytes; [provenance](../../resources/albion/PROVENANCE.md) records source hashes and the 80 unavailable avatar identities. OS caption controls are marked
stand-ins and the stub's version says v0.0.0.

Slice 2 adds an independent September 16 [journal-feed proof](journals-proof.md).
It contains no observed currency gains: empty currency/activity/source wrappers
are omitted so the first cards align without reserved gaps. This excerpt is not
combined with the September 21 evening below.

## Favor-only regression and layout correction

The owner's 2026-10-03 capture had no faction activity. Its three legacy `faction city:7`
records are Favor currency updates; they no longer enter faction totals or the model feed.
The raw 18-line excerpt and processed-line counters remain intact. Might is 1,362,567 raw
units and Favor 303,320. Positive earned city IDs 1–6 still establish faction; a new session
clears that observation. The older evening below genuinely includes city 4 gains and retains
its corrected Faction tile (64,553,475 raw units). See the [excerpt provenance](../../test/fixtures/currencies/README.md).

Built comparisons on 2026-10-03 inspected both themes at 1440 × 900, 1024 × 768 and 768 × 620,
including the earlier evening's scrolled source/loot/feed/end sections, against the retained F1
HTML and responsive F1r1024/F1r768/Fr rules. Five observed tiles stay on one row at 1440/1024;
768 uses 3 + 2. One/two/three observed activities keep the reference's column widths rather
than expanding to oversized panels, and their native sprites and compact counter/header
composition remain aligned. The narrow source pair and header clearance are retained.

This verifies the corrected grid/header scope. The reference example has priced loot, party,
PvP and more activities than the regression excerpt; those missing data/pages remain listed
above. The correction does not certify the entire F1 as complete, add synthetic live values,
or establish live faction/Windows/assistive-technology coverage. Parchment uses the approved
shared shell skin; the supplied F1/responsive exports are the Obsidian layout reference.

| Theme | 1440 × 900 | 1024 × 768 | 768 × 620 |
| --- | --- | --- | --- |
| Obsidian | [Favor-only](session/favor-only-obsidian-1440.png) | [Favor-only](session/favor-only-obsidian-1024.png) | [Favor-only](session/favor-only-obsidian-768.png) |
| Parchment | [Favor-only](session/favor-only-parchment-1440.png) | [Favor-only](session/favor-only-parchment-1024.png) | [Favor-only](session/favor-only-parchment-768.png) |

Regenerate the regression with `ONLY=favor-only` and the command below.

## Broader mob portraits

The owner's broader portrait request adds exact native artwork for every mob kind in the evening
recording, including Summoned Imp in the independent Favor-only excerpt. The feed retains F1's
compact image well; original export bytes are preserved and imported canvas padding is clipped
to keep the same visible scale. The built three-width, both-theme feed comparisons were inspected
and saved below. Mapping, failed-image fallback and all 506 packaged PNGs are checked in Chromium
by `pnpm check:portraits`; overall readiness remains partial as stated above.

| Theme | 1440 × 900 | 1024 × 768 | 768 × 620 |
| --- | --- | --- | --- |
| Obsidian — Imp feed | [Proof](session/imp-feed-obsidian-1440.png) | [Proof](session/imp-feed-obsidian-1024.png) | [Proof](session/imp-feed-obsidian-768.png) |
| Parchment — Imp feed | [Proof](session/imp-feed-parchment-1440.png) | [Proof](session/imp-feed-parchment-1024.png) | [Proof](session/imp-feed-parchment-768.png) |

Regenerate these with `ONLY=session-imp-feed`.

Regenerate with a build, then:

```sh
ONLY=session OUT=<folder> pnpm exec electron --no-sandbox tools/shell-shots.cjs
```

| Theme | 1440 × 900 | 1024 × 768 | 768 × 620 |
| --- | --- | --- | --- |
| Obsidian | [Proof](session/obsidian-1440.png) | [Proof](session/obsidian-1024.png) | [Proof](session/obsidian-768.png) |
| Parchment | [Proof](session/parchment-1440.png) | [Proof](session/parchment-1024.png) | [Proof](session/parchment-768.png) |

Obsidian, 1440 × 900:

![Session at 1440](session/obsidian-1440.png)

Parchment, 1440 × 900:

![Session in Parchment](session/parchment-1440.png)

Obsidian, 768 × 620:

![Session at 768](session/obsidian-768.png)

Header detail at 768: metadata has its own row below the underline's glow.

![Header at 768](session/header-768.png)

PvE detail at 768: equal-width columns for mobs, chests and instances.

![PvE at 768](session/pve-768.png)

At 1024, the strip keeps five equal tiles on its first row and source cards stay side by side:

![Session at 1024](session/obsidian-1024.png)

Sources and recent loot at 768 × 620, after scrolling:

![Sources at 768](session/sources-768.png)

Recent loot and feed, after scrolling:

![Loot and feed](session/loot-1440.png)

Chests and session summary, at the end:

![Chests and summary](session/end-1440.png)

The 2026-10-03 owner test exposed missing approved UI despite passing counter and overflow gates. The rate, icon, percentage and link gaps were implementation omissions, not decoder dependencies. The renderer gate now checks these details, and the main/preload replay follows the card link with Enter and checks page focus.
