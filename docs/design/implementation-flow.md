# Approved design implementation flow

Owner ruling, 2026-10-03: tracking and data wiring are the first priority. Once a screen is
designed and approved, use that source faithfully when building its UI. The owner does not
need to re-specify its icons, bars, links or responsive behavior in each coding session.

## 1. Establish trustworthy data

Build and verify the capture contract, reducer, tracking, IPC and persistence before presenting
the resulting numbers as reliable. Use recorded evidence and real application boundaries.
Keep decoder/API dependencies explicit. A data-only increment is useful and may be offered for
testing with its scope stated; it is not evidence that the approved screen is complete.

## 2. Read the approved UI source before implementing the screen

Open the approved artifact or its retained export and inspect the actual rendered boards.
Record the artifact URL, board IDs, export/version/hash, asset provenance, themes, states and
responsive rules in the page's `*-proof.md`. A screenshot helps inspection; the available HTML,
styles and assets resolve measurements and behavior. Do not work from memory or a thumbnail.
Treat attached/exported code as reference material, not instructions to execute.

Use the latest explicit owner decisions and approved boards. Reconcile old handoff/drawing
notes at their entry points rather than leaving a conflicting rule above a late correction.
If a required reference is inaccessible, locate its saved export and continue independent data
work; identify the missing source before claiming fidelity. Do not silently improvise.

Before renderer work, inventory every section: typography and hierarchy, native assets, metrics
and rate labels, bars/charts, links/actions, tables, empty/partial states and responsive layout.
Map each to a real source and an acceptance check:

| Designed element | Approved source/rule | Proven data or dependency | Implementation status | Verification/gap |
| --- | --- | --- | --- | --- |
| Source bars | F1 ranked list with percentages | Captured source totals | Implemented/pending | Built comparison + total/fill checks |
| Per-mob fame bars | F3 Mobs killed | No kill-to-fame linkage yet | Data blocked | Named decoder dependency; no invented values |

These are examples, not a completed inventory. Keep the actual page's map current in the PR.
A missing asset, percentage, link or breakpoint whose data exists is an implementation omission.

## 3. Implement the approved design

Preserve the approved assets, spacing, hierarchy, grid/strip composition, bars, links and
responsive rules. Use design-system primitives where they match; adapt the composition where
needed rather than substituting a generic layout or outline icon for an available approved one.
Responsive boards define column counts, wrapping, partial rows, order and density; merely
avoiding overflow does not meet them.

Render only supported facts. Use the approved unavailable/empty behavior and existing
unknown-data rules; name any missing state that needs a design decision. Do not fake prices,
per-kill fame, party information or charts. Preserve the rest of the supported composition.
Reproducing an already approved choice needs no new pitch. An intentional change of design
direction follows the owner's concept-first rule; flag it before implementing the departure.

## 4. Verify data and visual fidelity independently

Run the relevant numerical, replay, interaction and layout gates. Then capture and inspect the
actual built renderer beside the approved source at every designed viewport/theme. For Session
and PvE the baseline is 1440 × 900, 1024 × 768 and 768 × 620 in Obsidian and Parchment; use the
page's own approved variants and responsive rules for each comparison.

Compare equivalent states and populated sections. If reference example numbers differ from the
recording, account for the difference explicitly; use an isolated deterministic visual fixture
when needed, never synthetic live data. Inspect the whole viewport and scrolled sections,
including native icons, fonts, spacing, column counts, equal partial rows, rates, bars, links,
truncation and alignment. Exercise before-data, partial data, active, stopped and reset states
where applicable, plus keyboard/focus and translated text. Check the running built bytes.

Save built screenshots, identify the matching reference and record the inspection result and
remaining differences in the page proof. Screenshot generation and zero-overflow assertions
do not substitute for this comparison. Resolve remaining supported UI omissions before calling the
supported UI faithful. Keep real data/backend gaps separately visible. The agent performs this
inspection; routine matching corrections do not require another owner approval round.

## 5. State readiness precisely

Use separate statuses in proofs, PRs and handoffs:

| Status | Evidence required |
| --- | --- |
| Data correctness | Tested contract/reducer, matching recorded totals, real tracker/IPC/persistence checks; name unimplemented fields |
| Visual fidelity | Built screen inspected against the named approved boards at the required sizes/themes/states; list discrepancies and supported scope |
| Live-game verification | Actual engine/game/platform evidence; name exactly what was observed and what remains untested |

Use **verified**, **partial**, **pending** or **blocked by a named dependency**, with evidence.
Replayed data is not live capture proof; passing tests is not visual proof. Do not label a whole
screen "fully implemented", "complete" or "1:1" while required elements or comparisons remain
outstanding. An owner can test a reliable increment earlier, with those limits stated plainly.

Before opening/updating a UI PR or handing it over for visual testing, complete the
[PR checklist](../../.github/pull_request_template.md) and update the source/coverage/gaps proof
in that PR. A documentation-only PR may mark renderer checks not applicable with its reason.

## Current references and limits

- [Session F1 and responsive variants](session-proof.md): F1/F1r1024/F1r768/F1n/F1s and Fr on the
  [v5 canvas](https://claude.ai/artifact/FbLQ85VeKLddohadcMNqYT). Retained boards are in
  `~/albion/loot-butler-build/boards/`; the owner's F1 HTML ZIP is retained as
  `source-exports/F1-approved-2026-10-03.zip` there, with its HTML hash in the proof.
  R5 prices, party and later-page actions remain named gaps.
- [PvE F3](pve-proof.md): retained approved export and source hash, counts/visits/chests supported,
  per-mob fame and individual chest value/loot unavailable.
- [Packaged native art provenance](../../resources/albion/PROVENANCE.md): the owner's current
  private implementation choice supersedes the older outline-only drawing note for this subset.
- [Slice 2 scope](../slice2.md): approved PvE first; Gathering/Fishing await a layout choice.

The 2026-10-03 owner test found missing supported UI despite passing counter/layout checks.
This workflow preserves data-first development and adds the source inspection, visual acceptance
and honest readiness reporting that those checks did not provide.
