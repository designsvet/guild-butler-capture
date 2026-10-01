import { Fragment } from "react";

import { Button } from "@guild-butler/design-system/react";

import type { TStrings } from "../shared/strings.js";
import { GEAR, Icon } from "./icons.js";
import type { TBarAction, TBarStatus } from "./model.js";
import { StartStop } from "./StartStop.js";

/**
 * The title bar (board Fh1; F1): the crest and the wordmark at the left, then the capture's
 * status, its one button, the version and the gear at the right. The OS draws over the ends — a
 * Mac's lights at the left, Windows' caption buttons at the right — which shell.css pads for.
 *
 * Below 1024 px the bar gives up words, never the button: the status keeps its name and its time,
 * and the version goes with its divider (shell.css, `.lb-long` / `.lb-short` / `.lb-wide`).
 */

const Status = ({ status }: { status: TBarStatus }) => {
  const full = [status.label, ...status.details].join(" · ");
  return (
    <div className="lb-status" data-tone={status.tone} title={full}>
      <span className="lb-status-dot" aria-hidden="true" />
      <span className={`lb-status-label lb-status-label--${status.look}`}>{status.label}</span>
      {status.details.map((detail) => (
        <Fragment key={`long-${detail}`}>
          <span className="lb-status-sep lb-long" aria-hidden="true">
            ·
          </span>
          <span className="lb-status-detail lb-long">{detail}</span>
        </Fragment>
      ))}
      {status.short.map((detail) => (
        <Fragment key={`short-${detail}`}>
          <span className="lb-status-sep lb-short" aria-hidden="true">
            ·
          </span>
          <span className="lb-status-detail lb-short">{detail}</span>
        </Fragment>
      ))}
    </div>
  );
};

export const TitleBar = ({
  s,
  status,
  action,
  version,
  inert = false,
  onStart,
  onStop,
}: {
  s: TStrings;
  status: TBarStatus | null;
  action: TBarAction | null;
  /** "v0.8.8" once the setup probe has answered. */
  version: string | null;
  /** A modal dialog is open over the page (Notice.tsx): nothing here takes a press or the focus. */
  inert?: boolean;
  onStart: () => void;
  onStop: () => void;
}) => (
  <header className="lb-titlebar" inert={inert}>
    <img src="./crest.png" alt="" width={26} height={26} className="lb-bar-crest" />
    {/* The wordmark is the serif's one use in the app (the package README). The board sets it at
        700; the package ships the serif at 500 and 600 only, so 600 is what draws. */}
    <span className="relative top-px flex-none whitespace-nowrap font-serif text-[18px] font-semibold tracking-[0.01em] text-ink">
      {s.shell.appName}
    </span>
    <div className="lb-bar-fill" />
    {status != null ? <Status status={status} /> : null}
    {/* Stop while the logger runs, Start capture when it does not — one button that changes face
        (StartStop.tsx): outlined danger with a small square, gold when idle, neutral in the error
        state, whose fix lives in the page's notice (one gold button per window). */}
    {action != null ? <StartStop action={action} s={s} onStart={onStart} onStop={onStop} /> : null}
    {version != null ? (
      <>
        <span className="lb-bar-divider lb-wide" aria-hidden="true" />
        <span className="lb-bar-version lb-wide">{version}</span>
      </>
    ) : null}
    {/* The design system's Button. Inert for now: where settings live is still a pick on the canvas
        (Fh6), and the gear opens whatever is built there. */}
    <Button variant="quiet" size="sm" iconOnly label={s.settings.gearLabel} icon={<Icon paths={GEAR} />} className="lb-gear" />
  </header>
);
