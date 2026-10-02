import { Button, Tabs } from "@guild-butler/design-system/react";

import type { TStrings } from "../shared/strings.js";

/**
 * The page header (board F1): the range tabs stand where a page title would — Rubik 18, the
 * chosen one in ink over the package's glowing gold underline, a light running along it while
 * capturing (`live`). The page's name is still said once, as the page's one h1, for a screen
 * reader (board Fa) — first in the page, above the band's notice (Shell.tsx). Then the meta line:
 * beside the tabs from 1280 up, under them below.
 *
 * In slice 0 the only range is Session: Today and 7 days need History, which is not built yet.
 * Slice 1 puts New session at the right; it stays beside the title at the minimum width.
 */

/** The id of the region the tab controls (Shell.tsx). */
export const PAGE_PANEL_ID = "lb-page";

export const PageHeader = ({
  s,
  meta,
  live,
  newSession,
}: {
  s: TStrings;
  meta: string;
  live: boolean;
  newSession?: { label: string; disabled: boolean; onClick: () => void };
}) => (
  <div className="lb-head">
    <div className="lb-head-titles">
      <Tabs
        tabs={[{ value: "session", label: s.shell.pages.session }]}
        value="session"
        onChange={() => {}}
        label={s.shell.range}
        size="title"
        live={live}
        panelId={() => PAGE_PANEL_ID}
      />
      {meta !== "" ? <div className="lb-head-meta">{meta}</div> : null}
    </div>
    {newSession != null ? (
      <div className="lb-head-actions">
        <Button variant="secondary" disabled={newSession.disabled} onClick={newSession.onClick} data-new-session="">
          {newSession.label}
        </Button>
      </div>
    ) : null}
  </div>
);
