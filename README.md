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
src/app/        the v5 shell preview (React + Tailwind, behind a flag — see "The v5 shell (preview)")
src/shared/     types, channel names, all user-facing copy (strings.ts)
resources/mac/  the ChmodBPF-style permission helper (plist + scripts)
tools/          mock engine, stdout recorder, static-copy build step (+ design-system CSS), v5 shell build, shots + layout check
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

## Languages & appearance

The app speaks the bot's six languages — English, Українська, Русский,
Deutsch, Français, Português — and follows the **operating system's** language
by default: `detectLang` reads the OS locale and anything unrecognised falls
back to English. The gear popover carries a picker whose default, "System", is
exactly that detection — choosing a language stores it in `settings.json` and
re-renders live, quit dialog included. Catalogs live in
`src/shared/strings.ts`, where every language is type-checked against the
English shape, so a missing key anywhere is a compile error rather than a
runtime fallback. Same provenance caveat as the bot: EN and UK are written
with care, the rest are machine-quality and welcome a native proofread.

The screen itself is the Guild Butler design system, **installed, not copied**:
`@guild-butler/design-system` (ADR 0145 in the Raid-Bot repo), pinned to an
exact version in `package.json`. The renderer is sandboxed with no bundler and
a `style-src 'self'` CSP, so it cannot import from `node_modules`; instead
`tools/build-static.mjs` copies the stylesheets that `index.html` links from
`./ds/` — today `tokens.css`, then `surfaces.css` — out of the package and
beside the page. `styles.css` loads after them and declares only what the
package does not: the title bar, the ember Stop, the log rain, the motion
timings. `test/designSystem.test.ts` fails if a package token is copied back
into `styles.css`, if a retired one comes back, if the links fall out of order,
or if the build stops shipping what the page links. Taking a new package
version is a change to the pin, then `pnpm install` and `pnpm test`. (The
package's `base.css` and `controls.css` are not linked yet — the app's own
buttons and switches move to the kit's controls in a later step.)

Surfaces follow the package's five heights (ADR 0150): cards are `.gb-card`,
readings and fields sit in wells, and the four things that open over the page
— the gear popover, the language menu, the pairing details and the waiting
reasons — are vellum (`.gb-overlay`: translucent, blurred, a real 1px border).
The gear popover is a *host* (`.gb-overlay--host`) because the language menu
opens inside it, and Chrome will not blur a backdrop inside another backdrop.
Lines are neutral, status is never a coloured bar, gold text uses
`--gb-gold-text`, and focus is the kit's steel ring.

The three brand fonts are **bundled** as woff2 subsets (latin + latin-ext +
cyrillic, OFL licences beside the files in `src/renderer/fonts/`). Bundled
rather than fetched because the CSP forbids remote anything and a capture tool
must render identically offline. The package's font tokens name newer faces
(Rubik, Onest, IBM Plex Mono) that arrive with the design system's step P6;
until then `styles.css` points those three tokens at the bundled faces.

Two window looks, named like the kill-card grounds: **Obsidian** (dark, the
default) and **Parchment** — preview tiles in the gear popover, stored as
`settings.json` `theme` (`"obsidian"` / `"parchment"`). The page wears the
package's attribute for them, `<html data-theme="dark">` or `"light"`. The
whole palette is CSS tokens, so the layout never forks; on Windows the overlay
window-controls retint with the theme. The
window itself is **frameless with the OS chrome merged in**: the 48px header
is the drag region, macOS keeps its traffic lights over it (`hiddenInset`),
Windows gets overlay controls, and the window is ONE fixed size in every
state — the greeting zone flexes instead of the frame. While capturing, the
greeting sits over the **log rain**: a canvas of loot lines drifting at ~12
fps, paused on blur/hidden, disabled under reduced-motion, and only ever
drawn during a live session.

### Uploads recover from a refusal

If the bot refuses a batch — most often because the batch was too big for the
route in an alphabet where characters and bytes are not the same number — the
app now **halves what it sends and tries again**, all the way down to a single
line. Only when one line on its own is still refused does it stop and say so.

Before v0.6.2 the first refusal parked the uploader for the rest of the session:
it kept capturing to the log file, uploaded nothing, and the only sign was one
line in the app. A member could finish a whole raid that way and lose it.

Batches are also packed by **encoded bytes** rather than character count, so a
Russian or Ukrainian capture is bounded the same way an English one is.

## How it moves

The four states — idle, starting, waiting, capturing — are one continuous
run, and the interface treats them that way. One rule holds it up: **nothing
in the greeting may change the layout.** Every slot is reserved at its worst
case across all six languages, so a state change can only alter ink, colour,
glow and small motion; measured at the real window size, the Start button and
every line above it sit on the identical pixel in all four states.

On top of that geometry: text changes by **rolling** (out upward in 170ms, in
from below over 260ms) with each element starting 50ms after the one before
it, so a state change reads as one thing causing the next rather than as a
simultaneous flash. The status dot is the instrument — a ring sweeping while
the engine starts, a radar ping while it listens, breathing green once
traffic lands, and one pulse per pickup. The Start/Stop pill is two stacked
surfaces rather than two buttons: the ember face sits underneath and the gold
**drains off it** over 440ms, retracing on the way back. Reaching Capturing
plays a **wave** — a brightness-and-scale pulse passing up through dot, name,
count, caption and chips — which brightens what is already there and hides
nothing. Under `prefers-reduced-motion` every duration collapses to zero and
the end states are unchanged.

The reasoning, the measurements it came from and a playable before/after are
in [`docs/design-transition-study.html`](docs/design-transition-study.html) —
open it in a browser, no build step.

**The waiting hints obey the same rule** (fixed 2026-08-30). They used to be
four list items injected straight into that greeting, which is `flex: 1`,
centred and `overflow: hidden` inside a window that cannot be resized — so the
stack outgrew its container and the whole thing **clipped at both ends**: the
status line off the top, the Start button off the bottom, the pairing bar over
what was left. It read as a styling bug and it was an arithmetic one; the block
had simply never been given a reserved slot like everything else in the
greeting. Now the greeting carries **one line at a fixed height** — *Nothing
after a few minutes?* — and the three reasons open as an overlay above it,
anchored to the bottom of the greeting so the Start/Stop pill stays reachable
(one of the reasons is "turn your VPN off", which you act on by pressing Stop).
Verified by driving the renderer at the real 660×620 in all six languages: the
status chip and the button land on the same pixel in every language, open or
closed.

**So does the pairing card** (fixed in 0.8.8). Not yet paired, it used to hold
the whole two-step setup inline — 114–137px taller than the connected row —
and the window did not have that room: in every not-paired state, in all six
languages, the status line went off the top and the Start button slid under the
card. It shipped in 0.8.5, 0.8.6 and 0.8.7 because nothing measured the states
nobody happened to open. The not-paired face is now **one row**, like the
connected one (*Send loot to your guild* · the one-line pitch · **Pair with
Discord**), and the two steps open as an overlay above it. The connected face's
details overlay was trimmed in the same change: it sat 9px over the Stop pill.

**`pnpm check:layout` measures all of it** (`tools/layout-check.cjs`, in CI
under xvfb): the built renderer at 660×620 behind a stub bridge, six languages
× five capture states × paired or not, plus every overlay opened — about 90
windows, failing on anything cut by the greeting's edges, the pill under the
card, an overlay over the pill or under the title bar, or a clamped pitch.
`OUT=<dir> pnpm check:layout` also writes a PNG of each, the quickest way to
look at every state at once.

**Capture starts by itself when the app opens** (default on — the app exists
to be forgotten about; open it, play). The toggle in the gear popover turns
that off, persisted in `settings.json` as `autoCapture`. Auto-start goes
through exactly the button's code path, so a machine with permissions missing
lands on the fix card — which on a first run is the right first thing to see.
The popover also carries a manual **Check for updates** — the backup to
auto-update; where the updater is off (unsigned mac, dev builds) it opens the
download page instead.

## Development

Every command runs from INSIDE this folder (while staged, that is
`<raid-bot checkout>/guild-butler-capture` — quote the path if it has spaces).

```sh
pnpm install          # its own workspace — does NOT join the raid-bot install
pnpm test             # vitest: adapter, state machine, supervisor vs mock engine
pnpm typecheck
pnpm check:layout     # every state at 660x620 in the built renderer (see "How it moves")
pnpm check:layout:v5  # the v5 shell at every width, theme, language and state (see "The v5 shell")
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
`GBC_MOCK_BROKEN_AFTER=5000 pnpm dev:mock` makes the mock report a broken
decoder after five seconds, which puts up the "A game update broke loot
logging" card (below).

## The v5 shell (preview)

**Try it:** `pnpm dev:v5`. It builds, then opens the new shell with the mock engine in a throwaway
data folder of its own (`.dev-v5-data/`, git-ignored) — never the installed app's, so your settings,
pairing and captures are not touched and nothing reaches your guild's bot. `pnpm dev:v5 -- --real`
runs the real engine instead (it needs the capture permission, as the app does); `-- --fresh` forgets
the throwaway folder first, for a first open. The mock engine never talks to the bot in any mode
(`src/main/botFacing.ts`): before this, `pnpm dev:mock` on a paired computer uploaded its invented
loot as the member's.

**Loot Butler**, the dashboard this app is being rebuilt into (raid-bot ADR 0159), is built
beside the old window in `src/app/`, and nothing reaches it by accident: the old window stays the
default, and 0.8.x ships it unchanged.

**Opening it.** `GBC_SHELL=v5 pnpm dev` (or `pnpm dev:mock`), or `"shell": "v5"` in
`settings.json` in the app's data folder. Any other value opens the old window. Picking a theme or
a language keeps the stored flag (`test/settings.test.ts`).

**How it is built.** `pnpm build` runs `tools/build-app.mjs` after the old window's build, into
`dist/web/app/`:

- esbuild bundles `src/app/main.tsx`, React included, into `main.js`;
- PostCSS builds `app.css`: postcss-import inlines the design system's `tokens.css`, `base.css`,
  `controls.css` and `surfaces.css` with Tailwind's layers between them, in the order `app.css`
  lists, and Tailwind 3 writes the utilities from the package's preset (`tailwind.config.mjs`).
  The build fails if an `@import` survives or is skipped;
- the package's `fonts/` directory is copied whole, its four OFL licence texts with it, and the
  crest is `resources/icons/crest-mark.png`.

The page keeps the old window's content-security policy word for word. `pnpm typecheck` covers it
(`tsconfig.app.json`). `test/appDesignSystem.test.ts` builds it into a temp dir and checks that no
`@import` is left, that the package's sheets arrive whole and in order (Tailwind's preflight before
`controls.css`), that no package token is declared again, that the app's own variables are all
`--lb-*`, that a colour is written out only as an `--lb-*` value no package token already holds in
that theme, and that the faces are the package's files, byte for byte, with their licences beside
them.

**What is in it.** The shell around one page, drawn from the canvas's boards (page v5): Fh1 for the
title bar, Fh2 for the sidebar's foot and the guild connection's panel, Fh3 and Fh7 for Session, Fh4 and Fh5 for the notices, Fh6
(option C) and F1s for the settings drawer, F1 and Fr for the frame, Fa for the keyboard and the
screen reader.

- **The title bar** says the capture's state in the app's own words, with a dot beside them: while
  capturing, the character and how long (`Bors · capturing 1 h 20 min`), or `Capturing · detecting…`
  before Albion names them; `Waiting for Albion… · listening for 40 s`; `Starting the logger…`; the
  restart and when it comes; `Stopping…`; `Not capturing`; `Something needs fixing` in the danger
  red — the dot is red then and only then: when capture is blocked, which the setup probe can know
  while idle (no engine, no permission, no Npcap) as well as the error state. Then its one button —
  Stop (dimmed and refusing the press while the logger starts or stops, with a sheen crossing it),
  Start capture in gold when idle, a neutral Start whenever the band below holds the next step
  (capture blocked, or a notice carrying the gold fix: one gold button per window) — the version,
  and the gear, which opens the settings (below) and shows itself pressed while they are open. The
  button changes face the way the old window's pill does (below).
  Below 1024px it keeps the name and the time and drops the version. The guild and the zone are not
  drawn: the app does not know them yet.
- **The sidebar** lists only the pages that exist — Session, under Live — 208px with labels from
  1280px up, the 60px rail of icons below, each label then a tooltip on hover and on focus. The page
  you are on wears the chosen wash and an icon that draws itself once on arrival (lit at once under
  reduced motion). Its foot shows the guild connection: `Connect a guild` and where sessions stay
  when unpaired, else the device's name and a short form of the upload state (`312 lines sent · 1 min
  ago`, `Sending…`, `Couldn't send — retrying`, `Auto-send off`, …, and `Held until the update` in
  amber while a broken decoder holds the upload — below). The foot is one button over both lines,
  the door to the guild connection's panel (below): the neutral wash under the pointer, the pressed
  wash while the panel is open; in the rail it is the 44 × 28 target around the dot.
