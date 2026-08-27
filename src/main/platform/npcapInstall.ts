/**
 * In-app Npcap install — the "one .exe and that's it" path for Windows.
 *
 * Capturing on Windows needs Npcap, and we may NOT ship it: the free licence
 * covers neither redistribution nor the silent `/S` installer — both are
 * Npcap OEM (paid) features. So the app cannot install it invisibly, and
 * anyone who bundled it anyway would be violating that licence.
 *
 * What IS allowed, and what this does: fetch the installer from Npcap's OWN
 * server on the user's behalf and launch it, so the member never leaves the
 * app to hunt for a download. They click through Npcap's own short wizard
 * once (its defaults are the ones we want) and capture works.
 *
 * Two safety rules, because this downloads an executable and runs it:
 *   1. The download is verified by AUTHENTICODE SIGNATURE, not by a pinned
 *      hash. A hash would pin one version forever and rot at the next Npcap
 *      release; the signature proves the file really came from Npcap's
 *      publisher whatever the version — which is the property we actually
 *      want. An unsigned or wrongly-signed file is never executed.
 *   2. Every failure degrades to the browser link that shipped before this
 *      (`NPCAP_URL`). This flow is a convenience over that path, never a
 *      replacement for it.
 *
 * The version is discovered from Npcap's download page rather than hardcoded,
 * with a pinned fallback, so a new Npcap release needs no app release.
 */

import {
  ECaptureAccess,
  ENpcapInstallOutcome,
  type TNpcapInstallResult,
} from "../../shared/captureTypes.js";

/** Where the installer list lives. Also the page a failure sends people to. */
export const NPCAP_HOME = "https://npcap.com/";

/**
 * Used only when the download page cannot be read or parsed. A stale-but-real
 * version still installs a working Npcap (capture does not need the newest),
 * which is a far better failure than sending the member to a 404.
 */
export const NPCAP_FALLBACK_URL = "https://npcap.com/dist/npcap-1.79.exe";

/** Npcap installers are Authenticode-signed by the Nmap Project's legal entity. */
export const NPCAP_SIGNER_PATTERN = /insecure\.com|nmap/i;

/** `npcap-1.79.exe` → `[1, 79]`, for picking the newest link on the page. */
const versionKey = (version: string): number[] => {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
};

const isNewer = (a: string, b: string): boolean => {
  const [ka, kb] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
    const [x, y] = [ka[i] ?? 0, kb[i] ?? 0];
    if (x !== y) {
      return x > y;
    }
  }
  return false;
};

export type TNpcapRelease = { url: string; version: string };

/**
 * Find the newest `npcap-<version>.exe` on Npcap's download page.
 *
 * Deliberately liberal about the surrounding HTML (their page is hand-written
 * and has changed shape over the years) and strict about the FILENAME, which
 * is the part that has been stable for a decade. Relative hrefs are resolved
 * against the page; anything off npcap.com is ignored, so a mirror or an
 * advert link can never redirect this at someone else's binary.
 */
export const parseLatestNpcapRelease = (html: string, pageUrl: string = NPCAP_HOME): TNpcapRelease | null => {
  let best: TNpcapRelease | null = null;
  for (const match of html.matchAll(/href\s*=\s*["']([^"']*npcap-(\d+(?:\.\d+)+)\.exe)["']/gi)) {
    const [, href, version] = match;
    if (href == null || version == null) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    // Same-site only: the page also links sponsors, mirrors and OEM pages.
    if (url.protocol !== "https:" || !/(^|\.)npcap\.com$|(^|\.)nmap\.org$/i.test(url.hostname)) {
      continue;
    }
    if (best == null || isNewer(version, best.version)) {
      best = { url: url.toString(), version };
    }
  }
  return best;
};

/** Does this Authenticode subject belong to Npcap's publisher? */
export const isTrustedNpcapSigner = (subject: string | null): boolean => {
  return subject != null && NPCAP_SIGNER_PATTERN.test(subject);
};

export type TSignatureCheck = { status: string | null; subject: string | null };

