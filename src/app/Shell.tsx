import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { announce, LiveRegion } from "@guild-butler/design-system/react";

import { ECaptureStatus } from "../shared/captureTypes.js";
import { asLang, detectLang } from "../shared/i18n.js";
import { stringsFor, type TStrings } from "../shared/strings.js";
import { formatClock } from "./format.js";
import { barAction, barStatus, headerMeta, sessionHero, sidebarFoot } from "./model.js";
import { PAGE_PANEL_ID, PageHeader } from "./PageHeader.js";
import type { TRouter } from "./router.js";
import { SessionPage } from "./SessionPage.js";
import { Sidebar } from "./Sidebar.js";
import type { TShellStore } from "./store.js";
import { TitleBar } from "./TitleBar.js";

/**
 * The shell (Loot Butler, raid-bot ADR 0159; boards Fh1, Fh2, Fh3, Fh7, F1, Fa): the skip link,
 * the title bar (banner), the sidebar (navigation "Views") and the page (main), with one polite
 * live region. Everything it shows comes from the store, which mirrors the main process; the only
 * state of its own is the clock that moves "listening for 40 s".
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
  return (
    <>
      <a className="gb-skip" href="#main">
        {s.shell.skipToContent}
      </a>
      <TitleBar
        s={s}
        status={barStatus(capture, now, s)}
        action={barAction(capture)}
        version={snap.setup != null ? `v${snap.setup.appVersion}` : null}
        onStart={store.start}
        onStop={store.stop}
      />
      <div className="lb-body">
        <Sidebar s={s} route={route} foot={sidebarFoot(snap.pairing, now, platform, s)} />
        <main id="main" tabIndex={-1} className="lb-main">
          <PageHeader
            s={s}
            meta={headerMeta(capture, now, s, (at) => formatClock(at))}
            live={capture?.status === ECaptureStatus.Capturing}
          />
          <div id={PAGE_PANEL_ID} role="tabpanel" aria-label={s.shell.pages.session}>
            <SessionPage
              s={s}
              hero={sessionHero(capture, now, platform, s)}
              platform={platform}
              paired={snap.pairing?.paired ?? null}
              autoCapture={snap.settings?.autoCapture ?? null}
              onReveal={store.reveal}
              onAutoCapture={store.setAutoCapture}
            />
          </div>
        </main>
      </div>
      <LiveRegion />
    </>
  );
};
