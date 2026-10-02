# Session F1 — built proof, 2026-10-02

Built `dist/web/app` at 0.8.8, from the scrubbed 2026-09-21 evening through the
real reducer. Counter acceptance and provenance: [recording](../../test/fixtures/session/README.md).
Architecture and verification: [Session](../session.md).

| Approved board | Built status | Remaining gaps |
| --- | --- | --- |
| F1 | Observed currency tiles, activity cards, sources, loot, places, chests, feed, New session; journal completions in the existing feed | R5 item values and comparisons; rates, party, journal progress and other pages belong to later slices |
| F1r1024 / F1r768 | Rail and responsive columns; at 768, two activity columns and side-by-side sources, with rows filling the width; header metadata clears the tab underline by 8px | Native Windows/assistive technology verification pending |
| F1n | Before-data face retained after a successful reset | History/export/share controls await their slices |

The recording contains currencies not present in the board's example: silver and
faction points also get tiles. Loot shows a compact quantity row while values are unavailable.
Activity counters divide the card width evenly rather than packing to the left.
A dynamic dungeon is called Dungeon: its UUID cannot tell solo from group. The
recorded elapsed evening includes time between the two engine runs. The page
scrolls to retain every observed place; the screenshots below show its different
positions. Item art is a deterministic one-pixel PNG stub in these proofs;
the official protocol/cache has independent tests. OS caption controls are marked
stand-ins and the stub's version says v0.0.0.

Slice 2 adds an independent September 16 [journal-feed proof](journals-proof.md).
It contains no observed currency gains: empty currency/activity/source wrappers
are omitted so the first cards align without reserved gaps. This excerpt is not
combined with the September 21 evening below.

Regenerate with a build, then:

```sh
ONLY=session OUT=<folder> pnpm exec electron --no-sandbox tools/shell-shots.cjs
```

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

Sources and recent loot at 768 × 620, after scrolling:

![Sources at 768](session/sources-768.png)

Recent loot and feed, after scrolling:

![Loot and feed](session/loot-1440.png)

Chests and session summary, at the end:

![Chests and summary](session/end-1440.png)