/**
 * Parse the `STATUS|SUBJECT` line our PowerShell one-liner prints. Kept pure
 * (and tested) because a mis-parse here would either reject every genuine
 * installer or, much worse, accept an unsigned one.
 */
export const parseSignatureOutput = (stdout: string): TSignatureCheck => {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .pop();
  if (line == null) {
    return { status: null, subject: null };
  }
  const idx = line.indexOf("|");
  if (idx < 0) {
    return { status: line, subject: null };
  }
  return { status: line.slice(0, idx).trim(), subject: line.slice(idx + 1).trim() };
};

/** Signed, valid, and by Npcap's publisher — all three, or we do not run it. */
export const isAcceptableSignature = (check: TSignatureCheck): boolean => {
  return check.status?.toLowerCase() === "valid" && isTrustedNpcapSigner(check.subject);
};

export type TNpcapInstallDeps = {
  /** GET the download page as text. Rejects on any network failure. */
  fetchText: (url: string) => Promise<string>;
  /** Download `url` to a local path and resolve with that path. */
  download: (url: string) => Promise<string>;
  /** Authenticode check of a local file. */
  verify: (path: string) => Promise<TSignatureCheck>;
  /** Launch the installer, resolve when it exits. Rejects if it never started. */
  run: (path: string) => Promise<void>;
  /** Re-probe capture readiness after the installer exits. */
  probe: () => Promise<ECaptureAccess>;
  /** Best-effort delete of the downloaded file. */
  cleanup: (path: string) => void;
  log: (line: string) => void;
};

/**
 * Fetch → verify → run → re-probe. Every step's failure has its own outcome,
 * because "it didn't work" is exactly the message that cost this project a
 * day of debugging on the macOS side: the UI must be able to say WHICH step
 * failed and what the member should do about it.
 */
export const installNpcap = async (deps: TNpcapInstallDeps): Promise<TNpcapInstallResult> => {
  let release: TNpcapRelease | null = null;
  try {
    release = parseLatestNpcapRelease(await deps.fetchText(NPCAP_HOME));
  } catch (err) {
    deps.log(`npcap: download page unreadable (${String(err)}) — using the pinned fallback`);
  }
  const url = release?.url ?? NPCAP_FALLBACK_URL;
  const version = release?.version ?? null;
  deps.log(`npcap: installer ${url}`);

  let file: string;
  try {
    file = await deps.download(url);
  } catch (err) {
    return { outcome: ENpcapInstallOutcome.DownloadFailed, version, detail: String(err).slice(0, 300) };
  }

  try {
    const check = await deps.verify(file);
    deps.log(`npcap: signature status=${check.status ?? "?"} subject=${check.subject ?? "?"}`);
    if (!isAcceptableSignature(check)) {
      return {
        outcome: ENpcapInstallOutcome.Untrusted,
        version,
        detail: `signature ${check.status ?? "missing"} / ${check.subject ?? "no subject"}`,
      };
    }

    try {
      await deps.run(file);
    } catch (err) {
      // Only a REAL UAC decline is "cancelled" — the runner marks it (the
      // Start-Process error names ERROR_CANCELLED). Everything else is the
      // installer failing to START, which "try again and accept it" cannot
      // fix; v0.3.1 mapped every launch failure here and told a tester who
      // was never shown a prompt that they had declined one.
      const declined = (err as { gbcUacDeclined?: boolean }).gbcUacDeclined === true;
      return {
        outcome: declined ? ENpcapInstallOutcome.Cancelled : ENpcapInstallOutcome.LaunchFailed,
        version,
        detail: String(err instanceof Error ? err.message : err).slice(0, 300),
      };
    }

    const access = await deps.probe();
    // Ok OR admin-only: both mean the driver is installed. Admin-only is a
    // separate, already-explained problem — not a failure of this install.
    const present = access === ECaptureAccess.Ok || access === ECaptureAccess.NpcapAdminOnly;
    return {
      outcome: present ? ENpcapInstallOutcome.Installed : ENpcapInstallOutcome.NotCompleted,
      version,
      detail: `access=${access}`,
    };
  } finally {
    deps.cleanup(file);
  }
};
