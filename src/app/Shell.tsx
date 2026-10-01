import { Button } from "@guild-butler/design-system/react";

import type { TStrings } from "../shared/strings.js";

/**
 * The shell's frame: the title bar over the main region. Drawn from boards Fh1 and F1 (the
 * capture canvas, page v5). The bar's status and its one action, the version and the sidebar
 * arrive with the store; until then the bar is the crest, the wordmark and the gear.
 */

/** Tabler Icons' "settings", outline (MIT) — the gear on board Fh1. */
const GEAR = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
    <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
  </svg>
);

export const Shell = ({ strings }: { strings: TStrings }) => {
  return (
    <>
      <header className="lb-titlebar">
        <img src="./crest.png" alt="" width={26} height={26} className="h-[26px] w-[26px] flex-none" />
        {/* The wordmark is the serif's one use in the app (the package README). The board sets it
            at 700; the package ships the serif at 500 and 600 only, so 600 is what draws. */}
        <span className="relative top-px whitespace-nowrap font-serif text-[18px] font-semibold tracking-[0.01em] text-ink">
          {strings.shell.appName}
        </span>
        <div className="flex-1" />
        {/* The design system's Button. Inert for now: where settings live is still a pick on the
            canvas (Fh6), and the gear opens whatever is built there. */}
        <Button variant="quiet" size="sm" iconOnly label={strings.settings.gearLabel} icon={GEAR} />
      </header>
      <main id="main" className="min-h-0 flex-1 overflow-auto" />
    </>
  );
};
