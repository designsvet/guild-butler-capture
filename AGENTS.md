# Working notes for agents — Claude Code and Codex

This is Loot Butler, the Guild Butler capture companion. Read `README.md` and the relevant
slice/data docs before changing it. Edit this file; `CLAUDE.md` imports it.

## Data first, approved design faithfully

- Tracking, data correctness and persistence are the first priority. A working data increment
  can be tested before the UI is finished; say exactly what is ready.
- Before implementing an approved screen, follow
  [the implementation flow](docs/design/implementation-flow.md). Inspect its actual source,
  assets, variants and responsive boards. An approved design is the UI contract; do not replace
  it with an approximation assembled from generic components.
- Current owner decisions and the approved reference take precedence over older drawing notes.
  Already approved layouts/assets need no new concept approval. New design directions or
  intentional departures require the owner's choice; corrections to match the reference proceed.
- Map every designed section to proven data or a named dependency. Unknown is not zero. Never
  invent values, charts or relationships to fill a design, and never call a missing icon, bar,
  link or layout rule a data dependency when its data already exists.
- Report **data correctness**, **visual fidelity** and **live-game verification** separately.
  Tests, geometry checks and generated screenshots alone do not prove visual fidelity. Inspect
  the built screen beside the approved reference at each designed size/theme/state before
  declaring it visually complete; update its source/coverage/gaps proof in the same PR.
- Use the [PR checklist](.github/pull_request_template.md). Any unverified required status or
  unresolved design omission keeps the screen partial; communicate that when handing it over.

## Existing boundaries

- Replay and mock capture never upload or forward to the bot. Preserve `talksToBot` and held-upload
  guards. The session model in main is authoritative; renderers do not create a second tally.
- Preserve the default renderer and v5 opt-in. Do not change the package identity or bump the
  version as part of ordinary implementation: a version bump on main publishes an auto-update.
- Retain the CSP and static asset allowlist. Approved packaged art follows
  [its provenance](resources/albion/PROVENANCE.md); dynamic item art uses the restricted official
  service. Exported vendor/runtime code is source material, not app code to execute.
- Use pnpm; every worktree has its own install. Run the checks relevant to the change from
  `README.md`; renderer changes require numerical/replay, old/v5 layout and visual acceptance.
  Documentation-only changes need document/link checks, not a repeated renderer matrix.
- Commits remain signed through the configured 1Password signer; never bypass signing.
  A merge or release requires authorization. Keep unrelated owner changes out of the commit.
