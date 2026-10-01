import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { Button, OpenLink } from "@guild-butler/design-system/react";

import { NPCAP_URL } from "../shared/ipc.js";
import type { TStrings } from "../shared/strings.js";
import { CHEVRON, Icon, NOTICE } from "./icons.js";
import type { TNoticeActionId, TNoticeButton, TNoticeView } from "./notices.js";

/**
 * The notices (boards Fh4 option D, Fh5): one slot at the top of every page — the band — and the
 * dialog a broken decoder interrupts with. What each says and offers is src/app/notices.ts; which
 * one shows is src/shared/notices.ts.
 *
 * A notice is an ordinary card (Fh5): no coloured bar, no tinted ground. Its weight is the icon, the
 * colour of its title and its one action. It is not a live region of its own — the shell speaks a
 * new notice's title once through the page's one polite region (board Fa): a notice that read
 * itself out on every change would read the download's percent out on every tick.
 */

/** One of a notice's buttons, by its look (notices.ts `TNoticeButton`). */
const Action = ({ button, onAction }: { button: TNoticeButton; onAction: (id: TNoticeActionId) => void }) => {
  const press = (): void => {
    if (!button.busy) {
      onAction(button.id);
    }
  };
  if (button.id === "get-npcap") {
    // A link to Npcap's own page, opened in the browser through the bridge: the window never
    // navigates (src/main/windowOptions.ts refuses it).
    return (
      <OpenLink
        href={NPCAP_URL}
        className="lb-notice-link"
        onClick={(event) => {
          event.preventDefault();
          press();
        }}
      >
        {button.label}
      </OpenLink>
    );
  }
  if (button.look === "link") {
    // Leaves the app for the download page, as a link does — but main knows the page, not this one,
    // so it is a button that asks main (the package's link, drawn on a button).
    return (
      <button
        type="button"
        className="gbtn gbtn-link lb-notice-link"
        aria-disabled={button.busy ? true : undefined}
        data-notice-action={button.id}
        onClick={press}
      >
        {button.label}
        <Icon paths={CHEVRON} size={14} />
      </button>
    );
  }
  return (
    <Button
      variant={button.look === "primary" ? "primary" : "outline"}
      aria-disabled={button.busy ? true : undefined}
      data-notice-action={button.id}
      onClick={press}
    >
      {button.label}
    </Button>
  );
};

export const NoticeBand = ({ view, onAction }: { view: TNoticeView; onAction: (id: TNoticeActionId) => void }) => {
  const id = useId();
  return (
    <section className="gb-card lb-notice" data-notice={view.kind} data-tone={view.tone} aria-labelledby={id}>
      <span className="lb-tile lb-tile--notice" aria-hidden="true">
        <Icon paths={NOTICE[view.icon]} size={18} />
      </span>
      <div className="lb-notice-main">
        <div className="lb-notice-text">
          <h2 className="lb-notice-title" id={id}>
            {view.title}
          </h2>
          {view.body !== "" ? <p className="lb-notice-body">{view.body}</p> : null}
          {view.notes.map((note) => (
            <p key={note} className="lb-notice-note">
              {note}
            </p>
          ))}
          {view.details.length > 0 ? (
            <p className="lb-notice-details">
              {view.details.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          ) : null}
        </div>
        {view.buttons.length > 0 ? (
          <div className="lb-notice-actions">
            {view.buttons.map((button) => (
              <Action key={button.id} button={button} onAction={onAction} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};

/** Everything in the dialog a Tab can reach, in order. */
const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));

/**
 * The broken decoder's dialog (board Fh4, option D): it interrupts when the break is found and again
 * when the fix has downloaded. "Later" closes it for that event — the band keeps the notice, which
 * is already there under it, so nothing on the page moves when it closes. Its action is the band's,
 * and pressing it answers the event too.
 *
 * Modal (Fa): the rest of the window is inert while it is open, Tab stays inside, Escape is
 * "Later", and the focus goes back where it was — or to the page, when it opened over nothing. The
 * focus starts on "Later": the other button stops a capture, and Enter on arrival must not.
 */
export const DecoderDialog = ({
  view,
  s,
  onAction,
  onLater,
}: {
  view: TNoticeView;
  s: TStrings;
  onAction: (id: TNoticeActionId) => void;
  onLater: () => void;
}) => {
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const before = document.activeElement;
    dialog.current?.querySelector<HTMLElement>("[data-dialog-later]")?.focus();
    return () => {
      // After the commit that closes the dialog: in it the rest of the window is still inert, and an
      // inert element takes no focus.
      queueMicrotask(() => {
        if (before instanceof HTMLElement && before !== document.body && before.isConnected) {
          before.focus();
        } else {
          document.getElementById("main")?.focus();
        }
      });
    };
  }, []);

  // The keys are heard on the document, not on the dialog: a click on the scrim, or on the dialog's
  // words, leaves the focus on the page's body — outside the dialog — and Escape must still be
  // "Later" then, and Tab must still land inside.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onLater();
        return;
      }
      if (event.key !== "Tab" || dialog.current == null) {
        return;
      }
      const list = focusables(dialog.current);
      const first = list[0];
      const last = list[list.length - 1];
      if (first == null || last == null) {
        return;
      }
      const active = document.activeElement;
      const inside = active != null && dialog.current.contains(active);
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onLater]);

  // The dialog's held line is its second paragraph, set a step brighter (Fh4); the notes after it
  // (main refusing the install) stay with the band.
  const action = view.buttons[0] ?? null;
  return (
    <div className="lb-overlay">
      <div className="gb-scrim lb-scrim" aria-hidden="true" />
      <div className="lb-dialog-place">
        <div
          ref={dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="gb-dialog lb-dialog"
          data-dialog={view.kind}
        >
          <div className="lb-dialog-head">
            <span className="lb-tile lb-tile--notice" aria-hidden="true">
              <Icon paths={NOTICE[view.icon]} size={18} />
            </span>
            <h2 className="lb-dialog-title" id={titleId}>
              {view.title}
            </h2>
          </div>
          <div id={bodyId} className="lb-dialog-text">
            <p className="lb-dialog-body">{view.body}</p>
            <p className="lb-dialog-held">{s.shell.notices.held}</p>
          </div>
          <div className="lb-dialog-actions">
            <Button variant="outline" data-dialog-later="" onClick={onLater}>
              {s.shell.notices.later}
            </Button>
            {action != null ? <Action button={action} onAction={onAction} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
};
