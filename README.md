# Guild Butler Capture

Desktop app (macOS + Windows) that runs the Albion Online loot logger for
ordinary guild members: a window with Start/Stop, live status, and the log
file one click away — no terminal, no `sudo`, no Node install.

This is the companion client to the Guild Butler Discord bot. The bot ingests
the `loot-events-*.txt` files this app produces (raid-bot ADR 0092); a later
phase uploads them automatically (pairing codes, ADR 0092 P2).

**Status: Phase 1 built; hardware pass in progress.** The stdout contract was
recorded from the real engine on a real Mac on 2026-08-20 (checklist step 1 —
the adapter, the mock engine and the fixtures now carry the recorded shapes).
Still open before handing this to anyone: the engine under Electron's Node
(step 2), the macOS permission fix end-to-end (step 3), and the whole
[Windows half](#hardware-verification-checklist).

## How it fits together

```
guild-butler-capture (this app, GPL-3.0)
   └─ spawns →  ao-loot-logger  (the capture engine — a SEPARATE checkout,
                 branch protocol18 of the madvac fork, GPL-3.0)
                 └─ writes →  loot-events-<timestamp>.txt
                               └─ ingested by → the Guild Butler Discord bot
```

The engine is **not vendored into this repo** and its code is never imported.
The app spawns it as a child process (on Electron's own Node via
`ELECTRON_RUN_AS_NODE`) and reads its stdout/stderr. That boundary is:

- the **licence seam** — engine and app are separate GPL programs; the closed
  bot/service never links either;
- the **crash seam** — a decoder panic restarts the engine (with backoff),
  never the app; game restarts need nothing at all (the engine re-detects);
- the **ABI seam** — the engine's native `cap` module never loads into
  Electron's process. It DOES have to be built for Electron's Node ABI, since
  Electron-as-Node runs it: `pnpm engine:rebuild` (once per Electron upgrade).

Everything that knows what the engine prints lives in ONE file:
`src/main/engineAdapter.ts`. Its patterns are pinned to a REAL session
recorded on 2026-08-20 (see **CONTRACT STATUS** in the file and the verbatim
lines in `test/fixtures/realEngineLines.ts`). When a game patch or engine
update changes the output, re-run the recorder (checklist step 1) and extend
the fixtures — never guess at line shapes.

## Repo layout

```
src/main/       Electron main: supervisor, adapter, trackers, platform probes
src/preload/    the sandboxed IPC bridge (self-contained on purpose)
src/renderer/   the single screen (plain TS/HTML/CSS, no framework)
src/shared/     types, channel names, all user-facing copy (strings.ts)
resources/mac/  the ChmodBPF-style permission helper (plist + scripts)
tools/          mock engine, stdout recorder, static-copy build step
test/           vitest suites — run with no Electron and no game
```

The engine is auto-discovered in either of the two layouts this app lives in
(the locator and every tool here try both; an explicit path always wins):

```
extracted (its own repo):          staged (inside the Raid-Bot repo):
…/ao-loot-logger/                  …/Discord Bot/ao-loot-logger/
…/guild-butler-capture/  ← app    …/Discord Bot/Raid-Bot/guild-butler-capture/  ← app
```

Any other location: Advanced → “Choose engine folder…” in the app.

## Development

Every command runs from INSIDE this folder (while staged, that is
`<raid-bot checkout>/guild-butler-capture` — quote the path if it has spaces).

```sh
pnpm install          # its own workspace — does NOT join the raid-bot install
pnpm test             # vitest: adapter, state machine, supervisor vs mock engine
pnpm typecheck
pnpm dev:mock         # full app against tools/mock-engine.cjs — no game needed
pnpm dev              # real engine (auto-discovered, see above)
pnpm engine:rebuild   # rebuild the engine's natives for Electron's ABI
pnpm package:mac      # unsigned dmg+zip into release/ (Phase 3 signs these)
pnpm package:win      # unsigned nsis installer
```

Working inside a Dropbox/CloudStorage folder: `pnpm install` writes thousands
of small files into `node_modules`, which Dropbox then tries to sync. It
works, but pausing sync during installs (or keeping a checkout outside
Dropbox) avoids the churn.

**macOS keeps the app alive when its window closes** (by design — capture is
meant to survive a closed window; the Dock icon stays). In dev that used to be
a trap: relaunching `pnpm dev:mock` handed the launch to the still-running OLD
process via the single-instance lock — old code behind a fresh-looking window,
silently. Dev launches now skip the lock entirely, so the code you just built
ALWAYS runs, even with a stale instance still around (the first fix — the
stale holder relaunching itself — could never fire: it lived in the very code
the stale process kept from running). The window's version chip shows the
BUILD TIME (`v0.1.0 · built 09:41`); if two windows are up, the one without a
build time — or with an older one — is the stale one: Cmd-Q it. Packaged
builds keep the single-instance front-the-window behaviour.

`pnpm dev:mock` is the fastest way to see every state: the mock engine waits,
“detects Albion”, heartbeats a growing line count as **MockWarrior**, and
writes a real CSV whose rows are pinned by test to the bot's own parser regex.
`--fail=permission|npcap|abi` and `--crash-after=<ms>` flags exercise the
error and auto-restart paths (see `test/engineSupervisor.test.ts`).

## Windows test builds (CI)

The `capture-windows` workflow (in the raid-bot repo while staged) builds an
**unsigned installer with the engine bundled**: it checks out an engine
repo/ref (dispatch inputs; default `madvac/ao-loot-logger@main`), applies
`resources/engine-patches/*` (currently one: flush the log on SIGINT — the
engine's own exit hook only fires from its raw-mode keyboard input, which a
child with ignored stdin never gets), compiles `cap` for this app's Electron
ABI (cap vendors its own WinPcap SDK — no external download), assembles
`engine-dist/` via `tools/prepare-engine-dist.mjs`, and ships it as
`resources/engine` — where the locator finds it and captures into the user's
data folder (the install dir is never written).

For testers, two things to know:

- **The capture driver installs itself from inside the app.** Windows needs
  Npcap, whose licence forbids both bundling it and installing it silently
  (`/S` is an OEM feature) — so the app fetches the installer from npcap.com,
  **verifies its Authenticode signature before running anything**, and
  launches Npcap's own short wizard. One click, one Windows prompt, Next a
  few times. Every failure step has its own message and falls back to the
  manual download. See `src/main/platform/npcapInstall.ts`.
- **SmartScreen will warn** — the build is unsigned (signing is Q16, waiting
  on public launch). “More info → Run anyway” is expected for the guild beta.
- The default engine ref is the owner's pushed branch
  (`designsvet/ao-loot-logger@protocol18`, since 2026-08-20) — full behaviour:
  heartbeat, character display, and his local-patch series. The SIGINT-flush
  patch is generated against that ref; picking another ref via the dispatch
  inputs may need it regenerated (the patch step fails loud, never silently).

### Cutting a release

Releases are cut by **dispatching the `capture-windows` workflow** with a
`release_version` (e.g. `0.2.0`) — Actions → capture-windows → Run workflow.
It records the version in `package.json` on `main`, builds the installer, and
publishes the GitHub Release, creating the tag itself via the release API. No
tag push is involved, which is deliberate: it keeps the whole flow inside
Actions (and this project's git proxy cannot push tags at all). A hand-pushed
`v*` tag still works and takes the same path.

**Licence gate before HANDING a build to anyone:** distributing binaries
triggers the GPL source-offer for the app AND the bundled engine — the public
repo (`designsvet/guild-butler-capture`, owner-decided 2026-08-20) plus the
patched engine fork must be public first. Building and testing it yourself is
fine.

**Distribution, once public:** `v*` tags on the public repo build and publish
a GitHub Release (versioned installer + a stable-named
`GuildButlerCapture-Setup.exe` — that exact name is a contract with the
bot-side download page `app.guild-butler.com/download`, pinned by the bot's
`test/downloadPage.test.ts`). The releases feed is also what P3's
electron-updater will consume.

## Hardware verification checklist

In order, on a real Mac (then the same on Windows). Nothing here is optional —
each step proves an assumption the container build could not.

1. **Record the real stdout contract.** ✔ done 2026-08-20 — the recorded
   lines live in `test/fixtures/realEngineLines.ts` and pin the adapter.
   Findings, so nobody re-checks them: the heartbeat's `lines written` counts
   DATA lines (header excluded — same convention as the file tracker, no
   off-by-one); the log file is announced with its ABSOLUTE path into the
   engine repo root; the pre-zone-change heartbeat carries the phrase
   `not identified yet (change zone once)` in the character field; photon
   `outofboundread` warnings and `[debug]` event dumps are routine noise.
   Still unrecorded: the exact `ALBION NOT DETECTED` line — capture it once by
   running the recorder with the game closed:
   `sudo node tools/record-engine-output.mjs`
   (finds the engine in either layout; pass its folder as an argument if it
   lives elsewhere). Re-record after any engine update.
2. **Engine under Electron's Node.** ✔ verified 2026-08-20:
   `pnpm engine:rebuild` compiled the engine's `cap` for Electron's ABI and
   `pnpm dev` ran the REAL engine inside the app, capturing live game traffic
   with no `sudo` — the two assumptions the whole architecture rests on. (The
   error-card-before-permissions sub-check was covered earlier the same day,
   at length. `GBC_NODE_BIN=$(which node) pnpm dev` remains the fallback if
   Electron-as-Node ever misbehaves; note the rebuild flips the engine's ABI,
   so the raw `sudo node src/index.js` path needs `npm rebuild` in the engine
   folder to work again.)
3. **The macOS permission fix.** ✔ same-session half verified 2026-08-20
   (with the staged installer — it took the TCC staging fix plus the no-lock
   dev launch before the current code ever ran; see the ADR addendum). Still
   pending: capture after a **reboot** (the LaunchDaemon's job — the
   same-session bridge is what worked today, and devfs forgets it at boot).
   Click “Fix capture permissions…”, give the admin password once, Start
   again — capture must work in the SAME login session, and again after a
   reboot. Check `ls -l /dev/bpf*` shows group `access_bpf`.
   The checklist under Start now reports what each attempt did (completed /
   prompt cancelled / failed with the reason / installed-but-still-blocked).
   If it still says the fix is needed, triage in this order:
   - Did **this app's own password dialog** appear and get completed? Dialogs
     from macOS System Settings (Local Network, Screen Recording, …) are a
     different mechanism and do nothing for capture — there is no
     System Settings switch for BPF.
   - Known-and-fixed (2026-08-20): with the app staged inside
     Dropbox/CloudStorage, the privileged run was DENIED reading the installer
     — root does not bypass TCC on File-Provider folders — so every attempt
     failed silently right after the password. The helper files are now staged
     to a temp dir first; if you hit this, pull and rebuild.
   - `ls -l /dev/bpf*` — after a successful fix the first devices are owned by
     you (this session's bridge) and later group `access_bpf` (the daemon).
   - Does `/Library/LaunchDaemons/com.guildbutler.capture.bpf.plist` exist?
     Missing = the installer never completed.
   - The app log has the installer's exact outcome and a `/dev/bpf*` snapshot:
     `~/Library/Application Support/guild-butler-capture/logs/capture-app.log`
     in dev (`Guild Butler Capture` instead once packaged).
4. **The two real failure modes.** Albion closed → Waiting with the hint list
   after ~90 s, never an error. Then start the game mid-session → Capturing by
   itself. Quit the game → back to Waiting, counts kept.
5. **Engine kill resilience.** `kill -9` the engine process — the app must
   show “restarting”, relaunch it, and keep the session count.
6. **Stop flushes.** Stop capture, open the log file — the last pickups must
   be present (SIGINT reached the engine's flush path; if the engine does not
   flush on SIGINT, that's an engine patch to add to its README list).
7. **Reveal + file contents.** Reveal in Finder lands on the current file;
   drop the file into the bot's loot session (officer thread) and confirm it
   parses.
8. **Windows pass.** Npcap absent → the explainer card with the download
   link. Install Npcap (compat mode either way — the app adds the DLL dir to
   the child PATH), leave “restrict to Administrators” OFF → capture works
   without elevation. Then reinstall restricted → the app must say exactly
   that (AdminOnly registry probe).
9. **VPN reality check.** Turn on a VPN (or ExitLag) — traffic goes dark; the
   Waiting hints must be the story the member sees. GeForce Now: same.

## Permissions, in plain terms

- **macOS** — capturing needs `/dev/bpf*`, which ships root-only (why the raw
  script needed `sudo`). The one-time fix (admin password prompt) installs,
  Wireshark-ChmodBPF-style: an `access_bpf` group with you in it, a
  LaunchDaemon (`/Library/LaunchDaemons/com.guildbutler.capture.bpf.plist`)
  that re-relaxes the devices to that group at every boot, plus a same-session
  bridge so it works immediately. Capture stays group-scoped, never
  world-readable. Remove it all with:
  `sudo launchctl bootout system/com.guildbutler.capture.bpf;`
  `sudo rm /Library/LaunchDaemons/com.guildbutler.capture.bpf.plist;`
  `sudo rm -r "/Library/Application Support/Guild Butler Capture"`.
- **Windows** — capturing needs [Npcap](https://npcap.com). Its OEM
  redistribution licence is paid, so the app links to the official installer
  instead of bundling it. The installer's “Restrict Npcap driver's access to
  Administrators only” option must stay UNCHECKED, or the app will tell the
  member to reinstall (or run elevated).
- **Neither platform** can capture inside a VPN/tunnel or on cloud gaming —
  the app says so instead of logging nothing.

## What members should expect it to see

Measured against live traffic 2026-08-19 (the engine's `README-mac.md` is the
source; the app must not promise more):

- Loot from **corpses and mob bags**: attributed to everyone nearby, in or out
  of party, across guilds. The main value; works.
- **Your own** chest pickups: logged with the chest's real name.
- **Other players'** chest pickups: only under party loot-distribution mode;
  free-for-all attributes nobody, and a looter outside your party is never
  attributed. Game-server limit, not a bug.
- Guild vault / territory chests: covered by the game's own chest-log export,
  which the bot ingests separately.

## Phases

- **P1 (this)** — window, status, start/stop, permissions UX, errors. ✔ built
- **P2** — pairing code from Discord → per-guild token → auto-upload of
  captured lines. Needs the bot-side ingest endpoint (raid-bot ADR 0092 P2);
  the bot repo owns that half.
- **P3** — signed installers (Apple Developer ID exists; Windows cert is an
  open question), auto-update via electron-builder/electron-updater, engine
  bundled into resources. Auto-update is the real prize: when a game patch
  renumbers the event codes, one push fixes every member. (When capture
  breaks: re-derive event codes from Triky313/AlbionOnline-StatisticsAnalysis
  `EventCodes.cs`, per the engine README.)

## Licence

GPL-3.0-only (see `LICENSE`) — this app is open source, like the engine it
drives; the Guild Butler bot and service stay separate and closed. The folder
is staged inside the private raid-bot repo for review only: **extract to its
own repository before distributing any build**, because distributing binaries
is what triggers the GPL's source-offer obligation, and the owner decides
when/where that public repo appears.

## Provenance

Extracted from the private staging tree (raid-bot@53f7c05d1fff) as a
fresh history — the app was developed there alongside the closed Guild Butler
bot; see its ADR 0096. The bundled capture engine is the separate GPL project
[designsvet/ao-loot-logger](https://github.com/designsvet/ao-loot-logger)
(branch `protocol18`), spawned as a child process, never linked.
