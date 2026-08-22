/**
 * The pairing code, as the app sees it (ADR 0092 P2 slice 4).
 *
 * A member runs `/capture pair` in Discord, reads a short code, and types it
 * here. Discord has already authenticated the human, so the code proves "this
 * member, this guild" without the app ever touching OAuth.
 *
 * ── CROSS-REPO CONTRACT ──────────────────────────────────────────────────────
 * The alphabet and length below are a verbatim copy of the bot's
 * `src/domain/capturePairing.ts`. They are duplicated rather than shared
 * because the two programs are separate (this one is GPL, the bot is closed)
 * and no build step links them — the same arrangement as `AO_LOOT_RE` in the
 * bot's loot parser, which `tools/mock-engine.cjs` is pinned against.
 *
 * If the bot ever changes the alphabet, this file must change with it. A test
 * pins the exact string so the copy cannot be edited casually.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here talks to the network: normalising and shape-checking locally is
 * what lets the app refuse a mistyped code instantly instead of spending a
 * round trip to be told the same thing.
 */

/** Crockford-style base32 — no I, L, O or U. Must equal the bot's constant. */
export const PAIR_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const PAIR_CODE_LENGTH = 8;

/**
 * Accept what a human actually types: lowercase, spaces, the dash the bot
 * renders for readability, and the three characters the alphabet deliberately
 * omits (someone WILL type O for 0). Mapping them beats rejecting them — a
 * member who typed the code exactly as they read it must never see "invalid".
 */
export const normalizePairCode = (raw: string): string => {
  return raw.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
};

export const isValidPairCodeShape = (normalized: string): boolean => {
  if (normalized.length !== PAIR_CODE_LENGTH) {
    return false;
  }
  return [...normalized].every((ch) => PAIR_CODE_ALPHABET.includes(ch));
};

/**
 * A default name for this computer, shown in `/capture devices` and on the web.
 *
 * The hostname is the only thing available without asking, and asking would put
 * a second field in front of a member who just wants to pair. Trimmed and
 * capped because it is stored and rendered elsewhere.
 */
export const defaultDeviceName = (hostname: string, platform: string): string => {
  const clean = hostname.replace(/\.local$/i, "").trim();
  if (clean.length > 0) {
    return clean.slice(0, 40);
  }
  return platform === "darwin" ? "Mac" : platform === "win32" ? "PC" : "Computer";
};
