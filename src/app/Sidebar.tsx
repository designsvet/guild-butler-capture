import { useId } from "react";

import type { TStrings } from "../shared/strings.js";
import { CHEVRON, Icon, SESSION } from "./icons.js";
import type { TFoot } from "./model.js";
import { hrefOf, type TRoute } from "./router.js";

/**
 * The sidebar (boards F1, Fh3; the foot is Fh2): the pages in mono-eyebrowed groups, and the
 * guild connection at the foot. 208 px with labels from 1280 up; below that the 60 px rail of
 * icons, each label kept as the link's name and shown as a tooltip on hover and on focus
 * (shell.css). One DOM for both, so nothing re-mounts as the window crosses 1280.
 *
 * Only pages that exist are listed: in slice 0 that is Session, under Live.
 *
 * The foot shows the state only. It will be the door to the connection panel (Fh2's lower half),
 * which arrives with the pairing step; until then it is not a control, and Tab passes it by.
 */

const Foot = ({ foot }: { foot: TFoot }) => (
  <div className="lb-foot" data-dot={foot.dot} title={`${foot.line1} — ${foot.line2}`}>
    <div className={foot.connect ? "lb-foot-line lb-foot-line--connect" : "lb-foot-line"}>
      <span className="lb-foot-dot" aria-hidden="true" />
      <span className={foot.named ? "lb-foot-text" : "lb-foot-text lb-foot-text--words"}>{foot.line1}</span>
      <span className="lb-foot-chevron" aria-hidden="true">
        <Icon paths={CHEVRON} size={14} />
      </span>
    </div>
    <div className="lb-foot-sub">{foot.line2}</div>
  </div>
);

export const Sidebar = ({ s, route, foot }: { s: TStrings; route: TRoute; foot: TFoot | null }) => {
  const live = useId();
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
      <div className="lb-side-fill" />
      {foot != null ? <Foot foot={foot} /> : null}
    </nav>
  );
};
