/**
 * What the settings drawer says, and where its language menu goes (board Fh6, option C), decided
 * apart from how they are drawn. Pure — values and the words in, a plain value out — so
 * test/shellSettings.test.ts holds them without a window.
 *
 * The drawer's rows are the old window's gear popover's, in its words (src/renderer/renderer.ts):
 * the auto-start switch, the theme, the language, the update line and its check, the engine
 * folder, the credit and the privacy policy. The drawer adds the folder the logs go to.
 */

import { EUpdatePhase, type TUpdateStatus } from "../shared/captureTypes.js";
import { asLang, LANG_NAMES, SUPPORTED_LANGS, type TLang } from "../shared/i18n.js";
import type { TStrings } from "../shared/strings.js";

/** A row of the language menu: the OS's language ("System", stored as no language), or one of ours. */
export type TLangChoice = "system" | TLang;

/** "System" first — the default, and what a member lost in the wrong language looks for — then each language. */
export const LANG_CHOICES: readonly TLangChoice[] = ["system", ...SUPPORTED_LANGS];

/** The stored language as a row of the menu: a value we do not speak reads as "System", as it behaves. */
export const langChoiceOf = (stored: string | null | undefined): TLangChoice => asLang(stored) ?? "system";

/** What a row says: each language in itself, never translated (src/shared/i18n.ts); only "System" is. */
export const langChoiceLabel = (choice: TLangChoice, s: TStrings): string =>
  choice === "system" ? s.settings.system : LANG_NAMES[choice];

/** What the bridge stores for a row: no language at all for "System" (follow the OS). */
export const storedLang = (choice: TLangChoice): TLang | null => (choice === "system" ? null : choice);

/**
 * The words after the version on the Updates row — the old gear popover's line (renderUpdateInline),
 * the phase in the app's own sentences. A check this window asked for says "checking…" until main
 * answers. Nothing until the first status arrives: the row does not guess "up to date".
 */
export const updateLine = (update: TUpdateStatus | null, checking: boolean, s: TStrings): string | null => {
  if (checking) {
    return s.settings.checking;
  }
  if (update == null) {
    return null;
  }
  switch (update.phase) {
    case EUpdatePhase.Checking: {
      return s.settings.checking;
    }
    case EUpdatePhase.Downloading: {
      return s.update.downloading(update.version, update.percent);
    }
    case EUpdatePhase.Ready: {
      return s.update.ready(update.version);
    }
    case EUpdatePhase.Error: {
      return s.update.failed(update.error);
    }
    case EUpdatePhase.UpToDate: {
      return s.settings.upToDate;
    }
    default: {
      return s.settings.updateOff;
    }
  }
};

/**
 * A folder's path in the pieces it may break between, each with the separator that ends it (board
 * Fh6 breaks a path only after a separator): `/Users/a/b` is `/`, `Users/`, `a/`, `b`; `C:\Users\b`
 * is `C:\`, `Users\`, `b`. Joined, the pieces are the path again.
 */
export const pathParts = (path: string): string[] => {
  const parts = path.match(/[^\\/]*[\\/]|[^\\/]+$/g);
  return parts == null || parts.length === 0 ? [path] : parts;
};

export type TRect = { top: number; bottom: number; left: number; width: number };

export type TMenuPlace = {
  top: number;
  left: number;
  width: number;
  /** Set when the menu is taller than the room either side of its button: it scrolls in this much. */
  maxHeight: number | null;
  /** It opens above its button: there was not room for it below, and there was more above. */
  up: boolean;
};

/**
 * Where the language menu goes. It floats over the drawer, fixed to the window — the drawer's body
 * scrolls in a small window and would cut it — the width of its button, and inside `bounds` (the
 * drawer), `margin` clear of its edges: below the button when it fits there, else wherever there is
 * more room. In the smallest window (768×620) the menu, seven rows, opens upward.
 */
export const placeMenu = ({
  trigger,
  menuHeight,
  bounds,
  gap = 4,
  margin = 8,
}: {
  trigger: TRect;
  menuHeight: number;
  bounds: { top: number; bottom: number; left: number; right: number };
  gap?: number;
  margin?: number;
}): TMenuPlace => {
  const below = bounds.bottom - margin - (trigger.bottom + gap);
  const above = trigger.top - gap - (bounds.top + margin);
  const up = menuHeight > below && above > below;
  const room = Math.max(0, up ? above : below);
  const height = Math.min(menuHeight, room);
  const left = Math.max(bounds.left + margin, Math.min(trigger.left, bounds.right - margin - trigger.width));
  return {
    top: up ? trigger.top - gap - height : trigger.bottom + gap,
    left,
    width: trigger.width,
    maxHeight: menuHeight > room ? room : null,
    up,
  };
};

/** Which row a key moves to in a menu of `count` rows (the arrows, Home and End); null for any other key. */
export const moveActive = (key: string, active: number, count: number): number | null => {
  if (count <= 0) {
    return null;
  }
  switch (key) {
    case "ArrowDown": {
      return Math.min(count - 1, active + 1);
    }
    case "ArrowUp": {
      return Math.max(0, active - 1);
    }
    case "Home":
    case "PageUp": {
      return 0;
    }
    case "End":
    case "PageDown": {
      return count - 1;
    }
    default: {
      return null;
    }
  }
};

/**
 * Type a letter and the menu moves to the next row whose words start with it, after the one it is
 * on, wrapping — so a letter pressed again walks every row that starts with it. Each row is in its
 * own script ("Deutsch", "Русский"), so a member finds theirs by the letter their keyboard types.
 * Null when no row starts with it, or for a key that is not one character.
 */
export const typeahead = (labels: readonly string[], active: number, key: string): number | null => {
  if ([...key].length !== 1 || key.trim() === "") {
    return null;
  }
  const letter = key.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const i = (active + step) % labels.length;
    if ((labels[i] ?? "").toLocaleLowerCase().startsWith(letter)) {
      return i;
    }
  }
  return null;
};
