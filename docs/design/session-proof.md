# Session F1 — built proof, 2026-10-02

Built `dist/web/app` at 0.8.8, from the scrubbed 2026-09-21 evening through the
real reducer. Counter acceptance and provenance: [recording](../../test/fixtures/session/README.md).
Architecture and verification: [Session](../session.md).

| Approved board | Built status | Remaining gaps |
| --- | --- | --- |
| F1 | Observed currency tiles, activity cards, sources, loot, places, chests, feed, New session | R5 item values and comparisons; rates, party, journals and other pages belong to later slices |
| F1r1024 / F1r768 | Rail and responsive columns retained; real data measured at 1024 / 768 | Native Windows/assistive technology verification pending |
| F1n | Before-data face retained after a successful reset | History/export/share controls await their slices |

The recording contains currencies not present in the board's example: silver and
faction points also get tiles. Loot shows a quantity while values are unavailable.
A dynamic dungeon is called Dungeon: its UUID cannot tell solo from group. The
recorded elapsed evening includes time between the two engine runs. The page
scrolls to retain every observed place; the screenshots below show its three
positions. Item art is a deterministic one-pixel PNG stub in these proofs;
the official protocol/cache has independent tests. OS caption controls are marked
stand-ins and the stub's version says v0.0.0.

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

Recent loot and feed, after scrolling:

![Loot and feed](session/loot-1440.png)

Chests and session summary, at the end:

![Chests and summary](session/end-1440.png)
