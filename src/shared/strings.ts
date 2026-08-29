/**
 * Every user-visible string, in one place — now in the bot's six languages.
 *
 * The pattern is the compile-time version of the bot's i18n: `EN` is written
 * as a plain object literal, `TStrings` is derived from it, and every other
 * catalog is declared `: TStrings` — so a missing or extra key in ANY language
 * is a `tsc` failure, not a runtime fallback. Call sites are unchanged in
 * shape: the renderer asks `stringsFor(detectLang(...))` once and reads the
 * same object it always did.
 *
 * Copy rules (unchanged): members are not technical. Say what happened and
 * what to click, never what subsystem failed. The two errors that actually
 * happen — no capture permission, and Albion not running — get the most
 * careful words, in every language.
 *
 * Translation provenance, same standing caveat as the bot's catalog: EN and
 * UK are written with care; RU, DE, FR and PT are machine-quality and want a
 * native proofread. Brand words stay untranslated everywhere: the app name,
 * "Albion", "Npcap", "Discord", command names like /capture pair.
 */

import type { TLang } from "./i18n.js";

const EN = {
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
    // Distinct from Cancelled on purpose: the installer never STARTED, so no
    // prompt was shown and "try again and accept it" cannot fix anything —
    // that wrong-cause sentence is exactly what v0.3.1 showed a tester.
    npcapLaunchFailed: (detail: string | null): string =>
      `The driver installer couldn't be started${detail != null ? ` (${detail})` : ""}. Use “Download it myself” and run it from your Downloads folder.`,
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

  hero: {
    noCharacter: "your character appears with Albion traffic",
  },
  settings: {
    gearLabel: "Settings",
    language: "Language",
    system: "System",
    theme: "Theme",
    themeObsidian: "Obsidian",
    themeParchment: "Parchment",
    updates: "Updates",
    upToDate: "up to date",
    checkUpdates: "Check for updates",
    checking: "checking…",
    updateOff: "Auto-update is off in this build — this opens the download page.",
    advancedEngine: "Advanced — engine",
  },
  prefs: {
    /** The auto-start toggle. Default ON; the label describes the ON state. */
    autoCapture: "Start capturing when the app opens",
  },

  quitConfirm: {
    title: "Stop capturing?",
    message: "Capture is still running. Quit and stop logging loot?",
    quit: "Stop and quit",
    cancel: "Keep capturing",
  },

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

  /**
   * Pairing + auto-upload (ADR 0092 P2 slice 4). Copy rule for this block:
   * uploading is a CONVENIENCE, never a requirement — no message may read as
   * "your loot is lost"; the worst true statement is "not sent yet".
   */
  pairing: {
    intro: "Link this computer once — captures post to your guild's loot page and Discord.",
    step1: "In your guild's Discord, run",
    step2: "Guild Butler replies with your code:",
    copy: "Copy",
    copied: "Copied!",
    pairShort: "Pair",
    more: "More options",
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
};

/**
 * The one shape every language must fill. Derived from EN (written WITHOUT
 * `as const`, so properties are `string` rather than literal types) — which is
 * what lets the five catalogs below put different words in the same slots.
 */
export type TStrings = typeof EN;

/** Українська — written with care; the guild this app was built for speaks it. */
const UK: TStrings = {
  appName: "Guild Butler Capture",
  tagline: "Логування луту Albion для вашої гільдії — без термінала.",

  status: {
    idle: "Запис не ведеться",
    starting: "Запускаємо логер…",
    waiting: "Чекаємо на Albion…",
    capturing: "Йде запис",
    stopping: "Зупиняємо…",
    restarting: "Логер спіткнувся — перезапускаємо…",
    error: "Потрібно щось виправити",
  },

  statusHint: {
    idle: "Натисніть «Почати запис», перш ніж іти в контент. Лут, підібраний поруч із вами, пишеться в лог-файл, з якого офіцери зроблять розподіл.",
    starting: "Запускаємо рушій захоплення.",
    waiting:
      "Логер працює, але трафік Albion до нього ще не дійшов. Щойно гра почне передавати дані, він підхопить їх сам — можна лишати запис увімкненим навіть через перезапуск гри.",
    capturing: "Лут поруч із вами записується в лог.",
    capturingAs: (character: string): string => `Лут поруч із ${character} записується в лог.`,
    stopping: "Просимо логер дописати файл і завершити роботу.",
    restarting: (seconds: number): string =>
      `Рушій захоплення несподівано зупинився. Він перезапуститься сам через ${seconds} с — ваш лог-файл і лічильники цілі.`,
  },

  waitingHints: {
    title: "Досі нічого? Найчастіші причини:",
    items: [
      "Albion не запущений або стоїть на екрані входу — зайдіть у гру й трохи порухайтесь.",
      "VPN чи тунель (NordVPN, ExitLag, …) веде трафік гри туди, де логер його не бачить. Вимкніть його на час запису.",
      "GeForce Now / хмарний ґеймінг — гра йде на їхньому комп'ютері, тож її трафік сюди не потрапляє. Запис там неможливий.",
    ],
  },

  errors: {
    permissionTitle: "macOS блокує захоплення мережі",
    permission:
      "macOS дозволяє стежити за мережевим трафіком лише адміністраторам — саме тому старий скрипт потребував sudo. Натисніть «Виправити доступ до захоплення» — один раз введете пароль свого Mac, і виправлення переживає перезавантаження. У Системних налаштуваннях перемикача для цього немає; запит пароля від цього застосунку — і є все виправлення.",
    npcapMissingTitle: "Одноразове налаштування: драйвер захоплення",
    npcapMissing:
      "Windows потребує невеликого безплатного драйвера (Npcap), щоб бачити трафік гри — ліцензія не дозволяє нам вкладати його в застосунок, тож він завантажується від розробників і запускається для вас. Натисніть «Встановити драйвер захоплення», підтвердьте запит Windows і пройдіть короткий майстер кнопкою Next. Лише один раз.",
    npcapAdminOnlyTitle: "Npcap обмежено адміністраторами",
    npcapAdminOnly:
      "Npcap встановлено, але так, що захоплювати можуть лише адміністратори. Перевстановіть його, знявши галочку “Restrict Npcap driver's access to Administrators only”, або запустіть цей застосунок від імені адміністратора.",
    abiMismatchTitle: "Рушій захоплення потребує перезбирання",
    abiMismatch:
      "Нативний модуль рушія зібрано під інше середовище, ніж цей застосунок. Виконайте крок перезбирання з README (pnpm engine:rebuild) і запустіть застосунок знову.",
    engineMissingTitle: "Рушій захоплення не знайдено",
    engineMissing:
      "Теку ao-loot-logger не знайдено поруч із застосунком. Вкажіть її в Додатково → «Вибрати теку рушія».",
    crashTitle: "Логер постійно зупиняється",
  },

  stats: {
    character: "Персонаж",
    characterUnknown: "визначається…",
    loot: "Подій луту за сесію",
    traffic: "Трафік Albion",
    trafficSeenAgo: (seconds: number): string => (seconds <= 2 ? "щойно" : `${seconds} с тому`),
    trafficNotSeen: "ще не видно",
    logFile: "Лог-файл",
    logFileNone: "з'явиться після старту запису",
  },

  buttons: {
    start: "Почати запис",
    stop: "Зупинити запис",
    reveal: "Показати",
    revealMac: "Показати у Finder",
    revealWin: "Показати у Провіднику",
    fixMacPermissions: "Виправити доступ до захоплення…",
    installNpcap: "Встановити драйвер захоплення",
    getNpcap: "Завантажу сам",
    chooseEngine: "Вибрати теку рушія…",
    details: "Технічні деталі",
  },

  setup: {
    engineOk: (source: string): string => `Рушій захоплення знайдено (${source})`,
    engineMissing: "Рушій захоплення не знайдено",
    accessOk: "Доступ до захоплення в порядку",
    accessUnknown: "Доступ перевіриться під час старту",
    permissionNeeded: "Потрібне одноразове виправлення доступу",
    npcapNeeded: "Одноразове налаштування: драйвер захоплення",
    npcapAdminOnly: "Драйвер встановлено, але обмежено адміністраторами",
    npcapInstalling: "Завантажуємо драйвер із npcap.com…",
    permissionFixCancelled:
      "Вікно пароля закрили, не завершивши, тож нічого не змінилося. Натисніть «Виправити доступ до захоплення» і введіть пароль Mac — цей запит і є все виправлення (у Системних налаштуваннях перемикача немає).",
    permissionFixFailed: (detail: string | null): string =>
      `Виправлення не завершилося${detail != null ? ` — macOS повідомив: ${detail}` : ""}. Спробуйте ще раз; якщо не допомагає — надішліть офіцерові лог застосунку.`,
    npcapInstalled: (version: string | null): string =>
      `Драйвер захоплення встановлено${version != null ? ` (Npcap ${version})` : ""} — натисніть «Почати запис».`,
    npcapNotCompleted:
      "Майстер драйвера закрили до завершення, тож нічого не встановлено. Натисніть «Встановити драйвер захоплення» і пройдіть майстер до кінця.",
    npcapCancelled:
      "Windows заблокував встановлення — потрібне ваше «Так» у запиті Windows. Спробуйте ще раз і підтвердьте.",
    npcapLaunchFailed: (detail: string | null): string =>
      `Не вдалося запустити інсталятор драйвера${detail != null ? ` (${detail})` : ""}. Скористайтеся «Завантажу сам» і запустіть його з теки Завантаження.`,
    npcapDownloadFailed:
      "Не вдалося дістатися npcap.com по драйвер. Перевірте з'єднання (VPN чи суворий фаєрвол можуть блокувати) і спробуйте ще раз — або «Завантажу сам».",
    npcapUntrusted:
      "Завантажений драйвер не мав дійсного підпису розробників, тож його НЕ запущено — таке буває, коли проксі чи антивірус змінює завантаження. Скористайтеся «Завантажу сам» просто з npcap.com.",
    permissionFixStillBlocked:
      "Виправлення встановлено, але macOS досі не дає доступу до захоплення. Закрийте застосунок і відкрийте знову; якщо повідомлення переживе перезавантаження — скажіть офіцерові.",
  },

  advanced: {
    summary: "Додатково",
    engineLabel: "Рушій",
    engineNotFound: "не знайдено — виберіть теку ao-loot-logger",
  },

  hero: {
    noCharacter: "ваш персонаж з'явиться з трафіком Albion",
  },
  settings: {
    gearLabel: "Налаштування",
    language: "Мова",
    system: "Системна",
    theme: "Тема",
    themeObsidian: "Обсидіан",
    themeParchment: "Пергамент",
    updates: "Оновлення",
    upToDate: "актуальна версія",
    checkUpdates: "Перевірити оновлення",
    checking: "перевіряємо…",
    updateOff: "У цій збірці автооновлення вимкнено — кнопка відкриє сторінку завантаження.",
    advancedEngine: "Додатково — рушій",
  },
  prefs: {
    autoCapture: "Починати запис, коли застосунок відкривається",
  },

  quitConfirm: {
    title: "Зупинити запис?",
    message: "Запис ще триває. Вийти й припинити логувати лут?",
    quit: "Зупинити і вийти",
    cancel: "Продовжити запис",
  },

  update: {
    downloading: (version: string | null, percent: number | null): string =>
      `Завантажуємо оновлення${version != null ? ` v${version}` : ""}…${percent != null ? ` ${percent}%` : ""}`,
    ready: (version: string | null): string =>
      `Оновлення${version != null ? ` v${version}` : ""} готове — встановиться, коли ви закриєте застосунок.`,
    restartNow: "Перезапустити й оновити",
    blockedCapturing: "Йде запис — оновлення встановиться після виходу, або спершу зупиніть запис.",
    failed: (detail: string | null): string =>
      `Не вдалося перевірити оновлення${detail != null ? ` (${detail})` : ""} — спробуємо пізніше. На запис це не впливає.`,
  },

  pairing: {
    intro: "Зв'яжіть цей комп'ютер один раз — і кожен запис потраплятиме на сторінку здобичі гільдії та в Discord.",
    step1: "У Discord вашої гільдії виконайте",
    step2: "Guild Butler відповість вашим кодом:",
    copy: "Копіювати",
    copied: "Скопійовано!",
    pairShort: "Зв'язати",
    more: "Більше опцій",
    title: "Надсилайте лут своїй гільдії",
    notPairedHint:
      "З'єднайте цей комп'ютер зі своїм Discord — і записаний лут сам летітиме до гільдії, без перетягування файлів. Виконайте /capture pair у Discord, щоб отримати код.",
    pairedAs: (device: string): string => `Підключено як ${device}`,
    codeLabel: "Код підключення",
    codePlaceholder: "XXXX-XXXX",
    pair: "Підключити Discord",
    pairing: "З'єднуємо…",
    unpair: "Відключити цей комп'ютер",
    viewLoot: "Мій лут",
    uploadToggle: "Надсилати лут автоматично",
    uploadOffHint: "Автонадсилання вимкнено. Запис усе одно пише лог-файл, і офіцери можуть узяти його вручну.",
    failBadCode:
      "Код виглядає неправильно. Це 8 символів із повідомлення Discord — перевірте, чи немає одруку, і спробуйте ще раз.",
    failRefused:
      "Discord-код не прийнято. Коди одноразові й живуть близько 10 хвилин — виконайте /capture pair ще раз по свіжий.",
    failUnreachable:
      "Не вдалося зв'язатися з ботом гільдії. Перевірте з'єднання (VPN чи суворий фаєрвол можуть блокувати) і спробуйте ще раз.",
    failBadReply: "Бот гільдії відповів щось, чого ця версія не розуміє. Можливо, його треба оновити.",
    failNotDeployed:
      "У бота вашої гільдії ще немає цієї функції — офіцер має його оновити. Новий код не допоможе. (Якщо ви міняли адресу сервера в Додатково — перевірте і її.)",
    failNoEncryption:
      "Цей комп'ютер не може зберігати з'єднання захищено, тож нічого не збережено — застосунок не триматиме токен входу в простому файлі. Запис працює; офіцери можуть узяти лог-файл вручну.",
    failStoreFailed: "Не вдалося зберегти з'єднання захищено. Спробуйте ще раз; якщо повторюється — скажіть офіцерові.",
    upDisabled: "Автонадсилання вимкнено",
    upUpToDate: (n: number): string => (n > 0 ? `Надіслано рядків: ${n}` : "Поки нічого надсилати"),
    upSending: "Надсилаємо…",
    upRetrying: "Щойно не вдалося надіслати — пробуємо знову. Ваш лог-файл цілий.",
    upUnauthorized: "Цей комп'ютер відключили в Discord. Підключіть його знову, щоб продовжити надсилання.",
    upBlocked: "Надсилання застрягло — скажіть офіцерові. Лог-файл цілий, його можна передати вручну.",
    upBotOutdated:
      "Бот гільдії ще не приймає завантаження — офіцер має його оновити. Запис триває; надсилання відновиться саме собою.",
  },

  footer: {
    engineCredit: "Рушій захоплення: ao-loot-logger (GPL-3.0, відкритий код)",
  },
};

/** Русский — machine-quality, wants a native proofread (same caveat as the bot). */
const RU: TStrings = {
  appName: "Guild Butler Capture",
  tagline: "Логирование лута Albion для вашей гильдии — без терминала.",

  status: {
    idle: "Запись не ведётся",
    starting: "Запускаем логгер…",
    waiting: "Ждём Albion…",
    capturing: "Идёт запись",
    stopping: "Останавливаем…",
    restarting: "Логгер споткнулся — перезапускаем…",
    error: "Что-то нужно исправить",
  },

  statusHint: {
    idle: "Нажмите «Начать запись», прежде чем идти в контент. Лут, подобранный рядом с вами, пишется в лог-файл, по которому офицеры сделают делёж.",
    starting: "Запускаем движок захвата.",
    waiting:
      "Логгер работает, но трафик Albion до него ещё не дошёл. Как только игра начнёт передавать данные, он подхватит их сам — можно оставлять запись включённой даже через перезапуск игры.",
    capturing: "Лут рядом с вами записывается в лог.",
    capturingAs: (character: string): string => `Лут рядом с ${character} записывается в лог.`,
    stopping: "Просим логгер дописать файл и завершить работу.",
    restarting: (seconds: number): string =>
      `Движок захвата неожиданно остановился. Он перезапустится сам через ${seconds} с — ваш лог-файл и счётчики целы.`,
  },

  waitingHints: {
    title: "Всё ещё ничего? Обычные причины:",
    items: [
      "Albion не запущен или стоит на экране входа — зайдите в игру и немного подвигайтесь.",
      "VPN или туннель (NordVPN, ExitLag, …) уводит трафик игры туда, где логгер его не видит. Выключите его на время записи.",
      "GeForce Now / облачный гейминг — игра идёт на их компьютере, поэтому её трафик сюда не попадает. Запись там невозможна.",
    ],
  },

  errors: {
    permissionTitle: "macOS блокирует захват сети",
    permission:
      "macOS разрешает наблюдать за сетевым трафиком только администраторам — поэтому старый скрипт требовал sudo. Нажмите «Исправить доступ к захвату» — один раз введёте пароль своего Mac, и исправление переживает перезагрузки. В Системных настройках переключателя для этого нет; запрос пароля от этого приложения — и есть всё исправление.",
    npcapMissingTitle: "Разовая настройка: драйвер захвата",
    npcapMissing:
      "Windows нужен небольшой бесплатный драйвер (Npcap), чтобы видеть трафик игры — лицензия не позволяет нам вкладывать его в приложение, поэтому оно скачивает его у разработчиков и запускает для вас. Нажмите «Установить драйвер захвата», подтвердите запрос Windows и пройдите короткий мастер кнопкой Next. Только один раз.",
    npcapAdminOnlyTitle: "Npcap ограничен администраторами",
    npcapAdminOnly:
      "Npcap установлен, но так, что захватывать могут только администраторы. Переустановите его, сняв галочку “Restrict Npcap driver's access to Administrators only”, или запустите это приложение от имени администратора.",
    abiMismatchTitle: "Движок захвата нужно пересобрать",
    abiMismatch:
      "Нативный модуль движка собран под другую среду, чем это приложение. Выполните шаг пересборки из README (pnpm engine:rebuild) и запустите приложение снова.",
    engineMissingTitle: "Движок захвата не найден",
    engineMissing:
      "Папка ao-loot-logger не найдена рядом с приложением. Укажите её в Дополнительно → «Выбрать папку движка».",
    crashTitle: "Логгер постоянно останавливается",
  },

  stats: {
    character: "Персонаж",
    characterUnknown: "определяется…",
    loot: "Событий лута за сессию",
    traffic: "Трафик Albion",
    trafficSeenAgo: (seconds: number): string => (seconds <= 2 ? "сейчас" : `${seconds} с назад`),
    trafficNotSeen: "ещё не виден",
    logFile: "Лог-файл",
    logFileNone: "появится после старта записи",
  },

  buttons: {
    start: "Начать запись",
    stop: "Остановить запись",
    reveal: "Показать",
    revealMac: "Показать в Finder",
    revealWin: "Показать в Проводнике",
    fixMacPermissions: "Исправить доступ к захвату…",
    installNpcap: "Установить драйвер захвата",
    getNpcap: "Скачаю сам",
    chooseEngine: "Выбрать папку движка…",
    details: "Технические детали",
  },

  setup: {
    engineOk: (source: string): string => `Движок захвата найден (${source})`,
    engineMissing: "Движок захвата не найден",
    accessOk: "Доступ к захвату в порядке",
    accessUnknown: "Доступ проверится при старте",
    permissionNeeded: "Нужно разовое исправление доступа",
    npcapNeeded: "Разовая настройка: драйвер захвата",
    npcapAdminOnly: "Драйвер установлен, но ограничен администраторами",
    npcapInstalling: "Скачиваем драйвер с npcap.com…",
    permissionFixCancelled:
      "Окно пароля закрыли, не завершив, поэтому ничего не изменилось. Нажмите «Исправить доступ к захвату» и введите пароль Mac — этот запрос и есть всё исправление (в Системных настройках переключателя нет).",
    permissionFixFailed: (detail: string | null): string =>
      `Исправление не завершилось${detail != null ? ` — macOS сообщил: ${detail}` : ""}. Попробуйте ещё раз; если не помогает — отправьте офицеру лог приложения.`,
    npcapInstalled: (version: string | null): string =>
      `Драйвер захвата установлен${version != null ? ` (Npcap ${version})` : ""} — нажмите «Начать запись».`,
    npcapNotCompleted:
      "Мастер драйвера закрыли до завершения, поэтому ничего не установлено. Нажмите «Установить драйвер захвата» и пройдите мастер до конца.",
    npcapCancelled:
      "Windows заблокировал установку — нужно ваше «Да» в запросе Windows. Попробуйте ещё раз и подтвердите.",
    npcapLaunchFailed: (detail: string | null): string =>
      `Не удалось запустить установщик драйвера${detail != null ? ` (${detail})` : ""}. Используйте «Скачаю сам» и запустите его из папки Загрузки.`,
    npcapDownloadFailed:
      "Не удалось добраться до npcap.com за драйвером. Проверьте соединение (VPN или строгий файрвол могут блокировать) и попробуйте ещё раз — или «Скачаю сам».",
    npcapUntrusted:
      "Скачанный драйвер не имел действительной подписи разработчиков, поэтому он НЕ был запущен — так бывает, когда прокси или антивирус меняет загрузку. Используйте «Скачаю сам» прямо с npcap.com.",
    permissionFixStillBlocked:
      "Исправление установлено, но macOS всё ещё не даёт доступа к захвату. Закройте приложение и откройте снова; если сообщение переживёт перезагрузку — скажите офицеру.",
  },

  advanced: {
    summary: "Дополнительно",
    engineLabel: "Движок",
    engineNotFound: "не найден — выберите папку ao-loot-logger",
  },

  hero: {
    noCharacter: "ваш персонаж появится с трафиком Albion",
  },
  settings: {
    gearLabel: "Настройки",
    language: "Язык",
    system: "Системный",
    theme: "Тема",
    themeObsidian: "Обсидиан",
    themeParchment: "Пергамент",
    updates: "Обновления",
    upToDate: "актуальная версия",
    checkUpdates: "Проверить обновления",
    checking: "проверяем…",
    updateOff: "В этой сборке автообновление выключено — кнопка откроет страницу загрузки.",
    advancedEngine: "Дополнительно — движок",
  },
  prefs: {
    autoCapture: "Начинать запись при открытии приложения",
  },

  quitConfirm: {
    title: "Остановить запись?",
    message: "Запись ещё идёт. Выйти и перестать логировать лут?",
    quit: "Остановить и выйти",
    cancel: "Продолжить запись",
  },

  update: {
    downloading: (version: string | null, percent: number | null): string =>
      `Скачиваем обновление${version != null ? ` v${version}` : ""}…${percent != null ? ` ${percent}%` : ""}`,
    ready: (version: string | null): string =>
      `Обновление${version != null ? ` v${version}` : ""} готово — установится, когда вы закроете приложение.`,
    restartNow: "Перезапустить и обновить",
    blockedCapturing: "Идёт запись — обновление установится после выхода, или сначала остановите запись.",
    failed: (detail: string | null): string =>
      `Не удалось проверить обновления${detail != null ? ` (${detail})` : ""} — попробуем позже. На запись это не влияет.`,
  },

  pairing: {
    intro: "Свяжите этот компьютер один раз — и каждая запись будет попадать на страницу добычи гильдии и в Discord.",
    step1: "В Discord вашей гильдии выполните",
    step2: "Guild Butler ответит вашим кодом:",
    copy: "Копировать",
    copied: "Скопировано!",
    pairShort: "Связать",
    more: "Больше опций",
    title: "Отправляйте лут своей гильдии",
    notPairedHint:
      "Соедините этот компьютер со своим Discord — и записанный лут сам полетит в гильдию, без перетаскивания файлов. Выполните /capture pair в Discord, чтобы получить код.",
    pairedAs: (device: string): string => `Подключено как ${device}`,
    codeLabel: "Код подключения",
    codePlaceholder: "XXXX-XXXX",
    pair: "Подключить Discord",
    pairing: "Соединяем…",
    unpair: "Отключить этот компьютер",
    viewLoot: "Мой лут",
    uploadToggle: "Отправлять лут автоматически",
    uploadOffHint: "Автоотправка выключена. Запись всё равно пишет лог-файл, и офицеры могут взять его вручную.",
    failBadCode:
      "Код выглядит неправильно. Это 8 символов из сообщения Discord — проверьте опечатку и попробуйте ещё раз.",
    failRefused:
      "Discord-код не принят. Коды одноразовые и живут около 10 минут — выполните /capture pair ещё раз за свежим.",
    failUnreachable:
      "Не удалось связаться с ботом гильдии. Проверьте соединение (VPN или строгий файрвол могут блокировать) и попробуйте ещё раз.",
    failBadReply: "Бот гильдии ответил что-то, чего эта версия не понимает. Возможно, его нужно обновить.",
    failNotDeployed:
      "У бота вашей гильдии ещё нет этой функции — офицер должен его обновить. Новый код не поможет. (Если вы меняли адрес сервера в Дополнительно — проверьте и его.)",
    failNoEncryption:
      "Этот компьютер не может хранить подключение защищённо, поэтому ничего не сохранено — приложение не будет держать токен входа в простом файле. Запись работает; офицеры могут взять лог-файл вручную.",
    failStoreFailed:
      "Не удалось сохранить подключение защищённо. Попробуйте ещё раз; если повторяется — скажите офицеру.",
    upDisabled: "Автоотправка выключена",
    upUpToDate: (n: number): string => (n > 0 ? `Отправлено строк: ${n}` : "Пока нечего отправлять"),
    upSending: "Отправляем…",
    upRetrying: "Только что не удалось отправить — пробуем снова. Ваш лог-файл цел.",
    upUnauthorized: "Этот компьютер отключили в Discord. Подключите его снова, чтобы продолжить отправку.",
    upBlocked: "Отправка застряла — скажите офицеру. Лог-файл цел, его можно передать вручную.",
    upBotOutdated:
      "Бот гильдии ещё не принимает загрузки — офицер должен его обновить. Запись продолжается; отправка возобновится сама.",
  },

  footer: {
    engineCredit: "Движок захвата: ao-loot-logger (GPL-3.0, открытый код)",
  },
};

/** Deutsch — machine-quality, wants a native proofread (same caveat as the bot). */
const DE: TStrings = {
  appName: "Guild Butler Capture",
  tagline: "Albion-Loot-Logging für deine Gilde — ganz ohne Terminal.",

  status: {
    idle: "Keine Aufzeichnung",
    starting: "Logger wird gestartet…",
    waiting: "Warten auf Albion…",
    capturing: "Aufzeichnung läuft",
    stopping: "Wird gestoppt…",
    restarting: "Der Logger ist gestolpert — Neustart…",
    error: "Etwas muss behoben werden",
  },

  statusHint: {
    idle: "Drücke Start, bevor du in den Content gehst. Loot, der in deiner Nähe aufgehoben wird, landet in einer Log-Datei, aus der deine Offiziere abrechnen können.",
    starting: "Die Capture-Engine wird hochgefahren.",
    waiting:
      "Der Logger läuft, aber es ist noch kein Albion-Traffic angekommen. Sobald das Spiel Daten erzeugt, greift er sie von selbst auf — die Aufzeichnung darf auch über einen Spielneustart hinweg laufen.",
    capturing: "Loot-Ereignisse in deiner Nähe werden ins Log geschrieben.",
    capturingAs: (character: string): string => `Loot-Ereignisse bei ${character} werden ins Log geschrieben.`,
    stopping: "Der Logger schreibt zu Ende und fährt herunter.",
    restarting: (seconds: number): string =>
      `Die Capture-Engine hat unerwartet gestoppt. Sie startet in ${seconds} s von selbst neu — Log-Datei und Zähler sind sicher.`,
  },

  waitingHints: {
    title: "Immer noch nichts? Die üblichen Gründe:",
    items: [
      "Albion läuft nicht oder hängt im Login-Bildschirm — geh ins Spiel und beweg dich ein wenig.",
      "Ein VPN oder Tunnel (NordVPN, ExitLag, …) leitet den Spiel-Traffic dorthin, wo der Logger ihn nicht sieht. Schalte ihn während der Aufzeichnung aus.",
      "GeForce Now / Cloud-Gaming — das Spiel läuft auf deren Rechner, sein Traffic erreicht diesen hier nie. Aufzeichnung ist dort unmöglich.",
    ],
  },

  errors: {
    permissionTitle: "macOS blockiert die Netzwerkaufzeichnung",
    permission:
      "macOS erlaubt nur Administratoren, Netzwerkverkehr zu beobachten — deshalb brauchte das alte Skript sudo. Klicke auf „Capture-Berechtigung reparieren“ — du wirst einmal nach deinem Mac-Passwort gefragt, und die Korrektur überlebt Neustarts. In den Systemeinstellungen gibt es dafür keinen Schalter; die Passwortabfrage dieser App ist die ganze Korrektur.",
    npcapMissingTitle: "Einmalige Einrichtung: der Capture-Treiber",
    npcapMissing:
      "Windows braucht einen kleinen kostenlosen Treiber (Npcap), um Spiel-Traffic sehen zu können — die Lizenz erlaubt uns nicht, ihn beizulegen, also holt die App ihn von den Herstellern und startet ihn für dich. Klicke auf „Capture-Treiber installieren“, bestätige die Windows-Abfrage und klicke dich mit Next durch den kurzen Assistenten. Nur einmal.",
    npcapAdminOnlyTitle: "Npcap ist auf Administratoren beschränkt",
    npcapAdminOnly:
      "Npcap ist installiert, aber so, dass nur Administratoren aufzeichnen dürfen. Installiere es neu und entferne dabei den Haken bei “Restrict Npcap driver's access to Administrators only”, oder starte diese App als Administrator.",
    abiMismatchTitle: "Die Capture-Engine braucht einen Rebuild",
    abiMismatch:
      "Das native Capture-Modul der Engine wurde für eine andere Laufzeit gebaut als diese App. Führe den Rebuild-Schritt aus dem README aus (pnpm engine:rebuild) und starte die App erneut.",
    engineMissingTitle: "Capture-Engine nicht gefunden",
    engineMissing:
      "Der Ordner ao-loot-logger wurde neben dieser App nicht gefunden. Zeige unter Erweitert → „Engine-Ordner wählen“ darauf.",
    crashTitle: "Der Logger stoppt immer wieder",
  },

  stats: {
    character: "Charakter",
    characterUnknown: "wird erkannt…",
    loot: "Loot-Ereignisse diese Sitzung",
    traffic: "Albion-Traffic",
    trafficSeenAgo: (seconds: number): string => (seconds <= 2 ? "live" : `vor ${seconds} s gesehen`),
    trafficNotSeen: "noch nicht gesehen",
    logFile: "Log-Datei",
    logFileNone: "entsteht beim Start der Aufzeichnung",
  },

  buttons: {
    start: "Aufzeichnung starten",
    stop: "Aufzeichnung stoppen",
    reveal: "Anzeigen",
    revealMac: "Im Finder anzeigen",
    revealWin: "Im Explorer anzeigen",
    fixMacPermissions: "Capture-Berechtigung reparieren…",
    installNpcap: "Capture-Treiber installieren",
    getNpcap: "Selbst herunterladen",
    chooseEngine: "Engine-Ordner wählen…",
    details: "Technische Details",
  },

  setup: {
    engineOk: (source: string): string => `Capture-Engine gefunden (${source})`,
    engineMissing: "Capture-Engine nicht gefunden",
    accessOk: "Capture-Berechtigung sieht gut aus",
    accessUnknown: "Die Berechtigung wird beim Start geprüft",
    permissionNeeded: "Einmalige Berechtigungskorrektur nötig",
    npcapNeeded: "Einmalige Einrichtung nötig: der Capture-Treiber",
    npcapAdminOnly: "Der Capture-Treiber ist installiert, aber auf Administratoren beschränkt",
    npcapInstalling: "Der Capture-Treiber wird von npcap.com geholt…",
    permissionFixCancelled:
      "Die Passwortabfrage wurde geschlossen, ohne sie abzuschließen — es wurde nichts geändert. Klicke auf „Capture-Berechtigung reparieren“ und gib dein Mac-Passwort ein — diese Abfrage ist die ganze Korrektur (die Systemeinstellungen haben dafür keinen Schalter).",
    permissionFixFailed: (detail: string | null): string =>
      `Die Berechtigungskorrektur wurde nicht abgeschlossen${detail != null ? ` — macOS meldet: ${detail}` : ""}. Versuch es erneut; wenn es weiter fehlschlägt, schick deinem Offizier das App-Log.`,
    npcapInstalled: (version: string | null): string =>
      `Capture-Treiber installiert${version != null ? ` (Npcap ${version})` : ""} — drücke „Aufzeichnung starten“.`,
    npcapNotCompleted:
      "Der Treiber-Assistent wurde vor dem Ende geschlossen, es wurde nichts installiert. Klicke auf „Capture-Treiber installieren“ und geh mit Next bis zum Schluss durch.",
    npcapCancelled:
      "Windows hat die Treiberinstallation blockiert — sie braucht dein „Ja“ in der Windows-Abfrage. Versuch es erneut und bestätige.",
    npcapLaunchFailed: (detail: string | null): string =>
      `Der Treiber-Installer konnte nicht gestartet werden${detail != null ? ` (${detail})` : ""}. Nutze „Selbst herunterladen“ und starte ihn aus deinem Downloads-Ordner.`,
    npcapDownloadFailed:
      "npcap.com war für den Treiber nicht erreichbar. Prüfe deine Verbindung (ein VPN oder eine strenge Firewall kann blockieren) und versuch es erneut, oder nutze „Selbst herunterladen“.",
    npcapUntrusted:
      "Der heruntergeladene Treiber trug keine gültige Signatur seiner Hersteller und wurde deshalb NICHT ausgeführt — das kann heißen, dass ein Proxy oder Antivirus den Download verändert hat. Nutze „Selbst herunterladen“ direkt von npcap.com.",
    permissionFixStillBlocked:
      "Die Korrektur wurde installiert, aber macOS meldet weiterhin keinen Capture-Zugriff. Beende die App und öffne sie erneut; überlebt diese Meldung einen Neustart, sag deinem Offizier Bescheid.",
  },

  advanced: {
    summary: "Erweitert",
    engineLabel: "Engine",
    engineNotFound: "nicht gefunden — wähle den ao-loot-logger-Ordner",
  },

  hero: {
    noCharacter: "dein Charakter erscheint mit Albion-Traffic",
  },
  settings: {
    gearLabel: "Einstellungen",
    language: "Sprache",
    system: "System",
    theme: "Design",
    themeObsidian: "Obsidian",
    themeParchment: "Pergament",
    updates: "Updates",
    upToDate: "auf dem neuesten Stand",
    checkUpdates: "Nach Updates suchen",
    checking: "wird geprüft…",
    updateOff: "Auto-Update ist in diesem Build aus — der Knopf öffnet die Download-Seite.",
    advancedEngine: "Erweitert — Engine",
  },
  prefs: {
    autoCapture: "Aufzeichnung beim Öffnen der App starten",
  },

  quitConfirm: {
    title: "Aufzeichnung stoppen?",
    message: "Die Aufzeichnung läuft noch. Beenden und aufhören, Loot zu loggen?",
    quit: "Stoppen und beenden",
    cancel: "Weiter aufzeichnen",
  },

  update: {
    downloading: (version: string | null, percent: number | null): string =>
      `Update wird geladen${version != null ? ` v${version}` : ""}…${percent != null ? ` ${percent}%` : ""}`,
    ready: (version: string | null): string =>
      `Update${version != null ? ` v${version}` : ""} bereit — es wird installiert, wenn du die App beendest.`,
    restartNow: "Neu starten und aktualisieren",
    blockedCapturing:
      "Die Aufzeichnung läuft — das Update wird beim Beenden installiert, oder stoppe zuerst die Aufzeichnung.",
    failed: (detail: string | null): string =>
      `Update-Prüfung fehlgeschlagen${detail != null ? ` (${detail})` : ""} — wird später erneut versucht. Die Aufzeichnung ist nicht betroffen.`,
  },

  pairing: {
    intro: "Verknüpfe diesen Computer einmal — jede Aufzeichnung landet auf der Beuteseite deiner Gilde und in Discord.",
    step1: "Führe im Discord deiner Gilde aus:",
    step2: "Guild Butler antwortet mit deinem Code:",
    copy: "Kopieren",
    copied: "Kopiert!",
    pairShort: "Verbinden",
    more: "Mehr Optionen",
    title: "Schick deiner Gilde den Loot",
    notPairedHint:
      "Verbinde diesen Rechner mit deinem Discord-Konto, und aufgezeichneter Loot geht von selbst an deine Gilde — kein Dateien-Herumschieben. Führe /capture pair in Discord aus, um einen Code zu bekommen.",
    pairedAs: (device: string): string => `Verbunden als ${device}`,
    codeLabel: "Kopplungscode",
    codePlaceholder: "XXXX-XXXX",
    pair: "Mit Discord koppeln",
    pairing: "Verbinden…",
    unpair: "Diesen Rechner trennen",
    viewLoot: "Mein Loot",
    uploadToggle: "Loot automatisch senden",
    uploadOffHint:
      "Auto-Senden ist aus. Die Aufzeichnung schreibt trotzdem die Log-Datei, und Offiziere können sie von Hand nehmen.",
    failBadCode:
      "Der Code sieht nicht richtig aus. Es sind 8 Zeichen aus der Discord-Nachricht — prüfe auf einen Tippfehler und versuch es erneut.",
    failRefused:
      "Der Discord-Code wurde nicht akzeptiert. Codes gelten einmal und laufen nach etwa 10 Minuten ab — führe /capture pair erneut aus für einen frischen.",
    failUnreachable:
      "Der Bot deiner Gilde war nicht erreichbar. Prüfe deine Verbindung (ein VPN oder eine strenge Firewall kann blockieren) und versuch es erneut.",
    failBadReply:
      "Der Bot deiner Gilde hat etwas geantwortet, das diese Version nicht versteht. Er braucht vielleicht ein Update.",
    failNotDeployed:
      "Der Bot deiner Gilde hat dieses Feature noch nicht — ein Offizier muss ihn aktualisieren. Ein neuer Code hilft nicht. (Wenn du unter Erweitert die Serveradresse geändert hast, prüfe auch die.)",
    failNoEncryption:
      "Dieser Rechner kann die Verbindung nicht sicher speichern, also wurde nichts gespeichert — die App legt keinen Login-Token in eine einfache Datei. Die Aufzeichnung funktioniert; Offiziere können die Log-Datei von Hand nehmen.",
    failStoreFailed:
      "Die Verbindung konnte nicht sicher gespeichert werden. Versuch es erneut; wenn es dabei bleibt, sag deinem Offizier Bescheid.",
    upDisabled: "Auto-Senden aus",
    upUpToDate: (n: number): string => (n > 0 ? `${n} Zeilen gesendet` : "Noch nichts zu senden"),
    upSending: "Senden…",
    upRetrying: "Senden ist gerade fehlgeschlagen — neuer Versuch läuft. Deine Log-Datei ist sicher.",
    upUnauthorized: "Dieser Rechner wurde in Discord getrennt. Kopple ihn erneut, um weiterzusenden.",
    upBlocked:
      "Das Senden hängt fest — sag deinem Offizier Bescheid. Deine Log-Datei ist sicher und kann von Hand übergeben werden.",
    upBotOutdated:
      "Der Bot deiner Gilde nimmt noch keine Uploads an — ein Offizier muss ihn aktualisieren. Die Aufzeichnung läuft weiter, und das Senden setzt von selbst wieder ein.",
  },

  footer: {
    engineCredit: "Capture-Engine: ao-loot-logger (GPL-3.0, Open Source)",
  },
};

/** Français — machine-quality, wants a native proofread (same caveat as the bot). */
const FR: TStrings = {
  appName: "Guild Butler Capture",
  tagline: "Le journal de loot Albion pour votre guilde — sans terminal.",

  status: {
    idle: "Pas de capture",
    starting: "Démarrage du logger…",
    waiting: "En attente d'Albion…",
    capturing: "Capture en cours",
    stopping: "Arrêt…",
    restarting: "Le logger a trébuché — redémarrage…",
    error: "Quelque chose à corriger",
  },

  statusHint: {
    idle: "Appuyez sur Démarrer avant de partir en contenu. Le loot ramassé près de vous est écrit dans un fichier journal que vos officiers pourront régler.",
    starting: "Mise en route du moteur de capture.",
    waiting:
      "Le logger tourne, mais aucun trafic Albion ne lui est encore parvenu. Dès que le jeu produit du trafic, il le capte tout seul — le laisser tourner à travers un redémarrage du jeu ne pose aucun souci.",
    capturing: "Les événements de loot près de vous sont écrits dans le journal.",
    capturingAs: (character: string): string =>
      `Les événements de loot près de ${character} sont écrits dans le journal.`,
    stopping: "On demande au logger de finir d'écrire et de s'arrêter.",
    restarting: (seconds: number): string =>
      `Le moteur de capture s'est arrêté de façon inattendue. Il redémarre tout seul dans ${seconds} s — votre journal et vos compteurs sont saufs.`,
  },

  waitingHints: {
    title: "Toujours rien ? Les raisons habituelles :",
    items: [
      "Albion n'est pas lancé, ou reste sur l'écran de connexion — entrez en jeu et bougez un peu.",
      "Un VPN ou un tunnel (NordVPN, ExitLag, …) emmène le trafic du jeu là où le logger ne le voit pas. Coupez-le pendant la capture.",
      "GeForce Now / cloud gaming — le jeu tourne sur leur machine, son trafic n'atteint jamais celle-ci. La capture y est impossible.",
    ],
  },

  errors: {
    permissionTitle: "macOS bloque la capture réseau",
    permission:
      "macOS ne laisse observer le trafic réseau qu'aux administrateurs — c'est pour cela que l'ancien script exigeait sudo. Cliquez sur « Réparer l'autorisation de capture » — votre mot de passe Mac vous sera demandé une fois, et la correction survit aux redémarrages. Il n'existe aucun interrupteur pour cela dans Réglages Système ; l'invite de mot de passe de cette app est toute la correction.",
    npcapMissingTitle: "Réglage unique : le pilote de capture",
    npcapMissing:
      "Windows a besoin d'un petit pilote gratuit (Npcap) pour voir le trafic du jeu — sa licence ne nous permet pas de l'inclure, alors l'app va le chercher chez ses auteurs et le lance pour vous. Cliquez sur « Installer le pilote de capture », dites oui à Windows, puis Next à travers le court assistant. Une seule fois.",
    npcapAdminOnlyTitle: "Npcap est réservé aux administrateurs",
    npcapAdminOnly:
      "Npcap est installé, mais de façon à ce que seuls les administrateurs puissent capturer. Réinstallez-le en décochant “Restrict Npcap driver's access to Administrators only”, ou lancez cette app en administrateur.",
    abiMismatchTitle: "Le moteur de capture doit être recompilé",
    abiMismatch:
      "Le module natif du moteur a été compilé pour un autre environnement que cette app. Exécutez l'étape de recompilation du README (pnpm engine:rebuild), puis relancez l'app.",
    engineMissingTitle: "Moteur de capture introuvable",
    engineMissing:
      "Le dossier ao-loot-logger n'a pas été trouvé à côté de cette app. Indiquez-le dans Avancé → « Choisir le dossier du moteur ».",
    crashTitle: "Le logger s'arrête sans cesse",
  },

  stats: {
    character: "Personnage",
    characterUnknown: "détection…",
    loot: "Événements de loot cette session",
    traffic: "Trafic Albion",
    trafficSeenAgo: (seconds: number): string => (seconds <= 2 ? "en direct" : `vu il y a ${seconds} s`),
    trafficNotSeen: "pas encore vu",
    logFile: "Fichier journal",
    logFileNone: "créé au démarrage de la capture",
  },

  buttons: {
    start: "Démarrer la capture",
    stop: "Arrêter la capture",
    reveal: "Afficher",
    revealMac: "Afficher dans le Finder",
    revealWin: "Afficher dans l'Explorateur",
    fixMacPermissions: "Réparer l'autorisation de capture…",
    installNpcap: "Installer le pilote de capture",
    getNpcap: "Le télécharger moi-même",
    chooseEngine: "Choisir le dossier du moteur…",
    details: "Détails techniques",
  },

  setup: {
    engineOk: (source: string): string => `Moteur de capture trouvé (${source})`,
    engineMissing: "Moteur de capture introuvable",
    accessOk: "L'autorisation de capture semble bonne",
    accessUnknown: "L'autorisation sera vérifiée au démarrage",
    permissionNeeded: "Correction d'autorisation unique nécessaire",
    npcapNeeded: "Réglage unique nécessaire : le pilote de capture",
    npcapAdminOnly: "Le pilote de capture est installé mais réservé aux administrateurs",
    npcapInstalling: "Récupération du pilote depuis npcap.com…",
    permissionFixCancelled:
      "L'invite de mot de passe a été fermée sans aller au bout, rien n'a donc changé. Cliquez sur « Réparer l'autorisation de capture » et saisissez votre mot de passe Mac — cette invite est toute la correction (Réglages Système n'a pas d'interrupteur pour cela).",
    permissionFixFailed: (detail: string | null): string =>
      `La correction ne s'est pas terminée${detail != null ? ` — macOS dit : ${detail}` : ""}. Réessayez ; si cela continue d'échouer, envoyez le journal de l'app à votre officier.`,
    npcapInstalled: (version: string | null): string =>
      `Pilote de capture installé${version != null ? ` (Npcap ${version})` : ""} — appuyez sur « Démarrer la capture ».`,
    npcapNotCompleted:
      "L'assistant du pilote a été fermé avant la fin, rien n'a donc été installé. Cliquez sur « Installer le pilote de capture » et faites Next jusqu'au bout.",
    npcapCancelled:
      "Windows a bloqué l'installation du pilote — il lui faut votre « Oui » à l'invite Windows. Réessayez et acceptez-la.",
    npcapLaunchFailed: (detail: string | null): string =>
      `L'installeur du pilote n'a pas pu démarrer${detail != null ? ` (${detail})` : ""}. Utilisez « Le télécharger moi-même » et lancez-le depuis votre dossier Téléchargements.`,
    npcapDownloadFailed:
      "Impossible d'atteindre npcap.com pour récupérer le pilote. Vérifiez votre connexion (un VPN ou un pare-feu strict peut bloquer) et réessayez, ou utilisez « Le télécharger moi-même ».",
    npcapUntrusted:
      "Le pilote téléchargé ne portait pas de signature valide de ses auteurs, il n'a donc PAS été lancé — cela peut vouloir dire qu'un proxy ou un antivirus a altéré le téléchargement. Utilisez « Le télécharger moi-même » directement sur npcap.com.",
    permissionFixStillBlocked:
      "La correction est installée, mais macOS signale toujours l'absence d'accès à la capture. Quittez et rouvrez l'app ; si ce message survit à un redémarrage, dites-le à votre officier.",
  },

  advanced: {
    summary: "Avancé",
    engineLabel: "Moteur",
    engineNotFound: "introuvable — choisissez le dossier ao-loot-logger",
  },

  hero: {
    noCharacter: "ton personnage apparaît avec le trafic Albion",
  },
  settings: {
    gearLabel: "Réglages",
    language: "Langue",
    system: "Système",
    theme: "Thème",
    themeObsidian: "Obsidienne",
    themeParchment: "Parchemin",
    updates: "Mises à jour",
    upToDate: "à jour",
    checkUpdates: "Vérifier les mises à jour",
    checking: "vérification…",
    updateOff: "La mise à jour auto est désactivée dans cette version — le bouton ouvre la page de téléchargement.",
    advancedEngine: "Avancé — moteur",
  },
  prefs: {
    autoCapture: "Démarrer la capture à l'ouverture de l'app",
  },

  quitConfirm: {
    title: "Arrêter la capture ?",
    message: "La capture tourne encore. Quitter et cesser de journaliser le loot ?",
    quit: "Arrêter et quitter",
    cancel: "Continuer la capture",
  },

  update: {
    downloading: (version: string | null, percent: number | null): string =>
      `Téléchargement de la mise à jour${version != null ? ` v${version}` : ""}…${percent != null ? ` ${percent}%` : ""}`,
    ready: (version: string | null): string =>
      `Mise à jour${version != null ? ` v${version}` : ""} prête — elle s'installe quand vous quittez l'app.`,
    restartNow: "Redémarrer et mettre à jour",
    blockedCapturing:
      "La capture est en cours — la mise à jour s'installe quand vous quittez, ou arrêtez d'abord la capture.",
    failed: (detail: string | null): string =>
      `Échec de la vérification de mise à jour${detail != null ? ` (${detail})` : ""} — nouvel essai plus tard. La capture n'est pas affectée.`,
  },

  pairing: {
    intro: "Associe cet ordinateur une fois — chaque capture arrive sur la page de butin de ta guilde et sur Discord.",
    step1: "Dans le Discord de ta guilde, lance",
    step2: "Guild Butler répond avec ton code :",
    copy: "Copier",
    copied: "Copié !",
    pairShort: "Associer",
    more: "Plus d'options",
    title: "Envoyez le loot à votre guilde",
    notPairedHint:
      "Connectez cet ordinateur à votre compte Discord et le loot capturé part tout seul vers votre guilde — plus de fichiers à trimballer. Lancez /capture pair dans Discord pour obtenir un code.",
    pairedAs: (device: string): string => `Connecté en tant que ${device}`,
    codeLabel: "Code d'appairage",
    codePlaceholder: "XXXX-XXXX",
    pair: "Appairer avec Discord",
    pairing: "Connexion…",
    unpair: "Déconnecter cet ordinateur",
    viewLoot: "Voir mon loot",
    uploadToggle: "Envoyer le loot automatiquement",
    uploadOffHint:
      "L'envoi auto est coupé. La capture écrit quand même le fichier journal, et les officiers peuvent le prendre à la main.",
    failBadCode:
      "Ce code n'a pas l'air bon. Ce sont 8 caractères du message que Discord vous a envoyé — vérifiez la faute de frappe et réessayez.",
    failRefused:
      "Le code Discord n'a pas été accepté. Les codes servent une fois et expirent après environ 10 minutes — relancez /capture pair pour en avoir un frais.",
    failUnreachable:
      "Impossible de joindre le bot de votre guilde. Vérifiez votre connexion (un VPN ou un pare-feu strict peut bloquer) et réessayez.",
    failBadReply:
      "Le bot de votre guilde a répondu quelque chose que cette version ne comprend pas. Il a peut-être besoin d'une mise à jour.",
    failNotDeployed:
      "Le bot de votre guilde n'a pas encore cette fonction — un officier doit le mettre à jour. Un autre code n'y changera rien. (Si vous avez changé l'adresse du serveur dans Avancé, vérifiez-la aussi.)",
    failNoEncryption:
      "Cet ordinateur ne peut pas stocker la connexion de façon sécurisée, rien n'a donc été enregistré — l'app ne gardera pas un jeton de connexion dans un simple fichier. La capture fonctionne ; les officiers peuvent prendre le fichier journal à la main.",
    failStoreFailed:
      "Impossible d'enregistrer la connexion de façon sécurisée. Réessayez ; si cela persiste, dites-le à votre officier.",
    upDisabled: "Envoi auto coupé",
    upUpToDate: (n: number): string => (n > 0 ? `${n} lignes envoyées` : "Rien à envoyer pour l'instant"),
    upSending: "Envoi…",
    upRetrying: "L'envoi vient d'échouer — nouvel essai en cours. Votre fichier journal est sauf.",
    upUnauthorized: "Cet ordinateur a été déconnecté dans Discord. Appairez-le de nouveau pour reprendre l'envoi.",
    upBlocked:
      "L'envoi est bloqué — dites-le à votre officier. Votre fichier journal est sauf et peut être remis à la main.",
    upBotOutdated:
      "Le bot de votre guilde n'accepte pas encore les envois — un officier doit le mettre à jour. La capture continue, et l'envoi reprendra tout seul.",
  },

  footer: {
    engineCredit: "Moteur de capture : ao-loot-logger (GPL-3.0, open source)",
  },
};

/** Português — machine-quality, wants a native proofread (same caveat as the bot). */
const PT: TStrings = {
  appName: "Guild Butler Capture",
  tagline: "Registro de loot do Albion para a sua guilda — sem terminal.",

  status: {
    idle: "Sem captura",
    starting: "Iniciando o logger…",
    waiting: "Esperando o Albion…",
    capturing: "Capturando",
    stopping: "Parando…",
    restarting: "O logger tropeçou — reiniciando…",
    error: "Algo precisa de conserto",
  },

  statusHint: {
    idle: "Aperte Iniciar antes de partir para o conteúdo. O loot pego perto de você é escrito em um arquivo de log com que seus oficiais fazem o acerto.",
    starting: "Colocando o motor de captura para rodar.",
    waiting:
      "O logger está rodando, mas nenhum tráfego do Albion chegou até ele ainda. Assim que o jogo produzir tráfego, ele capta sozinho — pode deixar rodando mesmo através de um reinício do jogo.",
    capturing: "Eventos de loot perto de você estão sendo escritos no log.",
    capturingAs: (character: string): string => `Eventos de loot perto de ${character} estão sendo escritos no log.`,
    stopping: "Pedindo ao logger para terminar de escrever e encerrar.",
    restarting: (seconds: number): string =>
      `O motor de captura parou de repente. Ele reinicia sozinho em ${seconds}s — seu arquivo de log e as contagens estão a salvo.`,
  },

  waitingHints: {
    title: "Ainda nada? Os motivos de sempre:",
    items: [
      "O Albion não está aberto, ou está parado na tela de login — entre no jogo e se mexa um pouco.",
      "Uma VPN ou túnel (NordVPN, ExitLag, …) está levando o tráfego do jogo para onde o logger não vê. Desligue durante a captura.",
      "GeForce Now / cloud gaming — o jogo roda no computador deles, então o tráfego nunca chega neste aqui. A captura não funciona lá.",
    ],
  },

  errors: {
    permissionTitle: "O macOS está bloqueando a captura de rede",
    permission:
      "O macOS só deixa administradores observarem o tráfego de rede — por isso o script antigo precisava de sudo. Clique em “Consertar permissão de captura” — sua senha do Mac será pedida uma vez, e o conserto sobrevive a reinicializações. Não existe chave para isso nos Ajustes do Sistema; o pedido de senha deste app é o conserto inteiro.",
    npcapMissingTitle: "Configuração única: o driver de captura",
    npcapMissing:
      "O Windows precisa de um pequeno driver gratuito (Npcap) para ver o tráfego do jogo — a licença não nos deixa incluí-lo, então o app baixa dos autores e inicia para você. Clique em “Instalar driver de captura”, diga sim ao Windows e vá de Next pelo assistente curto. Uma vez só.",
    npcapAdminOnlyTitle: "O Npcap está restrito a administradores",
    npcapAdminOnly:
      "O Npcap está instalado, mas de um jeito que só Administradores podem capturar. Reinstale desmarcando “Restrict Npcap driver's access to Administrators only”, ou rode este app como administrador.",
    abiMismatchTitle: "O motor de captura precisa de um rebuild",
    abiMismatch:
      "O módulo nativo do motor foi compilado para outro ambiente que não este app. Rode o passo de rebuild do README (pnpm engine:rebuild) e abra o app de novo.",
    engineMissingTitle: "Motor de captura não encontrado",
    engineMissing:
      "A pasta ao-loot-logger não foi encontrada ao lado deste app. Aponte para ela em Avançado → “Escolher pasta do motor”.",
    crashTitle: "O logger vive parando",
  },

  stats: {
    character: "Personagem",
    characterUnknown: "detectando…",
    loot: "Eventos de loot nesta sessão",
    traffic: "Tráfego do Albion",
    trafficSeenAgo: (seconds: number): string => (seconds <= 2 ? "ao vivo" : `visto há ${seconds}s`),
    trafficNotSeen: "ainda não visto",
    logFile: "Arquivo de log",
    logFileNone: "criado quando a captura começa",
  },

  buttons: {
    start: "Iniciar captura",
    stop: "Parar captura",
    reveal: "Mostrar",
    revealMac: "Mostrar no Finder",
    revealWin: "Mostrar no Explorer",
    fixMacPermissions: "Consertar permissão de captura…",
    installNpcap: "Instalar driver de captura",
    getNpcap: "Baixar eu mesmo",
    chooseEngine: "Escolher pasta do motor…",
    details: "Detalhes técnicos",
  },

  setup: {
    engineOk: (source: string): string => `Motor de captura encontrado (${source})`,
    engineMissing: "Motor de captura não encontrado",
    accessOk: "A permissão de captura parece boa",
    accessUnknown: "A permissão será checada no Iniciar",
    permissionNeeded: "Conserto único de permissão necessário",
    npcapNeeded: "Configuração única necessária: o driver de captura",
    npcapAdminOnly: "O driver de captura está instalado, mas restrito a administradores",
    npcapInstalling: "Buscando o driver de captura em npcap.com…",
    permissionFixCancelled:
      "O pedido de senha foi fechado sem terminar, então nada mudou. Clique em “Consertar permissão de captura” e digite sua senha do Mac — esse pedido é o conserto inteiro (os Ajustes do Sistema não têm chave para isso).",
    permissionFixFailed: (detail: string | null): string =>
      `O conserto de permissão não terminou${detail != null ? ` — o macOS disse: ${detail}` : ""}. Tente de novo; se continuar falhando, mande o log do app para o seu oficial.`,
    npcapInstalled: (version: string | null): string =>
      `Driver de captura instalado${version != null ? ` (Npcap ${version})` : ""} — aperte “Iniciar captura”.`,
    npcapNotCompleted:
      "O assistente do driver foi fechado antes do fim, então nada foi instalado. Clique em “Instalar driver de captura” e vá de Next até o final.",
    npcapCancelled:
      "O Windows bloqueou a instalação do driver — precisa do seu “Sim” no aviso do Windows. Tente de novo e aceite.",
    npcapLaunchFailed: (detail: string | null): string =>
      `O instalador do driver não pôde ser iniciado${detail != null ? ` (${detail})` : ""}. Use “Baixar eu mesmo” e rode a partir da pasta Downloads.`,
    npcapDownloadFailed:
      "Não deu para alcançar npcap.com para buscar o driver. Cheque sua conexão (uma VPN ou firewall rígido pode bloquear) e tente de novo, ou use “Baixar eu mesmo”.",
    npcapUntrusted:
      "O driver baixado não trazia uma assinatura válida dos autores, então NÃO foi executado — pode significar que um proxy ou antivírus alterou o download. Use “Baixar eu mesmo” direto do npcap.com.",
    permissionFixStillBlocked:
      "O conserto foi instalado, mas o macOS ainda diz que não há acesso de captura. Feche e reabra o app; se esta mensagem sobreviver a uma reinicialização, avise seu oficial.",
  },

  advanced: {
    summary: "Avançado",
    engineLabel: "Motor",
    engineNotFound: "não encontrado — escolha a pasta ao-loot-logger",
  },

  hero: {
    noCharacter: "seu personagem aparece com o tráfego do Albion",
  },
  settings: {
    gearLabel: "Configurações",
    language: "Idioma",
    system: "Sistema",
    theme: "Tema",
    themeObsidian: "Obsidiana",
    themeParchment: "Pergaminho",
    updates: "Atualizações",
    upToDate: "atualizado",
    checkUpdates: "Verificar atualizações",
    checking: "verificando…",
    updateOff: "A atualização automática está desligada nesta build — o botão abre a página de download.",
    advancedEngine: "Avançado — engine",
  },
  prefs: {
    autoCapture: "Iniciar a captura quando o app abrir",
  },

  quitConfirm: {
    title: "Parar a captura?",
    message: "A captura ainda está rodando. Sair e parar de registrar o loot?",
    quit: "Parar e sair",
    cancel: "Continuar capturando",
  },

  update: {
    downloading: (version: string | null, percent: number | null): string =>
      `Baixando atualização${version != null ? ` v${version}` : ""}…${percent != null ? ` ${percent}%` : ""}`,
    ready: (version: string | null): string =>
      `Atualização${version != null ? ` v${version}` : ""} pronta — ela instala quando você fechar o app.`,
    restartNow: "Reiniciar e atualizar",
    blockedCapturing: "A captura está rodando — a atualização instala quando você sair, ou pare a captura antes.",
    failed: (detail: string | null): string =>
      `A checagem de atualização falhou${detail != null ? ` (${detail})` : ""} — tentaremos de novo depois. A captura não é afetada.`,
  },

  pairing: {
    intro: "Vincule este computador uma vez — cada captura vai para a página de loot da guilda e para o Discord.",
    step1: "No Discord da sua guilda, use",
    step2: "O Guild Butler responde com seu código:",
    copy: "Copiar",
    copied: "Copiado!",
    pairShort: "Vincular",
    more: "Mais opções",
    title: "Mande o loot para a sua guilda",
    notPairedHint:
      "Conecte este computador à sua conta do Discord e o loot capturado vai sozinho para a guilda — sem arrastar arquivos. Rode /capture pair no Discord para receber um código.",
    pairedAs: (device: string): string => `Conectado como ${device}`,
    codeLabel: "Código de pareamento",
    codePlaceholder: "XXXX-XXXX",
    pair: "Parear com o Discord",
    pairing: "Conectando…",
    unpair: "Desconectar este computador",
    viewLoot: "Ver meu loot",
    uploadToggle: "Enviar loot automaticamente",
    uploadOffHint:
      "O envio automático está desligado. A captura ainda escreve o arquivo de log, e os oficiais podem pegá-lo na mão.",
    failBadCode:
      "Esse código não parece certo. São 8 caracteres da mensagem que o Discord mandou — confira algum erro de digitação e tente de novo.",
    failRefused:
      "O código do Discord não foi aceito. Códigos valem uma vez e expiram em uns 10 minutos — rode /capture pair de novo para pegar um novo.",
    failUnreachable:
      "Não deu para falar com o bot da sua guilda. Cheque sua conexão (uma VPN ou firewall rígido pode bloquear) e tente de novo.",
    failBadReply: "O bot da sua guilda respondeu algo que esta versão não entende. Talvez ele precise de atualização.",
    failNotDeployed:
      "O bot da sua guilda ainda não tem este recurso — um oficial precisa atualizá-lo. Outro código não vai ajudar. (Se você mudou o endereço do servidor em Avançado, confira também.)",
    failNoEncryption:
      "Este computador não consegue guardar a conexão com segurança, então nada foi salvo — o app não vai deixar um token de login num arquivo simples. A captura funciona; os oficiais podem pegar o arquivo de log na mão.",
    failStoreFailed: "Não deu para salvar a conexão com segurança. Tente de novo; se persistir, avise seu oficial.",
    upDisabled: "Envio automático desligado",
    upUpToDate: (n: number): string => (n > 0 ? `${n} linhas enviadas` : "Nada para enviar ainda"),
    upSending: "Enviando…",
    upRetrying: "O envio falhou agora há pouco — tentando de novo. Seu arquivo de log está a salvo.",
    upUnauthorized: "Este computador foi desconectado no Discord. Pareie de novo para voltar a enviar.",
    upBlocked: "O envio travou — avise seu oficial. Seu arquivo de log está a salvo e pode ser entregue na mão.",
    upBotOutdated:
      "O bot da sua guilda ainda não aceita envios — um oficial precisa atualizá-lo. A captura continua, e o envio volta sozinho quando isso acontecer.",
  },

  footer: {
    engineCredit: "Motor de captura: ao-loot-logger (GPL-3.0, código aberto)",
  },
};

const CATALOG: Record<TLang, TStrings> = { en: EN, uk: UK, ru: RU, de: DE, fr: FR, pt: PT };

export const stringsFor = (lang: TLang): TStrings => CATALOG[lang];

/**
 * The English words regardless of locale — for tests and log lines. UI code
 * goes through `stringsFor`.
 */
export const STR = EN;
