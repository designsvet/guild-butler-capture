import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { announce, LiveRegion } from "@guild-butler/design-system/react";

import { ECaptureStatus } from "../shared/captureTypes.js";
import { asLang, detectLang } from "../shared/i18n.js";
import { captureBlock, decoderDialogEvent, ENotice, noticesNow } from "../shared/notices.js";
import { stringsFor, type TStrings } from "../shared/strings.js";
import { formatClock } from "./format.js";
import { barAction, barStatus, headerMeta, sessionHero, sidebarFoot } from "./model.js";
import { DecoderDialog, NoticeBand } from "./Notice.js";
import { holdsTheGold, noticeView, type TNoticeActionId } from "./notices.js";
import { PAGE_PANEL_ID, PageHeader } from "./PageHeader.js";
import type { TRouter } from "./router.js";
import { SessionPage } from "./SessionPage.js";
import { Sidebar } from "./Sidebar.js";
import type { TShellStore } from "./store.js";
import { TitleBar } from "./TitleBar.js";

/**
 * The shell (Loot Butler, raid-bot ADR 0159; boards Fh1, Fh2, Fh3, Fh4, Fh5, Fh7, F1, Fa): the skip
 * link, the title bar (banner), the sidebar (navigation "Views") and the page (main) — the band's
 * notice at its top, on every page — with one polite live region, and the broken decoder's dialog
 * over it all when it interrupts. Everything it shows comes from the store, which mirrors the main
 * process; the only state of its own is the clock that moves "listening for 40 s".
 */

/** The second hand: the bar counts seconds for the first minute. */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
};

const statusWords = (s: TStrings): Record<ECaptureStatus, string> => ({
  [ECaptureStatus.Idle]: s.status.idle,
  [ECaptureStatus.Starting]: s.status.starting,
  [ECaptureStatus.Waiting]: s.status.waiting,
  [ECaptureStatus.Capturing]: s.status.capturing,
  [ECaptureStatus.Stopping]: s.status.stopping,
  [ECaptureStatus.Restarting]: s.status.restarting,
  [ECaptureStatus.Error]: s.status.error,
});

/**
 * A screen reader hears the capture's state when it CHANGES, once, in the app's words — never the
 * state the window opens on, and never a ticking time (board Fa).
 */
const useAnnounceStatus = (status: ECaptureStatus | undefined, s: TStrings): void => {
  const last = useRef<ECaptureStatus | undefined>(undefined);
  useEffect(() => {
    if (status === undefined) {
      return;
    }
    if (last.current !== undefined && last.current !== status) {
      announce(statusWords(s)[status]);
    }
    last.current = status;
  }, [status, s]);
};

/**
 * A screen reader hears a notice's title when one arrives or another takes the band, once — not the
 * notice the window opens on (its section is in the page, under the title bar), and not its
 * changes: the fix's download percent ticks.
 */
const useAnnounceNotice = (opened: boolean, key: string | null, title: string | null): void => {
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // Until every slice a notice reads has arrived, the window is still opening.
    if (!opened) {
      return;
    }
    if (last.current !== undefined && key !== last.current && key != null && title != null) {
      announce(title);
    }
    last.current = key;
  }, [opened, key, title]);
};

export const Shell = ({ store, router, platform }: { store: TShellStore; router: TRouter; platform: string }) => {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const route = useSyncExternalStore(router.subscribe, router.getSnapshot);
  const now = useNow();

  // The stored language, else the OS's; the stored theme, else dark — as the old window does.
  const lang = asLang(snap.settings?.language) ?? detectLang(navigator.language);
  const s = stringsFor(lang);
  const theme = snap.settings?.theme === "parchment" ? "light" : "dark";
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = lang;
    document.title = s.shell.appName;
  }, [theme, lang, s]);

  useAnnounceStatus(snap.capture?.status, s);

  const capture = snap.capture;
  const block = captureBlock(capture, snap.setup);
  const all = noticesNow({ capture, setup: snap.setup, update: snap.update, now });
  const notice = all[0] ?? null;
  const ctx = { capture, setup: snap.setup, update: snap.update, ui: snap.ui, s };
  const view = notice != null ? noticeView(notice, ctx) : null;
  useAnnounceNotice(
    capture != null && snap.setup != null && snap.update != null,
    notice == null ? null : notice.kind === ENotice.Blocked ? `${notice.kind}:${notice.block}` : notice.kind,
    view?.title ?? null,
  );

  // The dialog interrupts for an event this window has not answered (src/shared/notices.ts). It
  // says what the band's decoder notice says, so it is drawn from the same view.
  const event = decoderDialogEvent(capture, snap.update);
  const decoderNotice = all.find((n) => n.kind === ENotice.Decoder);
  const decoder = decoderNotice != null ? noticeView(decoderNotice, ctx) : null;
  const dialogOpen = event != null && decoder != null && !snap.ui.dismissed.includes(event);

  // What each notice button does: the store's action of the same name (src/app/store.ts).
  const actions: Record<TNoticeActionId, () => void> = {
    "fix-mac": store.fixMacPermissions,
    "install-npcap": store.installNpcap,
    "get-npcap": store.openNpcapPage,
    "choose-engine": store.pickEnginePath,
    "update-now": store.updateNow,
    "check-for-fix": store.checkForUpdate,
    "get-update": store.checkForUpdate,
  };
  const onAction = (id: TNoticeActionId): void => {
    actions[id]();
  };

  return (
    <>
      <a className="gb-skip" href="#main" inert={dialogOpen}>
        {s.shell.skipToContent}
      </a>
      <TitleBar
        s={s}
        status={barStatus(capture, now, s, block != null)}
        // The band holds the next step: Start steps back to the neutral face (one gold button per window).
        action={barAction(capture, block != null || holdsTheGold(view))}
        version={snap.setup != null ? `v${snap.setup.appVersion}` : null}
        inert={dialogOpen}
        onStart={store.start}
        onStop={store.stop}
      />
      <div className="lb-body" inert={dialogOpen}>
        <Sidebar s={s} route={route} foot={sidebarFoot(snap.pairing, now, platform, s)} />
        <main id="main" tabIndex={-1} className="lb-main">
          {/* The page's one h1 (board Fa) comes first, so the band's h2 sits under it. */}
          <h1 className="gb-sr-only">{s.shell.pages.session}</h1>
          {view != null ? <NoticeBand view={view} onAction={onAction} /> : null}
          <PageHeader
            s={s}
            meta={headerMeta(capture, now, s, (at) => formatClock(at))}
            live={capture?.status === ECaptureStatus.Capturing}
          />
          <div id={PAGE_PANEL_ID} role="tabpanel" aria-label={s.shell.pages.session}>
            <SessionPage
              s={s}
              hero={sessionHero(capture, now, platform, s, block)}
              platform={platform}
              paired={snap.pairing?.paired ?? null}
              autoCapture={snap.settings?.autoCapture ?? null}
              onReveal={store.reveal}
              onAutoCapture={store.setAutoCapture}
            />
          </div>
        </main>
      </div>
      {dialogOpen && event != null && decoder != null ? (
        <DecoderDialog
          // a new event is a new dialog: the focus moves into it again
          key={event}
          view={decoder}
          s={s}
          onAction={(id) => {
            store.dismissDialog(event);
            onAction(id);
          }}
          onLater={() => {
            store.dismissDialog(event);
          }}
        />
      ) : null}
      <LiveRegion />
    </>
  );
};
