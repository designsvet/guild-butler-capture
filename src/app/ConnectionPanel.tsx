import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { announce, Button, OpenLink, Switch } from "@guild-butler/design-system/react";

import type { EPairFailure, TPairingStatus } from "../shared/captureTypes.js";
import { PAIR_COMMAND } from "../shared/ipc.js";
import type { TStrings } from "../shared/strings.js";
import { connectionView, pairFailureSentence, placePanel } from "./connection.js";
import { CHECK, COPY, Icon } from "./icons.js";

/**
 * The guild connection's panel (board Fh2, "What opens from it"): a vellum panel (the package's
 * `.gb-overlay`) that opens upward from the sidebar's foot, over the page — the window never
 * re-flows. The foot opens it, and so does Session's "Pair with Discord"; it is the same panel.
 *
 * Not connected, it is the old window's two steps: run `/capture pair` in the guild's Discord (the
 * command beside a button that copies it), then type the code the bot replies with and Pair — which
 * waits for a code, and says "Connecting…" and refuses a second press while main checks it. A
 * refused code is said under the field in the old window's sentence for that failure, and read out
 * once through the page's one polite region. Connected, it is the details: who this computer is,
 * how its upload stands, the "Send loot automatically" switch, View my loot (a link, which main
 * opens in the browser) and Disconnect this computer.
 *
 * A popover, not a modal (board Fa): the page stays live around it. Escape closes it and gives the
 * focus back to the door it came from; a press outside it closes it, and so does the focus leaving
 * it — except while a code is being checked, since the answer lands here. It opens onto the code
 * field (what the member comes back from Discord with, as the old window's steps do), or onto
 * itself when connected, where the first control would be a switch a stray Space turns off. A
 * dialog or the settings drawer over the window suspends it: the keys are theirs then.
 */

/** The panel's id, for its doors' aria-controls. */
export const CONNECTION_PANEL_ID = "lb-connection";

/** Where the panel's doors are: a press or the focus on one is not "outside" it. */
const DOORS = "[data-connection-door], [data-connection-opener]";

/** The old window's: "Copied!" clears itself, and a second press restarts the clock. */
const COPIED_FOR_MS = 1600;

/** The title bar's height (shell.css): the panel stops 8px under it. */
const BAR_HEIGHT = 48;

export type TConnectionActions = {
  /** Close it; `refocus` gives the focus back to the door it came from (Escape). */
  onClose: (refocus: boolean) => void;
  onPair: (code: string) => void;
  onUpload: (enabled: boolean) => void;
  onLoot: () => void;
  onUnpair: () => void;
  onCopy: () => Promise<boolean>;
};

