/**
 * Every user-visible string, in one place. English-only for Phase 1; keeping
 * them here (instead of scattered through the renderer) is what makes adopting
 * the bot's six-language i18n pattern a mechanical change later.
 *
 * Copy rules: members are not technical. Say what happened and what to click,
 * never what subsystem failed. The two errors that actually happen — no capture
 * permission, and Albion not running — get the most careful words.
 */

export const STR = {
  appName: "Guild Butler Capture",
  tagline: "Albion loot logging for your guild — no terminal required.",

  status: {
    idle: "Not capturing",
    starting: "Starting the logger…",
    waiting: "Waiting for Albion…",
    capturing: "Capturing",
    stopping: "Stopping…",
    restarting: "The logger hiccupped — restarting it…",
    error: "Something needs fixing",
  },

  statusHint: {
    idle: "Press Start before you head into content. Loot picked up near you is written to a log file your officers can settle from.",
    starting: "Getting the capture engine going.",
    waiting:
      "The logger is running, but no Albion traffic has reached it yet. The moment the game produces traffic it is picked up by itself — leaving this running through a game restart is fine.",
    capturing: "Loot events near you are being written to the log.",
    capturingAs: (character: string): string => `Loot events near ${character} are being written to the log.`,
    stopping: "Asking the logger to finish writing and shut down.",
    restarting: (seconds: number): string =>
      `The capture engine stopped unexpectedly. It restarts by itself in ${seconds}s — your log file and counts are safe.`,
  },

  /** Shown under Waiting once nothing has been detected for a while. */
  waitingHints: {
    title: "Still nothing? The usual reasons:",
    items: [
      "Albion isn't running, or is sitting on the login screen — get in game and move around a bit.",
      "A VPN or tunnel (NordVPN, ExitLag, …) is carrying the game's traffic where the logger cannot see it. Turn it off while capturing.",
      "GeForce Now / cloud gaming — the game runs on their computer, so its traffic never touches this one. Capture cannot work there.",
    ],
  },

  errors: {
    permissionTitle: "macOS is blocking network capture",
    permission:
      "macOS only lets administrators watch network traffic, which is why the old script needed sudo. Click “Fix capture permissions” — you'll be asked for your Mac password once, and the fix sticks across reboots. There is no switch for this in System Settings; the password prompt from this app is the whole fix.",
    npcapMissingTitle: "One-time setup: the capture driver",
    npcapMissing:
      "Windows needs a small free driver (Npcap) before anything can watch game traffic — its licence doesn't let us include it, so the app fetches it from the makers and starts it for you. Click “Install capture driver”, say yes to Windows, and click Next through the short wizard. Once only.",
    npcapAdminOnlyTitle: "Npcap is restricted to administrators",
    npcapAdminOnly:
      "Npcap is installed, but it was set up so only Administrators may capture. Reinstall it with “Restrict Npcap driver's access to Administrators only” unchecked, or run this app as administrator.",
    abiMismatchTitle: "The capture engine needs a rebuild",
    abiMismatch:
      "The engine's native capture module was built for a different runtime than this app. Run the engine rebuild step from the README (pnpm engine:rebuild), then start the app again.",
    engineMissingTitle: "Capture engine not found",
    engineMissing:
      "The ao-loot-logger folder wasn't found next to this app. Point the app at it under Advanced → “Choose engine folder”.",
    crashTitle: "The logger keeps stopping",
  },

  stats: {
    character: "Character",
    characterUnknown: "detecting…",
    loot: "Loot events this session",
    traffic: "Albion traffic",
    trafficSeenAgo: (seconds: number): string => (seconds <= 2 ? "live" : `seen ${seconds}s ago`),
    trafficNotSeen: "not seen yet",
    logFile: "Log file",
    logFileNone: "created when capture starts",
  },

  buttons: {
    start: "Start capture",
    stop: "Stop capture",
    reveal: "Reveal",
    revealMac: "Reveal in Finder",
    revealWin: "Show in Explorer",
    fixMacPermissions: "Fix capture permissions…",
    installNpcap: "Install capture driver",
    getNpcap: "Download it myself",
    chooseEngine: "Choose engine folder…",
    details: "Technical details",
  },

  setup: {
    engineOk: (source: string): string => `Capture engine found (${source})`,
    engineMissing: "Capture engine not found",
    accessOk: "Capture permission looks good",
    accessUnknown: "Capture permission will be checked on Start",
    permissionNeeded: "One-time permission fix needed",
    npcapNeeded: "One-time setup needed: the capture driver",
    npcapAdminOnly: "The capture driver is installed but restricted to administrators",
    npcapInstalling: "Fetching the capture driver from npcap.com…",
    // Feedback under the checklist after a "Fix capture permissions…" attempt.
    // Granting things in macOS System Settings does NOT touch this permission,
    // so the copy has to carry the user back to the password prompt.
    permissionFixCancelled:
      "The password prompt was closed without finishing, so nothing was changed. Click “Fix capture permissions” and enter your Mac password — that prompt is the whole fix (System Settings has no switch for this).",
    permissionFixFailed: (detail: string | null): string =>
      `The permission fix didn't complete${detail != null ? ` — macOS said: ${detail}` : ""}. Try again; if it keeps failing, send your officer the app log.`,
    npcapInstalled: (version: string | null): string =>
      `Capture driver installed${version != null ? ` (Npcap ${version})` : ""} — press Start capture.`,
    npcapNotCompleted:
      "The driver wizard was closed before it finished, so nothing was installed. Click “Install capture driver” and click Next through to the end.",
    npcapCancelled:
      "Windows blocked the driver install — it needs your “Yes” on the Windows prompt. Try again and accept it.",
    npcapDownloadFailed:
      "Couldn't reach npcap.com to fetch the driver. Check your connection (a VPN or a strict firewall can block it) and try again, or use “Download it myself”.",
    npcapUntrusted:
      "The downloaded driver didn't carry a valid signature from its makers, so it was NOT run — that can mean a proxy or antivirus altered the download. Use “Download it myself” and get it straight from npcap.com.",
    permissionFixStillBlocked:
      "The fix was installed, but macOS still reports no capture access. Quit and reopen the app; if this message survives a reboot, tell your officer.",
  },

  advanced: {
    summary: "Advanced",
    engineLabel: "Engine",
    engineNotFound: "not found — choose the ao-loot-logger folder",
  },

  quitConfirm: {
    title: "Stop capturing?",
    message: "Capture is still running. Quit and stop logging loot?",
    quit: "Stop and quit",
    cancel: "Keep capturing",
  },

  /**
   * Pairing + auto-upload (ADR 0092 P2 slice 4).
   *
   * Copy rule for this block: uploading is a CONVENIENCE, never a requirement.
   * The log file on disk still works and officers can still take it by hand, so
   * no message here may read as "your loot is lost" — the worst true statement
   * is "not sent yet".
   */
  update: {
    downloading: (version: string | null, percent: number | null): string =>
      `Downloading update${version != null ? ` v${version}` : ""}…${percent != null ? ` ${percent}%` : ""}`,
    ready: (version: string | null): string =>
      `Update${version != null ? ` v${version}` : ""} ready — it installs when you quit the app.`,
    restartNow: "Restart and update",
    // The one rule: never cut a live capture. Quitting later installs it anyway.
    blockedCapturing: "Capture is running — the update installs when you quit, or stop capture first.",
    failed: (detail: string | null): string =>
      `Update check failed${detail != null ? ` (${detail})` : ""} — will retry later. Capture is unaffected.`,
  },

  pairing: {
    title: "Send loot to your guild",
    notPairedHint:
      "Connect this computer to your Discord account and captured loot is sent to your guild by itself — no dragging files around. Run /capture pair in Discord to get a code.",
    pairedAs: (device: string): string => `Connected as ${device}`,
    codeLabel: "Pairing code",
    codePlaceholder: "XXXX-XXXX",
    pair: "Pair with Discord",
    pairing: "Connecting…",
    unpair: "Disconnect this computer",
    viewLoot: "View my loot",
    uploadToggle: "Send loot automatically",
    uploadOffHint: "Auto-send is off. Capture still writes the log file, and officers can take it by hand.",

    // One sentence per failure — a generic "it didn't work" is the shape this
    // project has already paid for twice (the mac permission fix, Npcap).
    failBadCode:
      "That code doesn't look right. It's 8 characters from the message Discord sent you — check for a typo and try again.",
    failRefused:
      "Discord's code wasn't accepted. Codes work once and expire after about 10 minutes — run /capture pair again for a fresh one.",
    failUnreachable:
      "Couldn't reach your guild's bot. Check your connection (a VPN or strict firewall can block it) and try again.",
    failBadReply: "Your guild's bot answered something this version doesn't understand. It may need updating.",
    // Deliberately NOT the "get a fresh code" sentence: no code will ever work
    // against a bot without the route, and sending the member back to Discord
    // for another one is a loop with no exit.
    failNotDeployed:
      "Your guild's bot doesn't have this feature yet — an officer needs to update it. Getting another code won't help. (If you changed the server address in Advanced, check that too.)",
    failNoEncryption:
      "This computer can't store the connection securely, so nothing was saved — the app won't keep a login token in a plain file. Capture still works; officers can take the log file by hand.",
    failStoreFailed: "Couldn't save the connection securely. Try again; if it keeps failing, tell your officer.",

    // Upload status line. "Not sent yet" is the honest worst case.
    upDisabled: "Auto-send off",
    upUpToDate: (n: number): string => (n > 0 ? `${n} lines sent` : "Nothing to send yet"),
    upSending: "Sending…",
    upRetrying: "Couldn't send just now — trying again. Your log file is safe.",
    upUnauthorized: "This computer was disconnected in Discord. Pair it again to resume sending.",
    upBlocked: "Sending is stuck — tell your officer. Your log file is safe and can be handed over by hand.",
    upBotOutdated:
      "Your guild's bot doesn't accept uploads yet — an officer needs to update it. Capture keeps running, and sending resumes by itself once they do.",
  },

  footer: {
    engineCredit: "Capture engine: ao-loot-logger (GPL-3.0, open source)",
  },
} as const;
