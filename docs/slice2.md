# Loot Butler — slice 2, in progress

Scope: PvE, Gathering and Fishing, with journal completions in the engine.
Acceptance remains all three pages on recorded data at 1440, 1024 and 768, in
both themes, with the shell's locale/keyboard/CSP checks. Session remains the
only offered page until those pages are built. This branch is stacked on slice 1;
neither slice is merged or released by this work.

## Design state

PvE's approved board is F3 on the [v5 canvas](https://claude.ai/artifact/FbLQ85VeKLddohadcMNqYT).
The available local exports do not contain F3, and the canvas requires sign-in.
Implementation waits for that source rather than guessing its layout.

Gathering/Fishing have two proposals drawn with the existing `lb.py` vocabulary:
Fgf1 in the local `~/albion/loot-butler-canvas` project ([rendered proposals](design/slice2-proposals.png)). A shares totals above a
haul table, with a secondary summary and journals; B groups resource kinds/catches
into separate blocks. A is recommended. The owner's concept-first rule requires
a choice before building either page. Both proposals use the September 21
recording's observed resources/catches. Prices, best catch by value, partial
journal progress and activity-specific fame have no proven source and are omitted.

## Completed-journal contract

Event 292 is addressed to the current Join id. Parameters 1 and 2 carry the full
book's item index and positive whole quantity. The engine emits:

```json
{"v":1,"t":"journal","at":1789578160537,"char":"Me","zone":"…","item":"T8_JOURNAL_WARRIOR_FULL","index":12055,"qty":1}
```

The decoder rejects missing, zero, fractional, negative or unsafe actor/index/count
fields. Other players' events and an old zone's self id do not count. A missing
item table preserves `UNKNOWN_<index>`; the app keeps its raw index and warning.
The app's strict parser accepts the new kind, the immutable reducer aggregates
`journals` by item/index, New session resets it and Stop retains it in the atomic
summary. Completions also appear in Session's existing localized feed. Journal
names come from the unchanged pinned localization inputs, through the normal
name-table generator (full-book labels only), with the existing English fallback. No currency or fame
gain is inferred from completing a book.

Event 35 is an inventory snapshot, also visible when browsing bank/chest books.
It does not establish ownership or session progress. Across the four inspected
recordings, gathering/fishing snapshots were seen but no corresponding completion packets.
The handler accepts those item IDs through the same contract when observed;
live gathering/fishing completion coverage still needs proof. Missing journal
data is not printed as zero. No payload deduplication is added.

## Evidence and bundle delivery

The engine worktree is based on `designsvet/ao-loot-logger@ab6cc6b` (`protocol18`).
Its journal fixture was produced by the allow-list extractor, then narrowed to
the preceding Join and all six event-292 packets from September 16. The app keeps
only that Join and the first three genuine completion packets; the frozen mapping
and source-table hash are in [test/fixtures/journals](../test/fixtures/journals).
The quantities are `1, 4, 1`: six full crafting books. Two genuine single-book
packets are identical. The old dump contains no Photon sequence metadata;
the later block's resend status is inferred from timing and the surrounding craft.
It is not used as proof of journal sequence deduplication. Existing real-packet
parser tests separately prove live reliable-command filtering; a new instrumented
journal recording remains necessary.

`resources/engine-patches/0002-journal-completions.patch` carries the handler into
both platform CI bundles. CI already applies patches idempotently and refuses
drift. `prepare-engine-dist.mjs` copies a previously patched runtime; it does not
patch the owner checkout. Local assembly must likewise apply patches in an isolated
staging tree first. The new `tools/check-journal-bundle.mjs <engine-dist>` runs the
assembled activity tracker and its real file writer, then parses those bytes
through the app's actual reducer: four lines, three completion packets, six books.
It also refuses malformed/foreign events and visible inventory snapshots.
Both packaging jobs run this gate against `engine-dist` before packaging.

## Verification and remaining work

Engine: the full Node test suite covers completions, ownership, unknown items,
malformed quantities, the real excerpt and the existing sequence filter. App:
typecheck, the full unit suite, build, old/v5 layout gates and replay gate. The
v5 matrix includes an independent journal-only excerpt in every theme, locale,
platform and width, asserting the rendered feed's three events/six books and
absence of inferred fame. It does not combine that excerpt with the September 21
evening. Built journal-feed screenshots extend the [Session proof](design/session-proof.md).
There is no new motion; the established fold/feed behavior is reused.

Remaining: F3 implementation; the selected Gathering/Fishing layout and three-width
proofs; live self-owned gathering/fishing completions and original journal sequence
metadata; Mac/Windows native capture/flush and VoiceOver/NVDA checks. R5 pricing,
partial journal progress, History/export and a beta release remain outside this
increment. Package identity/version and the opt-in v5 flag are unchanged.
