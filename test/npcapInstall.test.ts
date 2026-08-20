import { describe, expect, it, vi } from "vitest";

import {
  installNpcap,
  isAcceptableSignature,
  isTrustedNpcapSigner,
  NPCAP_FALLBACK_URL,
  parseLatestNpcapRelease,
  parseSignatureOutput,
  type TNpcapInstallDeps,
} from "../src/main/platform/npcapInstall.js";
import { ECaptureAccess, ENpcapInstallOutcome } from "../src/shared/captureTypes.js";

/**
 * This flow downloads an executable and runs it, so the tests are weighted
 * towards the two questions that matter: can a wrong file ever be executed,
 * and does each failure produce its own outcome (the UI has to say WHICH step
 * failed — a generic "didn't work" is what made the macOS permission bug take
 * a day to find).
 */

/** Shaped like Npcap's real download page: several versions, plus other links. */
const PAGE = `
<h2>Npcap Free Edition</h2>
<a href="/dist/npcap-1.79.exe">Npcap 1.79 installer</a>
<a href="https://npcap.com/dist/npcap-1.82.exe">Npcap 1.82 installer for Windows</a>
<a href="/dist/npcap-1.9.exe">an older one</a>
<a href="https://evil.example.com/dist/npcap-9.99.exe">not ours</a>
<a href="/oem/">Npcap OEM</a>
<a href="/dist/npcap-sdk-1.13.zip">SDK</a>
`;

describe("npcap release discovery", () => {
  it("takes the newest same-site installer, comparing versions numerically", () => {
    // 1.82 must beat 1.9 — string ordering would pick "1.9".
    expect(parseLatestNpcapRelease(PAGE)).toEqual({
      url: "https://npcap.com/dist/npcap-1.82.exe",
      version: "1.82",
    });
  });

  it("resolves relative hrefs against the page", () => {
    const found = parseLatestNpcapRelease(`<a href="/dist/npcap-1.50.exe">x</a>`);
    expect(found?.url).toBe("https://npcap.com/dist/npcap-1.50.exe");
  });

  it("never follows an off-site link — a mirror or advert cannot redirect this", () => {
    const found = parseLatestNpcapRelease(`<a href="https://evil.example.com/npcap-9.99.exe">x</a>`);
    expect(found).toBeNull();
  });

  it("ignores http:// links — the installer is fetched over TLS or not at all", () => {
    expect(parseLatestNpcapRelease(`<a href="http://npcap.com/dist/npcap-1.82.exe">x</a>`)).toBeNull();
  });

  it("returns null on a page with no installer link, so the caller falls back", () => {
    expect(parseLatestNpcapRelease("<h1>maintenance</h1>")).toBeNull();
  });
});

describe("npcap signature checking", () => {
  it("parses the STATUS|SUBJECT line", () => {
    const check = parseSignatureOutput("Valid|CN=Insecure.Com LLC, O=Insecure.Com LLC, C=US\n");
    expect(check.status).toBe("Valid");
    expect(check.subject).toContain("Insecure.Com LLC");
  });

  it("survives PowerShell noise before the answer", () => {
    const check = parseSignatureOutput("WARNING: something\nValid|CN=Insecure.Com LLC");
    expect(check).toEqual({ status: "Valid", subject: "CN=Insecure.Com LLC" });
  });

  it("accepts only a valid signature from Npcap's publisher", () => {
    expect(isAcceptableSignature({ status: "Valid", subject: "CN=Insecure.Com LLC" })).toBe(true);
    // Right publisher, bad signature — the file was tampered with.
    expect(isAcceptableSignature({ status: "HashMismatch", subject: "CN=Insecure.Com LLC" })).toBe(false);
    // Valid signature, wrong publisher — someone else's signed binary.
    expect(isAcceptableSignature({ status: "Valid", subject: "CN=Contoso Ltd" })).toBe(false);
    // No signature at all.
    expect(isAcceptableSignature({ status: "NotSigned", subject: null })).toBe(false);
    expect(isTrustedNpcapSigner(null)).toBe(false);
  });
});

describe("npcap install flow", () => {
  const deps = (over: Partial<TNpcapInstallDeps> = {}): TNpcapInstallDeps & { ran: string[] } => {
    const ran: string[] = [];
    return {
      ran,
      fetchText: async () => PAGE,
      download: async () => "C:\\Temp\\npcap.exe",
      verify: async () => ({ status: "Valid", subject: "CN=Insecure.Com LLC" }),
      run: async (p) => {
        ran.push(p);
      },
      probe: async () => ECaptureAccess.Ok,
      cleanup: () => {},
      log: () => {},
      ...over,
    };
  };

  it("happy path: newest version downloaded, verified, run, then confirmed present", async () => {
    const d = deps();
    const result = await installNpcap(d);
    expect(result.outcome).toBe(ENpcapInstallOutcome.Installed);
    expect(result.version).toBe("1.82");
    expect(d.ran).toEqual(["C:\\Temp\\npcap.exe"]);
  });

  it("falls back to the pinned installer when the page cannot be read", async () => {
    const urls: string[] = [];
    const result = await installNpcap(
      deps({
        fetchText: async () => {
          throw new Error("ENOTFOUND");
        },
        download: async (u) => {
          urls.push(u);
          return "C:\\Temp\\npcap.exe";
        },
      }),
    );
    expect(urls).toEqual([NPCAP_FALLBACK_URL]);
    expect(result.outcome).toBe(ENpcapInstallOutcome.Installed);
  });

  it("NEVER runs a file whose signature is not Npcap's", async () => {
    const d = deps({ verify: async () => ({ status: "Valid", subject: "CN=Someone Else" }) });
    const result = await installNpcap(d);
    expect(result.outcome).toBe(ENpcapInstallOutcome.Untrusted);
    expect(d.ran).toEqual([]);
  });

  it("NEVER runs an unsigned file", async () => {
    const d = deps({ verify: async () => ({ status: "NotSigned", subject: null }) });
    const result = await installNpcap(d);
    expect(result.outcome).toBe(ENpcapInstallOutcome.Untrusted);
    expect(d.ran).toEqual([]);
  });

  it("reports a failed download as its own outcome", async () => {
    const result = await installNpcap(
      deps({
        download: async () => {
          throw new Error("HTTP 404");
        },
      }),
    );
    expect(result.outcome).toBe(ENpcapInstallOutcome.DownloadFailed);
    expect(result.detail).toContain("404");
  });

  it("a declined UAC prompt is Cancelled, not a failure", async () => {
    const result = await installNpcap(
      deps({
        run: async () => {
          throw new Error("EACCES: operation not permitted");
        },
      }),
    );
    expect(result.outcome).toBe(ENpcapInstallOutcome.Cancelled);
  });

  it("installer ran but Npcap still missing = wizard cancelled, distinctly reported", async () => {
    const result = await installNpcap(deps({ probe: async () => ECaptureAccess.NpcapMissing }));
    expect(result.outcome).toBe(ENpcapInstallOutcome.NotCompleted);
  });

  it("admin-only afterwards still counts as installed — that is a separate, explained problem", async () => {
    const result = await installNpcap(deps({ probe: async () => ECaptureAccess.NpcapAdminOnly }));
    expect(result.outcome).toBe(ENpcapInstallOutcome.Installed);
  });

  it("always deletes the downloaded installer, including on the untrusted path", async () => {
    const cleanup = vi.fn();
    await installNpcap(deps({ cleanup }));
    await installNpcap(deps({ cleanup, verify: async () => ({ status: "NotSigned", subject: null }) }));
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledWith("C:\\Temp\\npcap.exe");
  });
});