- **The page header** is the range tabs where a title would be — only Session so far, since Today
  and 7 days need History — with a light running along its underline while capturing, and the meta
  line (`Listening since 14:33`, `Started 14:33 · 1 h 20 min`) beside it, or under it below 1280px.
- **Session before data**: a card for the capture's state (the waiting reasons join it after 90 s
  of waiting, as in the old window), what will appear here, and at the right a guild to connect
  (Pair with Discord opens the panel the foot opens, and shows itself pressed while it is open),
  the data folder (Open folder is the old window's Reveal) and
  the auto-start switch (the stored setting, as in the old window). From 1280px the right column is
  400px, at 1024 it is 320, below that it moves under the page.
- **The notices** (Fh5): one slot at the top of every page, above the header — the band — one notice
  at a time, the most blocking first: capture is blocked › a game update broke the decoder › the
  logger keeps stopping › an update is ready (`src/shared/notices.ts`). Each is an ordinary card —
  its weight is the icon, its title's colour and its one action — in the old window's own words,
  wired to what the old window's buttons do: Fix capture permissions… (and what happened, under it,
  when the password prompt was closed), Install capture driver (dimmed while it fetches, with the
  old window's notes) and Download it myself (the Npcap page, in the browser), Choose engine folder…,
  no button for a rebuild; for the broken decoder `healthCard()`'s step — Stop capture and update,
  Update now, Check for the fix, Get the update — with the held line and the engine's own verdict in
  mono; for an update that is ready, Restart and update, or, while capturing, the same Stop capture
  and update (stop, then install once the engine is down — main refuses to cut a live capture, and
  the notice says so if it still does). "The logger keeps stopping" is a new rule: from the third
  restart in a row, until a relaunched run proves healthy by the supervisor's own test (it sees
  Albion or lives a minute — `HEALTHY_RUN_MS`, now shared), so the band does not come and go with
  each short run. Only a break that reaches the loot log puts the decoder's notice up: a broken
  festivity or energy reader makes no loot wrong. Below 1024 the words take the card's width and the
  action goes under them. The band is not a live region: its title is spoken once, through the
  page's one polite region, when a notice arrives (a notice that read itself out would read the
  fix's download percent out on every tick).
