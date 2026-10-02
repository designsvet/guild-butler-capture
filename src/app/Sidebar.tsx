import { useId, type ReactNode } from "react";

import type { TStrings } from "../shared/strings.js";
import { CONNECTION_PANEL_ID } from "./ConnectionPanel.js";
import { APPEARS, CHEVRON, Icon, INFO, SESSION } from "./icons.js";
import type { TFoot } from "./model.js";
import { hrefOf, type TRoute } from "./router.js";

/**
 * The sidebar (boards F1, Fh3; the foot is Fh2): the pages in mono-eyebrowed groups, and the
 * guild connection at the foot. 208 px with labels from 1280 up; below that the 60 px rail of
 * icons, each label kept as the link's name and shown as a tooltip on hover and on focus
 * (shell.css). One DOM for both, so nothing re-mounts as the window crosses 1280.
 *
 * Only pages with data are listed: Session under Live, and PvE under This session after a kill
 * or chest is observed.
 *
 * The foot is the door to the guild connection's panel (Fh2's lower half, ConnectionPanel.tsx): a
 * button over both its lines, which shows itself pressed while the panel is open. The panel is
 * drawn inside the foot, after the door, so Tab goes from the door into it.
 */

/** The connection's door: the panel open or not, and what pressing it does. */
export type TFootDoor = {
  open: boolean;
  onToggle: () => void;
  /** The panel, while it is open. */
  panel: ReactNode;
};

const Foot = ({ foot, door }: { foot: TFoot; door: TFootDoor }) => (
  <div className="lb-foot" data-dot={foot.dot}>
    <button
      type="button"
      className="lb-foot-door"
      title={`${foot.line1} — ${foot.line2}`}
      aria-haspopup="dialog"
      aria-expanded={door.open}
      aria-controls={door.open ? CONNECTION_PANEL_ID : undefined}
      data-connection-door=""
      onClick={door.onToggle}
    >
      <span className={foot.connect ? "lb-foot-line lb-foot-line--connect" : "lb-foot-line"}>
        <span className="lb-foot-dot" aria-hidden="true" />
        <span className={foot.named ? "lb-foot-text" : "lb-foot-text lb-foot-text--words"}>{foot.line1}</span>
        <span className="lb-foot-chevron" aria-hidden="true">
          <Icon paths={CHEVRON} size={14} />
        </span>
      </span>
      <span className="lb-foot-sub">{foot.line2}</span>
    </button>
    {door.open ? door.panel : null}
  </div>
);

export const Sidebar = ({
  s,
  route,
  foot,
  door,
  pve,
}: {
  s: TStrings;
  route: TRoute;
  foot: TFoot | null;
  door: TFootDoor;
  pve?: { label: string; group: string };
}) => {
  const live = useId();
  const thisSession = useId();
  const active = route === "session";
  return (
    <nav className="lb-side" aria-label={s.shell.views}>
      <div className="lb-side-group" role="group" aria-labelledby={live}>
        <div className="lb-side-eyebrow" id={live}>
          {s.shell.groups.live}
        </div>
        <a
          href={hrefOf("session")}
          className={active ? "lb-nav is-active" : "lb-nav"}
          aria-current={active ? "page" : undefined}
          data-label={s.shell.pages.session}
        >
          <span className="lb-nav-icon">
            {/* Keyed by the route, so arriving here again draws it again. */}
            <Icon key={route} paths={SESSION} size={17} lit={active} />
          </span>
          <span className="lb-nav-label">{s.shell.pages.session}</span>
        </a>
      </div>
      {pve != null ? (
        <div className="lb-side-group" role="group" aria-labelledby={thisSession}>
          <div className="lb-side-eyebrow" id={thisSession}>
            {pve.group}
          </div>
          <a
            href={hrefOf("pve")}
            className={route === "pve" ? "lb-nav is-active" : "lb-nav"}
            aria-current={route === "pve" ? "page" : undefined}
            data-label={pve.label}
          >
            <span className="lb-nav-icon">
              <Icon key={route} paths={APPEARS[2] ?? INFO} size={17} lit={route === "pve"} />
            </span>
            <span className="lb-nav-label">{pve.label}</span>
          </a>
        </div>
      ) : null}
      <div className="lb-side-fill" />
      {foot != null ? <Foot foot={foot} door={door} /> : null}
    </nav>
  );
};
