import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button, OpenLink, Switch } from "@guild-butler/design-system/react";

import type { TSetupStatus, TTheme, TUpdateStatus } from "../shared/captureTypes.js";
import { PRIVACY_URL } from "../shared/ipc.js";
import type { TStrings } from "../shared/strings.js";
import { CHECK, CHEVRON_DOWN, CLOSE, FOLDER, Icon } from "./icons.js";
import {
  LANG_CHOICES,
  langChoiceLabel,
  moveActive,
  pathParts,
  placeMenu,
  typeahead,
  updateLine,
  type TLangChoice,
} from "./settings.js";

/**
 * The settings (board Fh6, option C — the floating drawer of board F1s): opened by the title bar's
 * gear, 440px wide, 16px in from the window's edges under the title bar, opaque (the package's
 * dialog surface) over the one scrim. The page stays in view beside it, so a new theme or language
 * is seen as it lands.
 *
 * What it holds is the old window's gear popover, in its words, plus the folder the logs go to:
 * Capture (auto-start), Appearance (the theme tiles, the language), Updates (the version, how the
 * updater stands, Check for updates), Files (the folder and Open folder), Advanced — engine (its
 * folder and Choose engine folder…), About (the version, the engine's credit, the privacy policy).
 * Every control is the bridge call the old window's makes. The beta channel the board draws is not
 * here: it needs the release pipeline first.
 *
 * It slides in from the right in about 300ms, decelerating, and leaves quicker, accelerating (the
 * package's exit); under reduced motion it fades instead (shell.css). Modal (board Fa): the rest of
 * the window is inert while it is open, Tab stays inside, Escape closes it — heard on the document,
 * so a click on its words, which leaves the focus on the page's body, does not strand it — and so
 * does a press outside it. The focus starts on Close and goes back to the gear (Shell.tsx).
 */

export type TDrawerPhase = "open" | "closing";

/** A folder the setup probe has not named (no engine found, or no answer yet): a dash, never a guess. */
const NOT_KNOWN = "—";

const THEMES: readonly TTheme[] = ["obsidian", "parchment"];

/** Everything in the drawer a Tab can reach, in order. */
const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));

