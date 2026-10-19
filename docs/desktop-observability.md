# Desktop usage, health and support

Implemented alongside the server plan in Raid-Bot `docs/plans/2026-10-desktop-observability.md` (19 October 2026). This checkout is an isolated backport based on the public `release/0.8.x` hotfix merge `e060e1b` (v0.8.9), including the pinned October protocol fix. The tested main-branch development implementation remains in the adjacent capture-client tree; this backport contains no v5 renderer or unrelated main changes. The candidate version is 0.8.10 because 0.8.9 has already been published; no 0.8.10 release is published.

## Member experience

The original Capture window offers **Report a bug** in Settings. Reports work without Discord pairing and without enabling analytics. The member enters a category, short summary, what happened, expected result and optional contact. They review the exact report before sending; optional diagnostics contain only enumerated capture/upload/decoder status, safe handler identifiers and bounded running time. They receive a report number. A failed request can retry the same report ID without creating duplicates. Drafts and review snapshots stay in memory, never logs or disk.

Usage and health sharing is **off by default**. A visible first-run choice explains the data and Discord linkage; Settings can enable or disable it later. The original capture app and the new app use the same core and server protocol. Country lookup is unavailable in this release; no location is inferred. No raw log files, player names, paths, loot contents or pairing credentials enter diagnostics.

## Runtime and protocol

- `desktop-identity.json`, separate from existing settings and Discord pairing, stores a random installation ID and an OS-encrypted, 32-byte random secret. Existing corruption does not silently create another counted installation. Secure storage must be available; Linux `basic_text` is refused.
- Registration happens only after opt-in or a manually submitted bug report. Registration and report requests are retryable with stable identity/report IDs. An optional capture token lets the server validate account/server attribution; the client never supplies trusted guild/user IDs.
- The main process owns IPC validation, a bounded cache of reviewed reports and transport. A renderer can submit only an existing preview ID; it cannot add raw diagnostic fields or replace a reviewed payload.
- Thirty-second monotonic samples distinguish app-running and capture-running seconds. Suspend/resume and gaps over 90 seconds exclude sleeping or stalled time. Cumulative session totals with increasing sequences make heartbeat retries safe. One latest pending snapshot replaces older retries; there is no durable telemetry backlog.
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

`pnpm typecheck`, `pnpm test` (268 assertions across 24 suites, including the public October-hotfix guards), and `pnpm build` pass. The dedicated UI acceptance harness is `pnpm exec electron --no-sandbox tools/desktop-support-ui-check.cjs` after a build. It uses an isolated profile, denies HTTP(S), and exercises all six languages and both themes at the released 660×620 content size: visible consent, Settings bounds, diagnostics exclusion/review, failed submission and retry with the same report ID, and a receipt. Screenshots/check results are written under ignored `dist/qa/desktop-support/`.

Hardware staging checks and a production release remain separate rollout steps. Version 0.8.10 allows the existing Windows updater to recognize a newer release than the published 0.8.9. The pinned repaired engine, package identity and updater destination are unchanged. See [the release checklist](releases/0.8.10.md).
