Describe the concrete problem and resulting behavior, including any scope/dependencies left open.

## Evidence and readiness

| Area | Status and evidence / remaining gaps |
| --- | --- |
| Data correctness | |
| Visual fidelity | |
| Live-game verification | |

Use verified, partial, pending or blocked by a named dependency. For an unaffected area, write
not applicable and explain why. Do not claim screen completion from numerical/layout tests alone.

For UI work, follow [the approved design flow](../docs/design/implementation-flow.md):

- [ ] Approved artifact/board IDs and export version/hash are recorded in the page proof.
- [ ] Every designed section is mapped to proven data or a named dependency; supported UI omissions are identified separately.
- [ ] Approved native assets and responsive rules are used; intentional departures have an owner decision.
- [ ] Relevant data, replay, interaction and layout checks pass; test scope/results are stated.
- [ ] Built screenshots were inspected beside the approved reference at each required size/theme/state, including scrolled sections; proof links and discrepancies are recorded.
- [ ] Page coverage/gaps and slice docs are updated in this PR; remaining live/platform checks are explicit.

For changes without UI impact, explain which UI checks are not applicable. Keep release/merge
authorization separate from implementation readiness.
