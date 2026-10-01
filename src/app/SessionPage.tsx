import { useId, type ReactNode } from "react";

import { Button, Switch } from "@guild-butler/design-system/react";

import type { TStrings } from "../shared/strings.js";
import { APPEARS, FOLDER, HERO, Icon, INFO, PLAY, PLUG } from "./icons.js";
import type { THero } from "./model.js";

/**
 * Session before there is anything to show (boards Fh3 dark, Fh7 parchment): a hero card for the
 * capture's state, what will appear here, and at the right the three things a member can set up
 * — a guild, the folder, auto-start. From 1280 the right column is 400 px, at 1024 it is 320, and
 * below that it moves under the page (board Fr).
 *
 * Buttons inside cards are outlined (the bar holds the window's one filled button). Pair with
 * Discord is inert until the pairing step; Open folder is the bridge's reveal, as the old window's
 * Reveal is; the switch is the stored auto-start, as the old window's.
 */

const Card = ({ title, icon, children }: { title: string; icon: readonly string[]; children: ReactNode }) => {
  const id = useId();
  return (
    <section className="gb-card lb-card" aria-labelledby={id}>
      <div className="lb-card-head">
        <span className="lb-tile lb-tile--head" aria-hidden="true">
          <Icon paths={icon} size={13} />
        </span>
        <h2 className="lb-card-title" id={id}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
};

const Hero = ({ hero, s }: { hero: THero; s: TStrings }) => {
  const id = useId();
  const reasons = useId();
  return (
    <section className="gb-card lb-hero" aria-labelledby={id}>
      <div className="lb-hero-row">
        <span className="lb-tile lb-tile--hero" aria-hidden="true">
          <Icon paths={HERO[hero.icon]} size={22} />
        </span>
        <div className="lb-hero-text">
          <h2 className="lb-hero-title" id={id}>
            {hero.title}
          </h2>
          {hero.lines.map((line, i) => (
            <p key={line} className={i > 0 && hero.tight ? "lb-hero-line lb-hero-line--tight" : "lb-hero-line"}>
              {line}
            </p>
          ))}
        </div>
      </div>
      {hero.reasons ? (
        <div className="lb-reasons">
          <h3 className="lb-eyebrow" id={reasons}>
            {s.waitingHints.toggle}
          </h3>
          <ul className="lb-reasons-list" aria-labelledby={reasons}>
            {s.waitingHints.items.map((item) => (
              <li key={item.lead}>
                <span className="lb-reason-lead">{item.lead}</span>
                <span className="lb-reason-body">{item.body}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export const SessionPage = ({
  s,
  hero,
  platform,
  paired,
  autoCapture,
  onReveal,
  onAutoCapture,
}: {
  s: TStrings;
  hero: THero | null;
  platform: string;
  /** Null until the pairing is known: the pair card waits rather than flash past a paired member. */
  paired: boolean | null;
  autoCapture: boolean | null;
  onReveal: () => void;
  onAutoCapture: (enabled: boolean) => void;
}) => {
  const page = s.shell.session;
  return (
    <div className="lb-session">
      <div className="lb-col">
        {hero != null ? <Hero hero={hero} s={s} /> : null}
        <Card title={page.appearsTitle} icon={INFO}>
          <ul className="lb-appears">
            {page.appears.map((row, i) => (
              <li key={row.lead}>
                <span className="lb-tile lb-tile--row" aria-hidden="true">
                  <Icon paths={APPEARS[i] ?? INFO} size={16} />
                </span>
                <span className="lb-appears-text">
                  <span className="lb-appears-lead">{row.lead}</span>
                  <span className="lb-appears-body">{row.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="lb-col">
        {paired === false ? (
          <Card title={s.pairing.title} icon={PLUG}>
            <p className="lb-card-text">{s.pairing.intro}</p>
            <p className="lb-card-small">{page.pairOptional}</p>
            <div className="lb-card-actions">
              <Button variant="outline">{s.pairing.pair}</Button>
            </div>
          </Card>
        ) : null}
        <Card title={platform === "darwin" ? page.folderTitleMac : page.folderTitle} icon={FOLDER}>
          <p className="lb-card-text">{page.folderBody}</p>
          <div className="lb-card-actions">
            <Button variant="outline" icon={<Icon paths={FOLDER} />} onClick={onReveal}>
              {page.openFolder}
            </Button>
          </div>
        </Card>
        <Card title={page.captureTitle} icon={PLAY}>
          <div className="lb-switch-row">
            <Switch checked={autoCapture === true} disabled={autoCapture == null} onChange={onAutoCapture}>
              {s.prefs.autoCapture}
            </Switch>
          </div>
        </Card>
      </div>
    </div>
  );
};