- **The broken decoder's dialog** (Fh4, option D): it interrupts once when the break is found and
  again when the fix has downloaded (each its own event; the window keeps the ones it was given
  "Later" for). "Later" closes the dialog, never the notice — which is in the band under it from the
  first moment, so nothing on the page moves when it closes. It is the package's dialog and scrim
  under the title bar; the rest of the window is inert, Tab stays inside, Escape is "Later" — even
  after a click on the scrim has left the focus outside it (the keys are heard on the document) —
  the focus starts on "Later" (the other button stops a capture) and goes back where it was.
- **The settings** (Fh6, option C — the floating drawer of F1s; `src/app/SettingsDrawer.tsx`, its
  words and its menu's place pure in `src/app/settings.ts`): the gear opens a drawer at the right,
  the package's drawer — 440px, 16px in from the window's edges under the title bar, the dialog's
  opaque surface over the one scrim — so the page stays in view beside it and a new theme or
  language is seen as it lands. It slides in over 300ms, decelerating, and leaves on the package's
  quicker, accelerating exit; under reduced motion it fades in and out instead. Its body scrolls
  when the window is shorter than its settings. What it holds is the old window's gear popover, in
  its words and wired to the same bridge calls, plus the folder the logs go to:
  - **Capture**: the auto-start switch (the same stored setting as Session's).
  - **Appearance**: the theme as two tiles, each a small window drawn in its own theme's colours
    (the picture carries the package's `data-theme`, so its tokens are that theme's whatever the
    page wears); the chosen one wears the chosen wash, the gold outline, its name in gold and a
    check. The language as the kit's dropdown, not a native select: a well with the choice and a
    chevron, and a vellum menu — System, then each language in itself — fixed to the window over
    the drawer, inside its edges, below its button or above it when there is more room (it opens
    upward in the smallest window); the arrows, Home, End and a typed letter move through it, Enter
    or a click picks, Escape closes the menu alone. Both apply at once, then keep what main stored.
  - **Updates**: the version and how the updater stands, in the old popover's sentences (a Mac's
    "Auto-update is off in this build — this opens the download page."), and Check for updates —
    which, where the app cannot update itself, opens the download page, as before. The beta channel
    the board draws is not built: it needs the release pipeline first.
  - **Files**: the folder the engine writes its logs into and Open folder (the old window's Reveal).
    The setup probe now names that folder (`captureDir`, the engine's working folder:
    `<data folder>/captures` for the bundled engine); the old window does not read it.
  - **Advanced — engine**: the engine's folder, or the old window's "not found" sentence, and Choose
    engine folder….
  - **About**: the version, the engine's credit, and the privacy policy as a link that main opens
    in the browser.
  A folder's path is shown whole, in mono, breaking only between folders — never at a hyphen in
  `guild-butler-capture` — with the whole path in its title. Modal (board Fa): the rest of the
  window is inert, Tab stays inside, Escape closes it — heard on the document, so a click on its
  words does not strand the keys — and so does a press outside it; the focus starts on Close and
  goes back to the gear. The broken decoder's dialog can still interrupt it: the drawer is inert
  under the dialog, and "Later" gives it its focus back.
- **The guild connection's panel** (Fh2, "What opens from it"; `src/app/ConnectionPanel.tsx`, its
  words and its place pure in `src/app/connection.ts`): the package's vellum overlay, 348px, opening
  upward from the sidebar's foot over the page — 8px above the foot's rule, 8px in from its edge,
  never under the title bar (fixed to the window and placed from the foot through the CSSOM, so
  nothing in the page holds or cuts it; it would scroll only in a window shorter than the smallest).
  The foot opens it and so does Session's Pair with Discord; it is the same panel. What it says is
  the old window's pairing block, in its words and wired to the same bridge calls:
  - **Not connected**: "Send loot to your guild" and the old pitch, then the two steps — run
    `/capture pair` in the guild's Discord (beside a button that copies it, `copyText`, and says
    "Copied!" for a moment), then type the code the bot replies with and Pair (`pair`). Pair waits
    for a code; while main checks one it says "Connecting…" and refuses a second press, keeping the
    focus (`aria-disabled`); Enter in the field presses it. A code of the wrong shape is main's to
    refuse, at once and with no round trip, in the old window's "That code doesn't look right" sentence — so
    Pair waits only for the field to hold something. Pair is the kit's filled steel button
    (`<Button variant="share">`, `gbtn-share`) in every state, not the gold Fh2 draws — the owner's
    ruling (2026-10-02): in the kit steel means shared, and pairing is what shares a member's loot
    with the guild. With no code typed it wears the kit's own disabled look. So the panel takes no
    gold: the bar's Start capture keeps the window's one gold button while it is open — or, under a
    band whose fix is gold, the fix holds it and Start steps back to its neutral face, as it always
    does there — and Pair is steel under a band too. Under a line, the board's "No guild on Guild
    Butler? Everything here works without one." (the panel's one new string).
  - **A refused code**: the old window's sentence for that `EPairFailure` — every one of the seven —
    under the field in Stop's red, the field marked invalid and described by it, the code left in
    it, and the sentence read out once through the page's one polite region. A try forgets the last
    refusal, and so does the panel closing.
  - **Connected**: "Connected as …" (the device's name alone once Discord has disconnected it — a
    title that says "Connected" over "Disconnected in Discord" would contradict itself), the
    upload's state beside its dot as the foot says it, and, where there is more to say, the old
    window's whole sentence under it ("…Your log file is safe."; "Held until the update" over why);
    the "Send loot automatically" switch (`setUpload`, drawn at once, then what main stored); View
    my loot as a link — a real address, which main now hands over with the pairing (`lootUrl`, built
    by `lootPageUrl` in `src/shared/pairing.ts`, the same function main's own `openLoot` opens) — that
    main opens in the browser (`openLoot`; the window never navigates); and Disconnect this computer
    (`unpair`), after which the panel shows the steps.
  A popover, not a modal (board Fa): the page stays live around it. It opens onto the code field
  (what the member comes back from Discord with, as the old window's steps do) or, connected, onto
  itself (the first control there is a switch a stray Space would turn off); when a code is accepted
  or the computer disconnected, the control that held the focus is gone, so the panel takes it.
  Escape closes it and gives the focus back to the door it came from (the foot, if Session's button
  has gone since); a press outside it closes it, and so does the focus leaving it — none of them,
  nor its doors, while a code is being checked, since the answer lands in it. A dialog or the
  settings drawer over the window suspends it. Under Windows' high contrast the open door keeps an
  outline in the system's Highlight.
- **The held upload** (main process, `src/main/uploader.ts`; ADR 0159's amendment of 2026-10-01):
  while the decoder is broken where loot is concerned (`lootBroken` in `src/shared/engineHealth.ts`:
  any broken handler but the eleven that feed no loot — the rotation and energy readers, and the six
  player-trade handlers of designsvet/ao-loot-logger#20 — an unknown one counts as feeding it, the
  safe mistake), the uploader sends nothing, and what the engine writes meanwhile is never sent. Every
  pass records where the hold began in the file it would read — from where the uploader stood, so
  the lines written between the break and the verdict go too — as a range (file, first line, the
  run those before it went under) in `held-uploads.json` in the data folder, written temp-then-
  rename, never over an unreadable one. Every pass, held or not, sends a file only up to its hold,
  and resumes a held file's run at the hold, so the app that restarts into the fix sends none of it
  and nothing twice; the fixed engine's own files go whole. It is recorded even unpaired or
  switched off, a verdict landing mid-pass stops what that pass read, and a device that needs
  pairing again still says so. Behind the v5 flag, as everything new is: the old window has no words
  for a hold. Tested in `test/uploader.test.ts` and `test/heldUploads.test.ts`.
- **The trade upload** (main process; raid-bot ADR 0168, Q69 — "a captured player trade moves the
  loot debt"): the engine (designsvet/ao-loot-logger#20) writes one JSON line per FINISHED
  player-to-player trade into `trade-events-<stamp>.jsonl` beside the loot log, when its child
  environment has `TRADE_EVENTS=1`. The app sets that only under the v5 flag — and removes it
  otherwise, so a shell that exports it cannot make the old window's engine write partner names
  into a file nothing reads (`withTradeEvents`, `src/main/tradeUpload.ts`). Under the same flag, and
  behind the same mock/replay guard as the loot loop (`src/main/botFacing.ts`), a second uploader
  follows that file — found by the loot log's name, the engine's own rule — with the loot
  uploader's machinery (`src/main/uploader.ts`, one `TUploadStream` each): a run per file, the
  cursor on each line's index in the file, the batch caps, the backoff, the hold. What may leave is
  decided line by line in `src/main/tradeLines.ts`: only lines a newline has closed (a line the
  engine is still writing waits); only record v1 exactly — every key, top level and nested, on an
  allow-list and in the engine's order, so a crafter, an object id, durability or any key a later
  engine adds withholds the line, counted and logged by reason, never by content; checked on the
  text that is sent, not only on its parse — the line must be exactly what `JSON.stringify` makes of
  its own parse, as every engine line is, so a repeated key (whose first copy a parse drops but the
  text still carries) or padding withholds it; never a silver-only trade (`gave` and `got` both
  empty); the silver that comes back in an ITEM trade does go, with its line (owner, 2026-10-05);
  and a partner the game hid stays `{name: null, guild: null, hidden: true}` — a hidden partner with
  a name in it is withheld. A withheld line keeps its index: a batch is a run of consecutive
  sendable lines, so the bot's `(run, line)` key never shifts and the bot never learns a withheld
  line was there. Allowed lines go as the engine wrote them, byte for byte, to
  `POST /control/capture/trades` with `/upload`'s body (`{run, file, from, lines}`) and the device
  token. **Only this session's journal:** a new capture session follows nothing until its own
  engine has named its loot log (`tradeFileThisSession`) — main still names the last session's log
  until then, and following its journal from a fresh cursor would send its trades again under a new
  run. **A line the bot refuses** even on its own (a 400 at one line, after the loot uploader's
  halving) is withheld as `bot-refused` and the trades after it go on — each line is a record of its
  own, and a stop nobody is shown would last until the app restarts; the loot log still stops
  (`Blocked`) as before. **A bot without that route yet** (404/405 — the route comes with the bot's
  slice A) is asked again every 30 minutes, said once in the app log and nowhere else: the member
  sees nothing, and the loot upload, a separate uploader, never waits on it. The lines are kept in
  the file, and sent if the route appears during the same capture session; the cursor and the wait
  are the session's, and the next session follows its own journal, so the trades of a session that
  ends first stay on the member's computer, never sent — acceptable while trades are behind the v5
  flag, which goes default only after slice A is live. **The hold:** a broken trade handler holds the trade upload only (the loot goes on); a broken
  loot handler holds both — a trade's record leans on loot handlers (OpJoin names the member and
  the zone; EvNewCharacter and EvOtherGrabbedLoot are how the engine sees a zone hide names), and
  what a trade moves is counted against pickups that are held themselves. Held trade lines are
  never sent, as held loot is not: one `held-uploads.json`, one store for both uploaders (two over
  the one file would write over each other). No UI yet: the Trades page is not drawn. Tested in
  `test/tradeUpload.test.ts` (over the engine's real lines, `test/fixtures/realTradeLines.ts`),
  `test/uploadPlan.test.ts`, `test/botFacing.test.ts` and `test/upstreamAllowList.test.ts`.
- **What leaves the computer** (`test/upstreamAllowList.test.ts`, the guard raid-bot ADR 0110 §5
  promised): the bot's routes the app calls are an allow-list — pair, upload, trades, festivities,
  energy, energy-log, engine-health, all in `src/main/uploadClient.ts` — and so are the engine
  lines main forwards as they arrive (festivities, energy, energy log) and the fields a trade line
  may carry. A new route, forwarder or field fails the test until it is reviewed and listed.
- **The engine version on every upload**: both line routes (`/upload` and `/trades`) carry the
  header `X-Capture-Engine` — the bundled engine's git commit, or `dev` for any engine that is not
  the bundled one (the dev layout's sibling checkout, a folder chosen in Advanced), or `unknown` for
  a bundled engine with no readable stamp (`src/main/engineRef.ts`). A header, never a body key: a
  bot that predates it reads the batch unchanged. The release build takes the engine's protocol18
  head with no pin, so `tools/prepare-engine-dist.mjs` — the step both platform jobs run — stamps
  the checkout's HEAD into the bundled engine as `ENGINE_REF`, and fails the build in CI when it
  cannot (see Builds) — the engine's commit; the app's version names the patches applied over it. raid-bot ADR 0168's slice B reads it to keep pickups written by an engine
  without the chest-window fixes out of a trade's count.
- **Behind it**, `src/app/store.ts` mirrors the bridge for React (`useSyncExternalStore`): the five
  `get*` calls, then the three `on*` subscriptions — a push that lands while a get is in flight wins
  — and the setup probed again on window focus. It also keeps the little the notices' buttons need
  that main does not: a fix attempt's outcome, a running install or check, Stop capture and
  update's wait for the engine, and the dialog's answered events. The settings drawer's theme and
  language go through it too, drawn at once and then set to what main stored, and so does the
  connection panel: a code with main (one at a time; a call that never comes back is the old
  window's "Couldn't reach your guild's bot"), why the last one was refused, the upload switch drawn
  at once. Auto-start runs once
  per window over an idle capture, as the old window's does. `src/app/router.ts` keeps the page in the hash (`#/session`);
  any hash not starting `#/`, like the skip link's `#main`, is left alone. The stored theme and
  language apply as they arrive. What each state says is pure (`src/app/model.ts`), held to the
  boards by `test/shellModel.test.ts`, the connection panel's words and place by
  `test/shellConnection.test.ts`; the store and the router by `test/shellStore.test.ts`. The
  bridge's type is shared with the old window (`src/shared/bridge.ts`, types only, so the old
  window's built JavaScript is unchanged).
- **Accessibility**: a skip link first, then the title bar (banner), the sidebar (navigation
  "Views") and the page (main) with one h1; one polite live region speaks a state change once; the
  package's steel focus ring throughout; every dot beside words.

**How the button changes** (`src/app/StartStop.tsx`, the rules in `src/app/morph.ts`). The owner
asked for the old window's Start/Stop transition, and it is that pill's, at the bar's 34px — one
button in layers, never two that swap:

- Stop's ember face (the danger outline) is underneath all the time, and the surface over it — gold,
  or lifted for the error state's neutral Start — **drains off it**, left to right, over 440ms
  (`cubic-bezier(.65, 0, .35, 1)`); the wipe retraces on the way back, so stopping visibly undoes
  starting. A cross-fade was the obvious move and the transition study showed why it was wrong: a
  bright gradient dissolving into a dark outline passes through a muddy middle.
- The words **roll**: the old ones out upward in 170ms, then the new ones in from below over 260ms,
  7px of travel. They are drawn twice in one place — on the ember in Stop's red, and inside the
  surface in its ink, cut by the same edge — so mid-drain each word is in the colour of whatever it
  stands on. (The old pill faded one set of words from one colour to the other, which read as
  half-lost words at the midpoint; this is the one departure from it.)
- The two labels differ in width, so the box **eases** between them and nothing in the bar jumps:
  the version and the gear stay put, the status glides. A wider face makes its room while the old
  words leave and its words arrive into it; a narrower one waits for the old words to go, then
  closes in with the new — so the words never stand outside the drawn box. The width is written
  through the CSSOM (the policy refuses style attributes, not that) and let go when the ease ends.
- While the logger starts or stops, Stop is dimmed to 40% and refuses the press (board Fh1) and the
  old **sheen** crosses it at full strength. The refusal is `aria-disabled`, not `disabled`, so a
  Start pressed from the keyboard keeps the focus.
- The old pill's small touches came too: one squash as the face changes, and hover held off for
  350ms after the logger lands under a resting pointer, so the new face's hover does not flash on.

Every timing is a `--lb-t-*` in `src/app/shell.css` — the old window owns the `--gb-t-*` names —
and `test/startStop.test.ts` holds them to the old window's. The sequence is CSS alone, so the
component keeps no time; it answers the browser's animation events. Under reduced motion every
duration is zero, the sheen goes, and the end states are the same. Hover and press paint the layers
with the package's own gradients; a press rule must carry every condition its hover rule does, or
the hover outranks it (the test holds each press to its hover twin). Under Windows' high contrast
the layers give way to a border in the system's colours, and Stop's square is drawn in its button
text.

Every new string is in `src/shared/strings.ts` in the six languages; the count of lines sent picks
its plural form with `Intl.PluralRules` (`src/shared/plural.ts`).

A value a board draws that no token holds is a `--lb-*` variable in `src/app/shell.css`, defined
for both themes with the board it came from; where the board takes a different token in each theme
(the bar's hairline), the variable names the two tokens instead of copying their values.

**Seeing it.** `pnpm build && OUT=<dir> electron tools/shell-shots.cjs` draws the built page behind
the layout check's stub bridge in every capture state, both themes, both platforms and three widths,
and writes a PNG of each (`ONLY=<part of a name>` for some, `SCALE=2` for 2x). The OS's own buttons
are not in a page, so the tool draws dashed stand-ins where a Mac's lights and Windows' caption
buttons go. The button's change is shot in motion (`ONLY=morph`): Start pressed and the logger
stopped, then the same for the error state's neutral Start (pressed again; the logger failing as it
starts), in both themes, each at 0, 110, 220, 330 and 440ms — the page's own animations stopped at
that millisecond, not a timer racing them (`tools/shell-morph.cjs`) — and laid out side by side in
`morph-strip.png` (`ONLY=morph-st` for the gold pair alone). `ONLY=forced` shoots the bar under
Windows' high contrast (DevTools' forced-colours emulation). `ONLY=notice-` shoots every notice of
Fh5 in the band, at 1440 and 768, in both themes — pressing first where the board draws a notice
after a press (the password prompt closed, the driver still fetching, "Later" on the dialog) — and
lays the bands out in a sheet per theme and width, `notices-<theme>-<width>.png`; `ONLY=dialog-`
shoots the broken decoder's dialog. `ONLY=settings` shoots the settings drawer open over a running
capture — at 1440 and 768 in both themes, at 768 in German, Ukrainian and French, and with its
language menu open at both sizes (a `press` may be a list: the gear, then the language) — with the
folders a real install reports, at their longest (`longPaths` in the stub bridge) — and twice more
from the keyboard alone (a scenario's `keys`): Tab from the top of the page to the gear, Enter, Tab
on to the Parchment tile, Enter, so the shot is the page re-themed behind the open drawer, and the
tool prints what the page asked of the bridge on the way (the stub records every call,
`gbcStub.calls()`). `ONLY=connection` shoots the guild connection's panel: Fh2's three scenes — not
connected, a code that was not accepted (a `press` may type into a field, `{ fill, value }`: the
board's code, then Pair, which the stub refuses), connected — at 1440 on a Mac and 768 on Windows in
both themes, laid out with the foot under each in `connection-<theme>-<width>.png`, with a code
typed and not yet sent between the first two (Pair live, in the kit's steel); then a code being
checked, the panel opened from Session's button, the panel under the band's gold fix (Pair steel
beside it and the bar's Start neutral; at 1440 and 768, and with a code typed in both themes), Pair
holding the keyboard's focus ring in both themes, the connected details in each upload state that
says more than its line, the longest refusal in English, German, Ukrainian and Russian at 768,
Windows' high contrast, and the door reached from the keyboard alone. The stub now keeps a pairing
as main would — a code it is told to accept pairs, Disconnect unpairs, the switch switches — and can
refuse with any failure (`pairFailure`) or never answer (`pairPending`). It measures nothing; the
layout check below does.

**Checking it.** `pnpm check:layout:v5` (`tools/shell-layout-check.cjs`, in CI under xvfb beside the
old window's check) drives the built page behind the same stub bridge and measures every route at
768, 1024, 1280 and 1440 — the narrowest width of each of the shell's layouts, and the boards' width
— all at the window's smallest height, 620, in both themes, the six languages, both platforms and
the thirty-seven states that change the layout: every capture state the shell draws, each with a guild
connection that gives the sidebar's foot one of its shapes, the foot's remaining states over a
running capture, and every notice of Fh5 at its tallest — the blocked cards with their notes, the
decoder's four steps over a held upload, the logger stopping, an update ready — the broken
decoder's dialog itself, the settings drawer — open over a running capture, with its language
menu open, and over an idle capture with no engine found — and the guild connection's panel: not
connected (from the foot and from Session's button), a code refused (the board's refusal and the
longest in every language), a code being checked, opened under the band's gold fix, connected (as
the board draws it, and with the longest sentence the details carry): 3,552 scenarios, from 888
windows each shrunk through the four widths. Then the title bar's button changing face, the one part of the shell
that moves its own layout: in a window with motion back on, both directions as the logger goes
(Start pressed, the logger stopped), at every 55ms from the change to the drain's end, at the four
widths, in both themes, the six languages and both platforms — 1,728 more, from 24 windows, measured
on the bar. 5,280 in all. It fails on:

- sideways scroll — the window, or anything in it that scrolls, wider than it is;
- clipped text — words cut by a box that hides its overflow, or past the window's edge. Two cuts are
  the design's and pass while they end in "…" with the whole text in a title: a device's name in
  the sidebar's foot, and the bar's status words (at 768 on Windows the longest restarting
  sentences give way). The run lists each, with how often it happened. A state in words —
  "Disconnected in Discord" — may not be cut, only wrap;
- words spilling out of a box that is drawn (a button, a card, the bar), and two drawn boxes over one
  another, neither holding the other — a card too wide for its column lands on the next one without
  making anything scroll;
- the title bar's parts — crest, wordmark, status, button, version, gear — overlapping one another,
  leaving the bar, or sitting under the OS's own buttons (a Mac's lights, Windows' caption buttons);
- any `securitypolicyviolation`, heard from the page's first moment (`tools/shell-layout-preload.cjs`),
  and any error the page logs;
- a page that did not draw: the landmarks, the route marked current in the sidebar, a page in the
  panel, and the notice its state calls for in the band — or one it does not call for;
- the broken decoder's dialog open when it should not be, or shut when it should be open; a dialog
  that does not fit the window under the title bar, or scrolls; the focus outside it, or the rest of
  the window not inert. A box under its scrim is not "over" one in the dialog. Then the dialog is
  answered from the keyboard — a click on its scrim (which leaves the focus outside it), then Escape
  — and must close with the band still holding its notice, the window alive again and the focus on
  the page;
- the settings drawer open when the gear was not pressed, or shut when it was; a drawer that does not
  sit 16px in from the window's edges under the title bar, or is wider than 440px; the focus outside
  it, the rest of the window not inert, or a gear that does not say its drawer is open. Its language
  menu open when it should not be, or shut; outside the window or over the title bar, over its own
  button, scrolling, or without the focus on one of its rows. Boxes in the drawer, in its menu and
  under its scrim are each in their own layer, and a box fixed to the window (the menu) is held to
  the window, not to the boxes around it in the page. Then the keys, at the last width: the focus
  starts on Close; Shift+Tab goes round to the drawer's last stop and Tab back; Enter on the other
  theme's tile puts the page in that theme, keeps the focus and gives the theme to the bridge to
  store; every other control, reached by Tab and pressed from the keyboard (Space for the switch),
  makes its own bridge call and no other — Check for updates, Open folder, Choose engine folder…,
  the privacy policy (without the window navigating), the auto-start switch — read back from the
  stub's record; a language picked from the menu with the keys puts the page in it, is given to the
  bridge to store and closes the menu onto its button; ↓ opens the menu again and
  Escape closes it alone; the drawer closes by Escape (after a click on its words, which leaves the
  focus outside it) and by a press on the scrim, opens again by Enter on the gear, goes inert under
  the broken decoder's dialog and has its focus back once "Later" is pressed — and every close
  leaves the drawer gone, the window alive and the focus on the gear;
- the guild connection's panel open when no door was pressed, shut when one was, or showing the
  wrong face; a panel that leaves the window, reaches within 8px of the title bar, covers the foot
  it opens from, or scrolls; the focus outside it; a foot's door that does not say its panel is
  open or is not drawn pressed. Boxes in the panel are in their own layer. Then the keys and the
  pointer, at the last width (the stub records every bridge call): not connected, the focus starts
  in the code field and Pair waits for a code; Escape closes it onto the door and Enter on the door
  opens it again; Enter on the copy button copies `/capture pair` (`copyText`, and nothing else)
  and says so; a code typed and Enter asks to pair that code, once, and the refusal is said under
  the field, which keeps the focus and says it is invalid; Tab out past Pair closes it; a press on
  the door opens it with no refusal and no code left; a press outside — on a spot that takes no
  focus, so the press alone — closes it. Only spaces in the field leave Pair waiting. In the window
  of a refused code, every `EPairFailure` in turn (the stub refuses each, `gbcStub.refuseWith`): the
  sentence under the field must be the app's own for it — the catalog's `fail` + the failure's name
  — and the page's polite region must say the same. Opened from Session's button, that button says it is open,
  and Escape gives the focus back to it; opened again, a code the stub accepts turns the panel to
  the details with the focus on it, Session's pair card gone and the foot naming the computer, and
  Escape then gives the focus to the foot's door, the other one having gone. While a code
  is being checked, Escape, a press outside, either door and the focus leaving all leave it open,
  and Enter sends no second code. Connected, the focus starts on the panel; Space on the switch,
  Enter on View my loot (without the window navigating) and Enter on Disconnect each make their own
  call and no other (`setUpload(false)`, `openLoot()`, `unpair()`); after Disconnect the panel shows
  the steps with the focus in it and the foot says Connect a guild; Escape closes it onto the door;
- more than one gold button in sight, in any state: the band's fix, else the bar's Start capture,
  holds it, and what lies inert under the dialog or the drawer is veiled, not in sight;
- with the connection panel open, a Pair that is not the kit's steel button (`gbtn-share`), or a gold
  button other than the one the state names: the bar's Start while the steps show over an idle
  capture (with a code typed too, in the keys), the band's fix — with Start stepped back to its
  neutral face — under a band, none while the bar shows Stop;
- in the morph: a word outside the button at any frame, the version or the gear moving by half a
  pixel, a change that did not play its drain, its width or its words (a run whose morph never
  played proves nothing), and a button that keeps its eased width, or a leaving word, once the
  morph is over.

The routes and the languages are read from the source (`ROUTES` in `src/app/router.ts`,
`SUPPORTED_LANGS` in `src/shared/i18n.ts`); the sidebar must offer exactly those routes, and the run
must measure exactly the product of its lists, none of them empty — so an empty route list, or a run
that stops early, fails, and a source that no longer compiles fails at once rather than leaving
Electron waiting with no window. Each measurement waits until the page says it has settled (its language and
theme applied, every slice of the bridge drawn, the faces loaded, nothing that plays once still
playing — the drawer's fade) rather than a fixed time. A state that is a press away (Later, the fix
that reports back, the install still fetching, the gear and the language) presses first, on the
platforms whose card has that button, and waits for what the press brings. `OUT=<dir>` writes a PNG
of each failing scenario. About seven minutes on an Apple-silicon Mac.

**The window.** Behind the flag the window is the shell's own (`src/main/windowOptions.ts`):
resizable down to 768×620, maximizable and full-screenable, and opening at 1280×800 the first time —
clamped to the screen's work area and centred on it — then wherever it was left.

- Its size and place go to **`window-state.json`** in the data folder, never to `settings.json`,
  which holds the pairing token and is rewritten whole. The state is written to a temp file and
  renamed over the old one, once the window has been still for half a second after a move or a
  resize, and when it closes. On a Mac the close-time write is registered before the close
  handler's early return: closing the window there is not quitting, and the next window (a click on
  the dock icon) opens from the file.
- A maximized window keeps the bounds it un-maximizes to and reopens maximized over them. Full
  screen is not remembered. A minimized window is not read at all — both OSes call it not
  maximized, and a Mac reports the zoomed frame as its normal bounds — so quitting with it in the
  Dock or the taskbar keeps the place it last had on screen.
- A remembered place is dropped, and the first-open size used, when less than 160 px of its title
  bar would land on any screen's work area — most often a monitor since unplugged. The rules are
  pure (`src/main/windowBounds.ts`, `test/windowBounds.test.ts`); the file and its timing are
  `src/main/windowState.ts`.
- On Windows the OS draws its three caption buttons over the right end of the 48px bar, in the
  bar's colours (`--lb-bar`, glyphs in `--gb-muted`; `test/windowOptions.test.ts` holds the main
  process's copies to `src/app/shell.css` and the package). On a Mac the traffic lights sit where
  board Fh1 draws them, 18pt in and centred on the bar. That position is measured: Electron draws
  each light 1pt right of and 2pt below the point it is given (macOS 26.6), so 0.8.8's
  `{ x: 18, y: 18 }` centres them 2pt low.
- The page cannot leave its window: a navigation to anything but its own `index.html` is refused,
  and so is every new window, each with a `window: refused …` line in the app log. Moving between
  routes changes only the hash, which is not a navigation.

With the flag off, the old window's options are 0.8.8's byte for byte (`test/windowOptions.test.ts`
compares them with JSON produced from 0.8.8's own source), and none of the above applies to it.

**Not yet.** The connection panel has no way to name the computer (main still sends the hostname,
as the old window does), and a computer Discord has disconnected is paired again by Disconnect,
then the steps. The settings
have no beta channel (it needs the release pipeline), and a folder's path is shown as the OS gives
it, not shortened the way the board draws it (`%APPDATA%\…`, `…\resources\engine`). The numbers
a broken decoder feeds are not marked ("may be wrong since 14:41", Fh4): there are no numbers on
Session yet. A notice shows no "Technical details" for an error (the old window's
fold); the broken decoder's verdict is the only detail the band shows. Times of day are in the OS's
format, which may not be the app language's. In full screen on a Mac the bar
still pads 84px for the lights it no longer shows. The layout check cannot see the rail's tooltips
(drawn by CSS on hover and focus, out of the DOM's reach), what the OS draws over the window, or a
real Windows machine.

## When a game update breaks the decoder

An Albion patch can move a packet field. From 2026-09-23 every container attach
threw, and bank deposits were logged as loot for five days before anyone knew
(raid-bot ADR 0092). The engine now prints a verdict every minute beside
`[status]` (designsvet/ao-loot-logger#16): `[health] parse ok`, or
`[health] parse broken: EvAttachItemContainer 5/5 (last 10 min)` once a handler
has failed at least 5 times, on at least half its calls, in ten minutes. A
rate, because some handlers fail now and then in normal play (9 of 1,204).

The app turns that into the loudest fix card it has (the owner's pick, "C",
2026-09-29). The card takes the greeting's place, says plainly that loot is
being logged wrong, and its one button is the next step to the fixed build:
"Stop capture and update" once the update has downloaded (a restart never cuts
a live capture), "Check for the fix" while none is out, and "Get the update"
where the app cannot update itself (macOS). It is sticky for the app session,
so walking away from the broken packet does not hide it; only the updated app
clears it. When paired, the app also reports the newly broken handlers to the
bot, which posts them to the ops channel once per handler per day. The rules
are the pure `src/shared/engineHealth.ts`, tested in
`test/engineHealth.test.ts`. In the v5 shell (behind its flag) the card is the band's notice and a
dialog, and the guild upload is held while the break reaches the loot log — see "The v5 shell".
The six player-trade handlers (designsvet/ao-loot-logger#20) run for every member and feed no loot
line, so a break in them alone puts up no card and holds no loot; it holds the trade upload (see
"The trade upload"). They are listed in `NON_LOOT_HANDLERS` ahead of any build that bundles them,
because the build takes the engine's branch head unpinned (`test/notices.test.ts`).

## Builds (CI)

The `capture-build` workflow builds both platforms from one run: a `build` job
for Windows that also owns every release decision, and a `macos` job that
attaches a DMG to the release that job publishes. (The mac work is a job and
not its own workflow because a release cut with `GITHUB_TOKEN` does not
trigger further workflow runs — an `on: release` workflow would sit there
green and never fire.)

### Windows

An **unsigned installer with the engine bundled**: it checks out an engine
repo/ref (dispatch inputs; default
`designsvet/ao-loot-logger@protocol18`), applies `resources/engine-patches/*`
(currently one: flush the log on SIGINT — the
engine's own exit hook only fires from its raw-mode keyboard input, which a
child with ignored stdin never gets), compiles `cap` for this app's Electron
ABI (cap vendors its own WinPcap SDK — no external download), assembles
`engine-dist/` via `tools/prepare-engine-dist.mjs`, and ships it as
`resources/engine` — where the locator finds it and captures into the user's
data folder, so the install dir is never written. The same script writes the
engine checkout's commit into the bundle as `engine/ENGINE_REF` — the value of
every upload's `X-Capture-Engine` header — and fails the job in CI if it
cannot (a local run over a folder that is not a git checkout warns and ships
none; the app then says `unknown`); both jobs then assert the stamp is inside
the packed app. The sha names the engine COMMIT: the patches above are applied
on top and it does not say so — the app's version names that patch set, so read
the two together. (Bundles built before
designsvet/ao-loot-logger#11 did write there: the engine put its loot log
beside itself, inside the installed app.)

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

### macOS

The same engine bundle, packaged as an **arm64 DMG** (Apple Silicon). Intel
Macs get no build: a universal binary needs the engine's `cap` native module
compiled for both arches on one runner, and cross-compiling a libpcap binding
costs more than the shrinking audience is worth.

The DMG is **ad-hoc signed, not notarized** — there is no Developer ID yet
(Q16). Ad-hoc is not optional on Apple Silicon, where the kernel requires a
valid signature to execute; what it does not buy is Gatekeeper's blessing, so
the first launch needs **right-click → Open** (or System Settings → Privacy &
Security → Open Anyway). The download page says so.

That ad-hoc signature comes from the `afterPack` hook in
`tools/adhoc-sign.cjs`, and it is worth knowing why it is a hook rather than a
config line. `mac.identity: null` was believed to request ad-hoc signing. It
does not — app-builder-lib reads it and skips signing entirely, logging
`skipped macOS code signing  reason=identity explicitly is set to null`, and
nothing else in electron-builder ad-hoc signs. Electron's prebuilt binaries do
arrive ad-hoc signed, but electron-builder renames the bundle and its
executable, rewrites `Info.plist` and adds `Contents/Resources`, which
invalidates that seal. The first macOS build on `main` shipped exactly that
bundle. The hook signs and then **verifies**, because an ad-hoc sign that
fails silently restores the original bug with a green build either way.

Two things the CI asserts, because neither fails the build on its own and both
would only surface on a member's Mac: the engine is really inside
`Contents/Resources/engine`, and the BPF helper scripts are really inside
`Contents/Resources/mac`. The second exists because `extends`
**concatenates** arrays rather than replacing them: an overlay that re-lists
`resources/mac` puts it in the list twice and the build dies on
`EEXIST … link resources/mac/fix-bpf.sh`, while an overlay that assumes the
override and lists only the engine is correct — but silently ships without the
helper if that assumption is ever wrong. The assertion is what makes either
guess a failed build instead of an app that cannot ask for permission on a
member's Mac. (This paragraph asserted the opposite until the first real macOS
run disproved it; a Linux `--dir` dry run does not reproduce the collision,
because the copier only hard links when it can.)

### Signing and notarization (macOS)

The build signs and notarizes **when the secrets exist and skips when they do
not**, with no config change either way. Absent them it behaves exactly as
described above: ad-hoc signed, not notarized, green. The switch is
`CSC_IDENTITY_AUTO_DISCOVERY`, set by the `Decide whether this build is
signed` step.

Repository secrets — the first two sign, the last four notarize, and the
notarizing four are all-or-nothing:

| Secret | What it is |
| --- | --- |
| `MAC_CSC_LINK` | The **Developer ID Application** certificate, exported from Keychain Access as a `.p12`, then base64-encoded |
| `MAC_CSC_KEY_PASSWORD` | The password set when exporting that `.p12` |
| `APPLE_API_KEY_B64` | An **App Store Connect API key** (`.p8`), base64-encoded |
| `APPLE_API_KEY_ID` | That key's Key ID |
| `APPLE_API_ISSUER` | The issuer UUID from App Store Connect |
| `APPLE_TEAM_ID` | The 10-character Team ID |

An API key rather than an Apple ID and app-specific password: the key does not
break when the account's password or 2FA changes, and it carries no access to
anything but notarization.

Three behaviours worth knowing before reading a build log:

- **`MAC_CSC_LINK` alone signs but does not notarize**, and the job says so
  with a warning. A signed-but-un-notarized app is still refused by Gatekeeper,
  so that state is a stop, not a step forward.
- **Pull request builds never sign**, whatever the secrets say —
  electron-builder's `isSignAllowed()` refuses on PRs unless
  `CSC_FOR_PULL_REQUEST` is set. The signed path can only be exercised by a
  push to `main`, so expect a PR build to report `Signature=adhoc`.
- **A mangled key fails immediately.** The prepare step checks the decoded
  `.p8` really begins with `BEGIN PRIVATE KEY`, rather than letting
  `notarytool` discover it a quarter of an hour later.

What the build then does, in order: electron-builder signs every nested Mach-O
with the hardened runtime (its default for non-MAS mac builds) — including the
engine's `cap.node`, because `@electron/osx-sign` walks the whole of
`Contents/`, not just the app's own code — notarizes the `.app` and staples the
ticket to it, then builds and signs the DMG. The workflow notarizes and staples
the **DMG** separately afterwards, because electron-builder cannot: it
notarizes during packing, before a disk image exists, and Gatekeeper checks the
file the member actually downloaded.

`spctl --assess` is asserted, not printed. It is the only check that answers
the member's real question — will this open without a fight — and it passes
only for a Developer ID signature *with* a ticket. A signed-but-rejected build
is identical to a good one in every other line of the log.

Auto-update is still Windows-only (`updateController.ts` gates on `win32`),
but the reason has changed. It was that electron-updater cannot update an app
that is not Developer ID signed, so a mac feed would have promised what it
could not deliver. Once a notarized release exists that objection is gone and
the remaining work is real but ordinary: publish the `zip` target the base
config already declares, let electron-builder emit `latest-mac.yml`, and drop
the platform gate. Not done here, because a feed is worth building against a
release that has actually been notarized once.

### Cutting a release

Two ways, both ending in the same build-and-publish path:

- **Bump the version on `main`.** A push whose `package.json` names a version
  with no release yet cuts that release. This needs nothing but push access —
  no tag push, no dispatch permission — which is what lets the agent cut one
  too. Idempotent: an existing release means build-only, so ordinary pushes
  and re-runs never republish.
- **Dispatch the `capture-build` workflow** with a `release_version` (e.g.
  `0.2.0`) — Actions → capture-build → Run workflow. It records the version
  in `package.json` on `main` for you first.

Either way the release is created through the release API, which makes the tag
itself — no tag push is involved anywhere. A hand-pushed `v*` tag still works
and takes the same path.

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
   One line in that recording was read as noise for nine days and is now a
   signal: the engine echoes **one line per pickup** as it writes it, so the
   counter no longer waits on the once-a-minute heartbeat to move. The
   heartbeat stays the reconciling truth — it resets the live delta every
   time it arrives, so an optimistic miscount is bounded by one minute and
   can never accumulate — and the log FILE remains the source of truth for
   everything uploaded, so a mis-parse can only ever affect a number on
   screen. The pattern is deliberately strict where the rest are liberal:
   a missed pickup costs a second of lag, an invented one invents loot.
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
4. **The two real failure modes.** Albion closed → Waiting, and after ~90 s the
   *Nothing after a few minutes?* line appears in the greeting — never an error,
   and nothing above or below it moves when it does. Open it: the three reasons
   sit over the card with the Start/Stop button still visible underneath, and
   they close on Escape, an outside click, or the line again. Then start the game
   mid-session → Capturing by itself, and the reasons close themselves. Quit the
   game → back to Waiting, counts kept.
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
10. **View my loot.** Press it while paired — the browser must land on the
    dashboard's **Loot** tab, not on Overview. A second press opening a second
    browser tab is expected and not a bug: nothing outside a browser can focus a
    tab it already has.

## Sending loot to your guild (v0.3.0+)

Press **Pair with Discord** in the card at the bottom, run `/capture pair` in
Discord, and type the code it replies with into the box that opened. From then on, captured lines are sent to the guild's bot as they are
written; the officer's loot session picks them up by itself, and `View my loot`
opens the member's own page.

Three things about it worth knowing:

- **Uploading never interferes with capturing.** Every failure is reported and
  retried; the file on disk is the fallback and the drag-and-drop path still
  works. No upload problem can stop the engine or block a Start.
- **The token is stored encrypted** via Electron's `safeStorage` (Keychain /
  DPAPI). Where the OS cannot encrypt, the app stays unpaired and says so
  rather than writing a live bearer token into a plain JSON file.
- **A new log file starts a new upload run.** The engine rolls its file at
  midnight and the second file's line numbers restart at 0 — continuing the
  same run would send indices the first file already used, and the server's
  `UNIQUE (run, line_no)` would swallow every one of them as a duplicate. That
  is silent data loss, so `uploadPlan.ts` mints a fresh run id per file.

**The guild's bot needs the feature too.** Pairing and upload live on the bot
side as well, so a bot that predates them answers 404. The app says exactly that
("an officer needs to update it") rather than blaming the code — the two need
opposite things from the member, and treating a missing route as a rejected code
sends them round a loop fetching fresh codes that can never be redeemed. Upload
keeps retrying in that state, so it resumes on its own once the bot is updated.

Auto-send is ON by default (owner ruling) and switchable per computer.
`Disconnect this computer` forgets the token locally; the device row stays in
Discord, where `/capture devices` and `/capture revoke` manage it.

Pointing at a different bot (staging) is an `apiBase` entry in
`settings.json` — same escape hatch as the engine folder.

## Auto-update (Windows, v0.4.0+)

The Windows app updates itself: it checks GitHub Releases on startup and every
hour, downloads a newer installer in the background, and installs it
**when you quit** — nobody re-downloads anything. A strip appears in the app
only while an update is downloading or ready; "Restart and update" is offered
once it's ready, and is refused while capture is running — no version bump is
worth a hole in tonight's loot log (quitting later installs it anyway). The
bundled engine rides along, so a game-patch fix reaches every member by one
version bump on `main`.

Plainly, since the app is unsigned: an update is trusted because it comes from
this repository's GitHub Releases over HTTPS, verified against the sha512 in
`latest.yml` from the same release. The repo is the trust anchor; code signing
(Q16) will pin updates to a certificate on top of this same mechanism.

Notes for testers: v0.4.0 is the first version that *contains* the updater, so
it must be installed by hand once — auto-update carries every version after
it. macOS stays on manual installs until signing (Squirrel.Mac refuses
unsigned updates). Set `GBC_NO_AUTO_UPDATE=1` to pin a machine to its build.

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

### If a Windows member sees this

```
Error: The specified module could not be found.
\\?\C:\Users\...\resources\engine\node_modules\cap\build\Release\cap.node
  code: 'ERR_DLOPEN_FAILED'
```

**Npcap is not installed.** `cap.node` links against `wpcap.dll`, and Windows
reports a missing *dependency* by naming the file it DID find — so the words
npcap, wpcap and winpcap appear nowhere in the crash. Install
[Npcap](https://npcap.com/#download) (defaults are fine) and reopen the app,
or use the app's own **Install capture driver** button, which fetches and
launches Npcap's signed installer.

Reported by a member on v0.6.0, where this text was misread as an ABI mismatch
and the card told them to run `pnpm engine:rebuild` — a command for a repo
they do not have. Fixed in v0.6.1; the crash is pinned as a fixture
(`REAL_WIN_NPCAP_MISSING`) so it cannot be misread again.

### If nothing at all happens when a member runs the installer

The app writes a log from its first moment. Ask for:

```
%APPDATA%\guild-butler-capture\logs\capture-app.log
```

If that file does not exist the app never started, which points at SmartScreen
blocking the unsigned installer — the run button hides behind **More info →
Run anyway**. The installer is one-click and launches the app itself, so
"nothing happened" can also mean it is already installed and sitting in the
Start menu.

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
- **P2** — pairing code from Discord → per-DEVICE token → auto-upload of
  captured lines. ✔ built in v0.3.0 (the bot half — ingest, the raid claim, the
  member's Capture tab — shipped first; raid-bot ADR 0092 P2).
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