/** One group of settings under its mono eyebrow, the hairline between groups (Fh6). */
const Section = ({ title, children }: { title: string; children: ReactNode }) => {
  const id = useId();
  return (
    <section className="lb-set-section" aria-labelledby={id}>
      <h3 className="lb-set-eyebrow" id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
};

/**
 * A folder's path, whole, in mono: it breaks only between folders, never inside a name — so
 * `guild-butler-capture` is never split at a hyphen — and its title holds it once more for a
 * pointer that rests on it. Each folder is its own inline block: the line breaks between blocks,
 * and a block wider than the whole column (a folder name of forty-odd characters) breaks inside
 * itself rather than run out of the drawer.
 */
const Path = ({ path }: { path: string | null }) => {
  if (path == null) {
    return <span className="lb-set-path">{NOT_KNOWN}</span>;
  }
  return (
    <span className="lb-set-path" title={path}>
      {pathParts(path).map((part, i) => (
        <span key={`${i}:${part}`} className="lb-set-path-part">
          {part}
        </span>
      ))}
    </span>
  );
};

/**
 * A theme as the board draws it: a small window in that theme's own colours — its own tokens, from
 * the package's `data-theme` on the picture, whichever theme the page wears — and its name. The
 * chosen one wears the chosen wash, the gold outline, its name in gold and a check.
 */
const ThemeTile = ({ theme, chosen, label, onPick }: { theme: TTheme; chosen: boolean; label: string; onPick: (theme: TTheme) => void }) => (
  <button type="button" className="lb-theme-tile" aria-pressed={chosen} data-theme-pick={theme} onClick={() => onPick(theme)}>
    <span className="lb-theme-preview" data-theme={theme === "parchment" ? "light" : "dark"} aria-hidden="true">
      <span className="lb-theme-preview-bar" />
      <span className="lb-theme-preview-card">
        <span />
        <span />
      </span>
    </span>
    <span className="lb-theme-name">
      {chosen ? <Icon paths={CHECK} size={12} /> : null}
      {label}
    </span>
  </button>
);

/**
 * The language, as the kit's dropdown — no native select, whose menu the OS draws in its own
 * colours and its own language. A button that names the choice, and a vellum menu of rows: "System"
 * (the OS's language), then each language in itself.
 *
 * The menu floats over the drawer, fixed to the window (`placeMenu`): the drawer's body scrolls in a
 * small window and would cut it. It opens on a press, or on the arrows, Enter or Space; the focus
 * goes onto the chosen row, the arrows, Home, End and a typed letter move it, Enter or Space or a
 * click picks, and Escape, Tab, a press outside or a scroll of the drawer close it — Escape only the
 * menu, not the drawer. The focus goes back to the button. A window that changes size moves it
 * with its button.
 */
const LanguagePicker = ({
  value,
  labelId,
  s,
  onPick,
}: {
  value: TLangChoice;
  labelId: string;
  s: TStrings;
  onPick: (choice: TLangChoice) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const valueId = useId();
  const listId = useId();
  const labels = LANG_CHOICES.map((choice) => langChoiceLabel(choice, s));
  const chosen = Math.max(0, LANG_CHOICES.indexOf(value));

  const openMenu = (): void => {
    setActive(chosen);
    setOpen(true);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) {
      trigger.current?.focus();
    }
  };
  const pick = (index: number): void => {
    const choice = LANG_CHOICES[index];
    close(true);
    if (choice != null && choice !== value) {
      onPick(choice);
    }
  };

  // Placed before it is painted, from where its button is now, inside the drawer — and again when
  // the window changes size, so it stays on its button. Written through the CSSOM: the page's
  // policy refuses style attributes, not that.
  useLayoutEffect(() => {
    const button = trigger.current;
    const list = menu.current;
    const frame = button?.closest(".lb-drawer");
    if (!open || button == null || list == null || frame == null) {
      return;
    }
    const place = (): void => {
      list.style.maxHeight = "";
      const r = button.getBoundingClientRect();
      const at = placeMenu({
        trigger: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
        menuHeight: list.offsetHeight,
        bounds: frame.getBoundingClientRect(),
      });
      list.style.top = `${at.top}px`;
      list.style.left = `${at.left}px`;
      list.style.width = `${at.width}px`;
      list.style.maxHeight = at.maxHeight == null ? "" : `${at.maxHeight}px`;
      list.dataset.up = String(at.up);
      list.dataset.scroll = String(at.maxHeight != null);
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // The focus follows the row the keys are on (each row takes it, so the steel ring is on the row).
  useLayoutEffect(() => {
    const list = menu.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || list == null || row == null) {
      return;
    }
    row.focus({ preventScroll: true });
    if (row.offsetTop < list.scrollTop) {
      list.scrollTop = row.offsetTop;
    } else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [open, active]);

  // A press anywhere else closes it, and so does the drawer's body scrolling under it: the menu
  // would no longer sit on its button.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target != null && menu.current?.contains(target) !== true && trigger.current?.contains(target) !== true) {
        close(false);
      }
    };
    const onMoved = (): void => {
      close(false);
    };
    const body = trigger.current?.closest(".lb-drawer-body");
    document.addEventListener("pointerdown", onDown, true);
    body?.addEventListener("scroll", onMoved);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      body?.removeEventListener("scroll", onMoved);
    };
  }, [open]);

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openMenu();
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const to = moveActive(event.key, active, LANG_CHOICES.length);
    if (to != null) {
      event.preventDefault();
      setActive(to);
      return;
    }
    switch (event.key) {
      case "Enter":
      case " ": {
        event.preventDefault();
        pick(active);
        return;
      }
      case "Escape": {
        // The menu's, not the drawer's: the drawer hears Escape on the document, past this.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      case "Tab": {
        // Back to the button, and Tab carries on from there as it would have.
        close(true);
        return;
      }
    }
    const typed = typeahead(labels, active, event.key);
    if (typed != null) {
      event.preventDefault();
      setActive(typed);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="lb-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        data-language-picker=""
        onClick={() => {
          if (open) {
            close(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={onTriggerKey}
      >
        <span id={valueId} className="lb-select-value">
          {labels[chosen]}
        </span>
        <span className="lb-select-chevron" aria-hidden="true">
          <Icon paths={CHEVRON_DOWN} size={15} />
        </span>
      </button>
      {open ? (
        <div ref={menu} id={listId} role="listbox" aria-labelledby={labelId} className="gb-overlay lb-menu" onKeyDown={onMenuKey}>
          {LANG_CHOICES.map((choice, i) => (
            <div
              key={choice}
              role="option"
              tabIndex={-1}
              aria-selected={i === chosen}
              data-active={i === active ? "true" : undefined}
              data-index={i}
              // each language's name in its own language, for a screen reader's voice
              lang={choice === "system" ? undefined : choice}
              className="gb-overlay-item lb-menu-item"
              onClick={() => pick(i)}
              onPointerMove={() => {
                if (i !== active) {
                  setActive(i);
                }
              }}
            >
              <span className="lb-menu-check" aria-hidden="true">
                {i === chosen ? <Icon paths={CHECK} size={12} /> : null}
              </span>
              {labels[i]}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
};

export type TSettingsValues = {
  setup: TSetupStatus | null;
  update: TUpdateStatus | null;
  /** A check this window asked for is waiting for main's answer. */
  checking: boolean;
  /** Null until the settings arrive: the switch waits rather than show a guess. */
  autoCapture: boolean | null;
  theme: TTheme;
  lang: TLangChoice;
  /** Open folder has somewhere to go: a log file, or the folder the engine writes into. */
  canReveal: boolean;
};

export type TSettingsActions = {
  onClose: () => void;
  /** The drawer's leaving has played out: it can go. */
  onClosed: () => void;
  onAutoCapture: (enabled: boolean) => void;
  onTheme: (theme: TTheme) => void;
  onLanguage: (choice: TLangChoice) => void;
  onCheckUpdates: () => void;
  onReveal: () => void;
  onChooseEngine: () => void;
  onPrivacy: () => void;
};

export const SettingsDrawer = ({
  s,
  phase,
  suspended,
  values,
  on,
}: {
  s: TStrings;
  phase: TDrawerPhase;
  /** The broken decoder's dialog is over it: it takes no keys and no presses until that is answered. */
  suspended: boolean;
  values: TSettingsValues;
  on: TSettingsActions;
}) => {
  const titleId = useId();
  const themeId = useId();
  const langId = useId();
  const drawer = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  // The latest handlers, for the effects below without re-running them on every render (the shell
  // renders each second for its clock).
  const handlers = useRef(on);
  handlers.current = on;

  // Close is the first stop, and harmless: Enter on arrival changes nothing. On every arrival — the
  // gear pressed again while the drawer was still leaving brings it back without a new mount.
  useLayoutEffect(() => {
    if (phase === "open") {
      drawer.current?.querySelector<HTMLElement>("[data-settings-close]")?.focus();
    }
  }, [phase]);

  // Leaving: once its animations have played (the slide out, or the fade), it goes. Nothing playing
  // — motion turned off entirely — means it goes at once.
  useLayoutEffect(() => {
    if (phase !== "closing") {
      return;
    }
    const animations = [drawer.current, scrim.current].flatMap((el) => el?.getAnimations() ?? []);
    if (animations.length === 0) {
      handlers.current.onClosed();
      return;
    }
    let current = true;
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (current) {
          handlers.current.onClosed();
        }
      },
      // cancelled: opened again before it had left
      () => {},
    );
    return () => {
      current = false;
    };
  }, [phase]);

  // The keys and an outside press are heard on the document while it is open (see above).
  useEffect(() => {
    if (phase !== "open" || suspended) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        handlers.current.onClose();
        return;
      }
      if (event.key !== "Tab" || drawer.current == null) {
        return;
      }
      const list = focusables(drawer.current);
      const first = list[0];
      const last = list[list.length - 1];
      if (first == null || last == null) {
        return;
      }
      const active = document.activeElement;
      const inside = active != null && drawer.current.contains(active);
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    // On mousedown, and its default refused: the press would otherwise take the focus to the page's
    // body after the gear had been given it back.
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target != null && drawer.current?.contains(target) !== true) {
        event.preventDefault();
        handlers.current.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [phase, suspended]);

  const { setup, update, checking, autoCapture, theme, lang, canReveal } = values;
  const version = setup != null ? `v${setup.appVersion}` : null;
  const line = updateLine(update, checking, s);
  return (
    <div className="lb-settings" data-state={phase} inert={phase === "closing" || suspended}>
      <div ref={scrim} className="gb-scrim lb-scrim lb-settings-scrim" aria-hidden="true" />
      <div ref={drawer} role="dialog" aria-modal="true" aria-labelledby={titleId} className="gb-dialog lb-drawer">
        <div className="lb-drawer-head">
          <div className="lb-drawer-titles">
            <span className="lb-drawer-eyebrow">{s.shell.appName}</span>
            <h2 className="lb-drawer-title" id={titleId}>
              {s.settings.gearLabel}
            </h2>
          </div>
          <Button
            variant="quiet"
            iconOnly
            label={s.shell.settings.close}
            icon={<Icon paths={CLOSE} size={16} />}
            className="lb-drawer-close"
            data-settings-close=""
            onClick={on.onClose}
          />
        </div>
        <div className="lb-drawer-body">
          <Section title={s.shell.session.captureTitle}>
            <div className="lb-switch-row">
              <Switch checked={autoCapture === true} disabled={autoCapture == null} onChange={on.onAutoCapture}>
                {s.prefs.autoCapture}
              </Switch>
            </div>
          </Section>
          <Section title={s.shell.settings.appearance}>
            <div className="lb-set-rows">
              <div className="lb-set-row lb-set-row--tiles">
                <span className="lb-set-label lb-set-label--tiles" id={themeId}>
                  {s.settings.theme}
                </span>
                <div className="lb-theme-tiles" role="group" aria-labelledby={themeId}>
                  {THEMES.map((t) => (
                    <ThemeTile
                      key={t}
                      theme={t}
                      chosen={t === theme}
                      label={t === "parchment" ? s.settings.themeParchment : s.settings.themeObsidian}
                      onPick={on.onTheme}
                    />
                  ))}
                </div>
              </div>
              <div className="lb-set-row">
                <span className="lb-set-label" id={langId}>
                  {s.settings.language}
                </span>
                <LanguagePicker value={lang} labelId={langId} s={s} onPick={on.onLanguage} />
              </div>
            </div>
          </Section>
          <Section title={s.settings.updates}>
            <div className="lb-set-row">
              <p className="lb-set-update">
                {version != null ? <span className="lb-set-version">{version}</span> : null}
                {line != null ? <span className="lb-set-update-line">{version != null ? `· ${line}` : line}</span> : null}
              </p>
              <Button
                variant="outline"
                size="sm"
                aria-disabled={checking ? true : undefined}
                data-settings-action="check-updates"
                onClick={() => {
                  if (!checking) {
                    on.onCheckUpdates();
                  }
                }}
              >
                {s.settings.checkUpdates}
              </Button>
            </div>
          </Section>
          <Section title={s.shell.settings.files}>
            <div className="lb-set-row">
              <Path path={setup?.captureDir ?? null} />
              <Button
                variant="outline"
                size="sm"
                icon={<Icon paths={FOLDER} />}
                disabled={!canReveal}
                data-settings-action="reveal"
                onClick={on.onReveal}
              >
                {s.shell.session.openFolder}
              </Button>
            </div>
          </Section>
          <Section title={s.settings.advancedEngine}>
            <div className="lb-set-row">
              {setup != null && setup.engineRoot == null ? (
                <span className="lb-set-note">{s.advanced.engineNotFound}</span>
              ) : (
                <Path path={setup?.engineRoot ?? null} />
              )}
              <Button variant="outline" size="sm" data-settings-action="choose-engine" onClick={on.onChooseEngine}>
                {s.buttons.chooseEngine}
              </Button>
            </div>
          </Section>
          <Section title={s.shell.settings.about}>
            <div className="lb-set-about">
              <p className="lb-set-about-name">
                <span className="lb-set-app">{s.shell.appName}</span>
                {version != null ? <span className="lb-set-version lb-set-version--about">{version}</span> : null}
              </p>
              <p className="lb-set-credit">{s.footer.engineCredit}</p>
              <div className="lb-set-links">
                {/* A link to the policy, opened in the browser through the bridge: the window never
                    navigates (src/main/windowOptions.ts refuses it). */}
                <OpenLink
                  href={PRIVACY_URL}
                  onClick={(event) => {
                    event.preventDefault();
                    on.onPrivacy();
                  }}
                >
                  {s.footer.privacy}
                </OpenLink>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};