const Steps = ({
  s,
  busy,
  failure,
  on,
  codeRef,
}: {
  s: TStrings;
  busy: boolean;
  failure: EPairFailure | null;
  on: TConnectionActions;
  codeRef: RefObject<HTMLInputElement | null>;
}) => {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const failureId = useId();
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current != null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const empty = code.trim() === "";
  const submit = (): void => {
    if (!busy && !empty) {
      on.onPair(code);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };
  const copy = (): void => {
    void on.onCopy().then((ok) => {
      if (!ok) {
        return;
      }
      setCopied(true);
      announce(s.pairing.copied);
      if (copiedTimer.current != null) {
        window.clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, COPIED_FOR_MS);
    });
  };

  return (
    <ol className="lb-pair-steps">
      <li className="lb-pair-step">
        <span className="lb-pair-num" aria-hidden="true">
          1
        </span>
        <div className="lb-pair-step-body">
          <span className="lb-pair-step-text">{s.pairing.step1}</span>
          <span className="lb-pair-cmd-row">
            <span className="gb-well lb-pair-cmd">
              {/* Discord's command, in every language */}
              <span lang="en">{PAIR_COMMAND}</span>
              <button type="button" className="lb-pair-copy" aria-label={s.pairing.copy} data-pair-copy="" onClick={copy}>
                <Icon paths={copied ? CHECK : COPY} size={13} />
              </button>
            </span>
            {copied ? <span className="lb-pair-copied">{s.pairing.copied}</span> : null}
          </span>
        </div>
      </li>
      <li className="lb-pair-step">
        <span className="lb-pair-num" aria-hidden="true">
          2
        </span>
        <div className="lb-pair-step-body">
          <span className="lb-pair-step-text">{s.pairing.step2}</span>
          <div className="lb-pair-code-row">
            <input
              ref={codeRef}
              type="text"
              className="lb-pair-code"
              value={code}
              placeholder={s.pairing.codePlaceholder}
              aria-label={s.pairing.codeLabel}
              aria-invalid={failure != null ? true : undefined}
              aria-describedby={failure != null ? failureId : undefined}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              // the code and the dash the bot shows it with (src/shared/pairing.ts)
              maxLength={9}
              data-pair-code=""
              onChange={(event) => {
                setCode(event.target.value);
              }}
              onKeyDown={onKeyDown}
            />
            {/* Waits for a code (Fh2 draws it dimmed and refusing while the field is empty). While
                main checks one it refuses a second press but keeps the focus: aria-disabled. */}
            <Button
              variant="primary"
              disabled={empty}
              aria-disabled={busy ? true : undefined}
              data-pair-submit=""
              onClick={submit}
            >
              {busy ? s.pairing.pairing : s.pairing.pairShort}
            </Button>
          </div>
          {failure != null ? (
            <p className="lb-pair-failure" id={failureId} data-pair-failure={failure}>
              {pairFailureSentence(failure, s)}
            </p>
          ) : null}
        </div>
      </li>
    </ol>
  );
};

export const ConnectionPanel = ({
  s,
  platform,
  pairing,
  now,
  busy,
  failure,
  suspended,
  on,
}: {
  s: TStrings;
  platform: string;
  pairing: TPairingStatus;
  now: number;
  /** A code is with main. */
  busy: boolean;
  /** Why the last code was refused. */
  failure: EPairFailure | null;
  /** A dialog or the settings drawer is over the window: the keys and presses are theirs. */
  suspended: boolean;
  on: TConnectionActions;
}) => {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const view = connectionView(pairing, now, platform, s);
  const face = view == null ? "connect" : "connected";
  // The latest handlers and state, for the document's listeners without re-adding them on every
  // render (the shell renders each second for its clock).
  const latest = useRef({ on, busy });
  latest.current = { on, busy };

  // Placed before it is painted — from where the foot is now, on every render (the foot and the
  // panel change height as their words do) and when the window changes size. Written through the
  // CSSOM: the page's policy refuses style attributes, not that.
  useLayoutEffect(() => {
    const el = panel.current;
    const foot = el?.parentElement?.closest(".lb-foot");
    if (el == null || foot == null) {
      return;
    }
    const place = (): void => {
      el.style.maxHeight = "";
      const box = foot.getBoundingClientRect();
      const at = placePanel({
        foot: { left: box.left, top: box.top },
        panel: { width: el.offsetWidth, height: el.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        barHeight: BAR_HEIGHT,
      });
      el.style.left = `${at.left}px`;
      el.style.bottom = `${at.bottom}px`;
      el.style.maxHeight = at.maxHeight == null ? "" : `${at.maxHeight}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  });

  // The focus on arrival: the code field, or the panel itself when connected. When the face
  // changes under the focus — a code accepted, the computer disconnected — the control that held it
  // has gone, so the panel takes it, and a screen reader hears the panel's new name.
  const lastFace = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastFace.current === face) {
      return;
    }
    const arriving = lastFace.current == null;
    lastFace.current = face;
    if (arriving && face === "connect") {
      codeRef.current?.focus();
    } else {
      panel.current?.focus();
    }
  }, [face]);

  // A refused code is read out once, through the page's one polite region (board Fa).
  useEffect(() => {
    if (failure != null) {
      announce(pairFailureSentence(failure, s));
    }
    // On the failure, not the words: a change of language does not say it again.
  }, [failure]);

  // Escape, a press outside, the focus leaving: heard on the document while nothing modal is over
  // the window, and none of them while a code is being checked.
  useEffect(() => {
    if (suspended) {
      return;
    }
    const outside = (target: EventTarget | null): boolean =>
      target instanceof Element && panel.current?.contains(target) !== true && target.closest(DOORS) == null;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented && !latest.current.busy) {
        event.preventDefault();
        latest.current.on.onClose(true);
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (outside(event.target) && !latest.current.busy) {
        latest.current.on.onClose(false);
      }
    };
    const onFocusIn = (event: FocusEvent): void => {
      // A dialog that interrupts takes the focus without closing what it interrupts.
      const target = event.target;
      if (outside(target) && target instanceof Element && target.closest("[aria-modal='true']") == null && !latest.current.busy) {
        latest.current.on.onClose(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [suspended]);

  return (
    <div
      ref={panel}
      id={CONNECTION_PANEL_ID}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="gb-overlay lb-pair"
      data-connection-panel={face}
    >
      {view == null ? (
        <>
          <div className="lb-pair-head">
            <h2 className="lb-pair-title" id={titleId}>
              {s.pairing.title}
            </h2>
            <p className="lb-pair-text">{s.pairing.intro}</p>
          </div>
          <Steps s={s} busy={busy} failure={failure} on={on} codeRef={codeRef} />
          <div className="lb-pair-rule" aria-hidden="true" />
          <p className="lb-pair-note">{s.shell.connection.noGuild}</p>
        </>
      ) : (
        <>
          <div className="lb-pair-head lb-pair-head--connected">
            <h2 className="lb-pair-title" id={titleId}>
              {view.title}
            </h2>
            <p className="lb-pair-status" data-dot={view.dot}>
              <span className="lb-pair-dot" aria-hidden="true" />
              {view.line}
            </p>
            {view.note != null ? <p className="lb-pair-detail">{view.note}</p> : null}
          </div>
          <div className="lb-switch-row">
            <Switch checked={pairing.uploadEnabled} onChange={on.onUpload}>
              {s.pairing.uploadToggle}
            </Switch>
          </div>
          <div className="lb-pair-rule" aria-hidden="true" />
          <div className="lb-pair-actions">
            {pairing.lootUrl != null ? (
              // A link to the page, opened in the browser through the bridge: the window never
              // navigates (src/main/windowOptions.ts refuses it), nor opens another.
              <OpenLink
                href={pairing.lootUrl}
                className="lb-pair-loot"
                data-pair-loot=""
                onClick={(event) => {
                  event.preventDefault();
                  on.onLoot();
                }}
                onAuxClick={(event) => {
                  event.preventDefault();
                }}
              >
                {s.pairing.viewLoot}
              </OpenLink>
            ) : null}
            <Button variant="outline-danger" size="sm" className="lb-pair-disconnect" data-pair-disconnect="" onClick={on.onUnpair}>
              {s.pairing.unpair}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
