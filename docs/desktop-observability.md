# Desktop usage, health and support

Implemented alongside the server plan in Raid-Bot `docs/plans/2026-10-desktop-observability.md` (19 October 2026). This checkout is an isolated backport based on the public `release/0.8.x` hotfix merge `e060e1b` (v0.8.9), including the pinned October protocol fix. The tested main-branch development implementation remains in the adjacent capture-client tree; this backport contains no v5 renderer or unrelated main changes. Version 0.8.10 was published for manual production testing as `v0.8.10-test.1`; the stable feed remains 0.8.9. The owner-requested support UI corrections advance the candidate to 0.8.11 without replacing published bytes.

## Member experience

The original Capture window offers **Report a bug** in Settings. Reports work without Discord pairing and without enabling analytics. The member enters a category, short summary, what happened, expected result and optional contact. They review the exact report before sending; optional diagnostics contain only enumerated capture/upload/decoder status, safe handler identifiers and bounded running time. They receive a report number. A failed request can retry the same report ID without creating duplicates. Drafts and review snapshots stay in memory, never logs or disk.

Usage and health sharing is **off by default**. A visible first-run choice explains the data and Discord linkage; Settings can enable or disable it later. The original capture app and the new app use the same core and server protocol. Country lookup is unavailable in this release; no location is inferred. No raw log files, player names, paths, loot contents or pairing credentials enter diagnostics.

## Runtime and protocol

- `desktop-identity.json`, separate from existing settings and Discord pairing, stores a random installation ID and an OS-encrypted, 32-byte random secret. Existing corruption does not silently create another counted installation. Secure storage must be available; Linux `basic_text` is refused.
- Registration happens only after opt-in or a manually submitted bug report. Registration and report requests are retryable with stable identity/report IDs. An optional capture token lets the server validate account/server attribution; the client never supplies trusted guild/user IDs.
- The main process owns IPC validation, a bounded cache of reviewed reports and transport. A renderer can submit only an existing preview ID; it cannot add raw diagnostic fields or replace a reviewed payload.
- Thirty-second monotonic samples distinguish app-running and capture-running seconds. Suspend/resume and gaps over 90 seconds exclude sleeping or stalled time. Cumulative session totals with increasing sequences make heartbeat retries safe. One latest pending snapshot replaces older retries; there is no durable telemetry backlog.
- The legacy paired decoder-health report also requires explicit sharing consent and the production-session guard; declining or disabling sharing keeps local warnings but sends no automatic health report.
- A heartbeat is attempted every minute while opted in. Turning sharing off clears pending telemetry and attempts to record that preference remotely. Capture never waits on telemetry or support. Requests have a ten-second deadline.
- Development builds, mock engines and replay engines do not send telemetry or bug reports. Existing loot upload, settings, captures, pairing and updater identity remain unchanged.

The server routes are `/control/desktop/register`, `/control/desktop/heartbeat` and `/control/desktop/reports`. The schemas are represented in `src/shared/desktopSupport.ts`; the authoritative backend schemas live in Raid-Bot `src/domain/desktopTelemetry.ts`.

## Rollout

1. Deploy the compatible server and Admin → Desktop experience; verify the privacy policy describes optional telemetry, support reports and retention; country lookup remains unavailable.
2. Combine the separate capture-outage fix with this branch after its owner confirms readiness, then test Windows and macOS against staging using an installed build and test identity.
3. Verify classic Settings, consent, unpaired reports, rate limits, retry recovery, suspend/resume, disabled sharing, and upgrade retention on a real machine. Check that a report ID shown to the member is searchable in Admin.
4. Publish only after the owner approves the reviewed build. Preserve `appId`, product name, settings path and release channel for the original app.

Ask members to **update/install the new version over their current app**, not uninstall or delete app data. Current Windows Capture releases already have auto-update: check for updates, stop capturing and restart when ready. macOS still needs the downloaded installer. Older versions without auto-update need the download once. Do not require a clean reinstall unless a specific installation is broken; it can discard pairing/captures or create a second installation identity. Analytics counts opened installations after opt-in, not every download, install attempt, person or historical user.

## Verification in this review branch

`pnpm typecheck`, `pnpm test` (281 assertions across 25 suites, including the public October-hotfix guards and actual legacy health-forwarding consent regressions), and `pnpm build` pass. The dedicated UI acceptance harness is `pnpm exec electron --no-sandbox tools/desktop-support-ui-check.cjs` after a build. It uses an isolated profile, denies HTTP(S), and exercises all six languages and both themes at the released 660×620 content size: visible consent, Settings bounds, diagnostics exclusion/review, failed submission and retry with the same report ID, and a receipt. Screenshots/check results are written under ignored `dist/qa/desktop-support/`.

Hardware staging checks and a production release remain separate rollout steps. Version 0.8.10 allows the existing Windows updater to recognize a newer release than the published 0.8.9. The pinned repaired engine, package identity and updater destination are unchanged. See [the release checklist](releases/0.8.10.md).


## Support UI correction — 19 October 2026

The owner's three screenshots of 0.8.10 and explicit correction request are the visual authority for this iteration: neutral initial focus, primary sharing/report/review actions, a text privacy link, and a compact form built with the installed design system. The implementation reads the actual pinned `@guild-butler/design-system` 0.7.0 controls/surfaces instead of copying its palette or controls.

| Element | Implementation and acceptance |
| --- | --- |
| Consent | Heading receives opening focus; outlined No thanks on the left, gold Share usage on the right; no consent is submitted automatically. |
| Privacy | Real link uses the existing approved external-open bridge. |
| Settings | Kit checkbox and primary Report a bug action; existing capture preferences remain unchanged. |
| Report form | Category/summary and expected/contact share rows, description spans the form, diagnostics stays optional; heading and footer remain outside the scrollable content. |
| Review/send | Gold primary action on the right; Back/Cancel remain secondary; exact preview and stable-ID retry contract retained. |
| Compact sizing | Normal 660×620 form fits without scrolling; short/narrow windows and long report previews can scroll their content without hiding title/actions. |

- Data/interaction: all four TypeScript configurations, 281 tests across 25 suites, the production build and 86 existing classic layout cases pass. The support harness passes 20 scenarios with HTTP(S) denied and an isolated profile. It verifies initial heading focus/Enter, actual keyboard focus rings, primary and auxiliary privacy-link activation, diagnostics omission, review, in-flight Escape protection, stable-ID retry and Close/opener restoration.
- Visual: inspected the actual built consent, Settings, report and receipt surfaces against the owner's requested corrections in Obsidian/Parchment. All six languages at 660×620 fit the initial form without body scrolling. English/German at 660×520 and 390×620 keep title/actions visible while allowing content-only scrolling. The fixture screenshots show synthetic data and do not replace the installed app.
- Delivery: required CI packaging and native Windows installer acceptance are separate gates for the exact release head. Engine, profile formats and updater identity are unchanged. The resulting installers remain a manual production-test release, leaving the stable feed on 0.8.9.
- Live game: Albion pickup, chest and production-guild upload remain pending tester results; this renderer correction does not establish them.
