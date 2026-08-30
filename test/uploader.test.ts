import { describe, expect, it } from "vitest";

import {
  EPairOutcome,
  EUploadOutcome,
  apiBase,
  isMissingEndpoint,
  isRetryable,
  pairDevice,
  uploadBatch,
} from "../src/main/uploadClient.js";
import { createUploader, EUploaderState, retryDelayMs } from "../src/main/uploader.js";
import { decryptToken, encryptPairing, EStoreOutcome, type TSafeStorage } from "../src/main/pairingStore.js";
import { defaultDeviceName, isValidPairCodeShape, normalizePairCode, PAIR_CODE_ALPHABET } from "../src/shared/pairing.js";

/**
 * The upload path end to end, with no network and no Electron.
 *
 * The property that matters most is negative: **nothing here may interfere with
 * capturing.** Every failure is reported and retried; none of it throws into
 * the caller, because the file on disk is the fallback and the drag-and-drop
 * path still works.
 */

// --- the cross-repo contract -------------------------------------------------

describe("pairing code (contract with the bot)", () => {
  it("uses the bot's exact alphabet", () => {
    // Duplicated deliberately — two separate programs, no shared build. If the
    // bot's domain/capturePairing.ts changes this string, this test is the
    // thing that should fail.
    expect(PAIR_CODE_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  });

  it("accepts the code exactly as Discord displays it", () => {
    expect(normalizePairCode("3wea-j4dr")).toBe("3WEAJ4DR");
    expect(normalizePairCode(" 3WEA J4DR ")).toBe("3WEAJ4DR");
  });

  it("maps the characters the alphabet omits, rather than refusing them", () => {
    // A member who typed what they read must never be told they got it wrong.
    expect(normalizePairCode("O0IL")).toBe("0011");
  });

  it("shape-checks locally so a typo costs no round trip", () => {
    expect(isValidPairCodeShape("3WEAJ4DR")).toBe(true);
    expect(isValidPairCodeShape("3WEAJ4D")).toBe(false);
    expect(isValidPairCodeShape("3WEAJ4D!")).toBe(false);
    expect(isValidPairCodeShape("")).toBe(false);
  });
});

describe("defaultDeviceName", () => {
  it("uses the hostname, without the mDNS suffix", () => {
    expect(defaultDeviceName("Borys-MacBook.local", "darwin")).toBe("Borys-MacBook");
  });

  it("falls back to something a member recognises", () => {
    expect(defaultDeviceName("", "darwin")).toBe("Mac");
    expect(defaultDeviceName("   ", "win32")).toBe("PC");
    expect(defaultDeviceName("", "linux")).toBe("Computer");
  });
});

describe("apiBase", () => {
  it("defaults to production and strips a trailing slash", () => {
    expect(apiBase(null)).toBe("https://app.guild-butler.com");
    expect(apiBase("  ")).toBe("https://app.guild-butler.com");
    expect(apiBase("http://localhost:3000/")).toBe("http://localhost:3000");
  });
});

// --- token storage -----------------------------------------------------------

const safeOk = (): TSafeStorage => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (buf) => buf.toString().replace(/^enc:/, ""),
});

describe("pairing store", () => {
  const input = { token: "secret-token", guildId: "g1", userId: "u1", deviceId: 7, deviceName: "Mac" };

  it("encrypts the token and stores identity in the clear", () => {
    const r = encryptPairing(safeOk(), input, 1_000);
    expect(r.outcome).toBe(EStoreOutcome.Stored);
    if (r.outcome !== EStoreOutcome.Stored) {
      return;
    }
    expect(r.pairing.tokenEnc).not.toContain("secret-token");
    expect(r.pairing.guildId).toBe("g1");
    expect(decryptToken(safeOk(), r.pairing)).toBe("secret-token");
  });

  it("REFUSES to store when the OS cannot encrypt, rather than writing plaintext", () => {
    // The whole point of the module. A silent downgrade would put a live bearer
    // token in a JSON file on exactly the machines least able to protect it.
    const safe: TSafeStorage = { ...safeOk(), isEncryptionAvailable: () => false };
    expect(encryptPairing(safe, input, 1_000).outcome).toBe(EStoreOutcome.NoEncryption);
  });

  it("reports a failed encryption instead of falling back", () => {
    const safe: TSafeStorage = {
      ...safeOk(),
      encryptString: () => {
        throw new Error("keychain locked");
      },
    };
    const r = encryptPairing(safe, input, 1_000);
    expect(r.outcome).toBe(EStoreOutcome.Failed);
  });

  it("treats an undecryptable token as unpaired — a real path after a restore", () => {
    const safe: TSafeStorage = {
      ...safeOk(),
      decryptString: () => {
        throw new Error("bad key");
      },
    };
    const stored = encryptPairing(safeOk(), input, 1_000);
    if (stored.outcome !== EStoreOutcome.Stored) {
      throw new Error("setup");
    }
    expect(decryptToken(safe, stored.pairing)).toBeNull();
    expect(decryptToken(safeOk(), undefined)).toBeNull();
  });
});

// --- the HTTP client ---------------------------------------------------------

const reply = (status: number, body: unknown) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

describe("pairDevice", () => {
  it("returns the device on success", async () => {
    const r = await pairDevice(
      reply(200, { token: "t", guildId: "g", userId: "u", deviceId: 3, deviceName: "Mac" }),
      "https://bot",
      "3WEAJ4DR",
      "Mac",
    );
    expect(r.outcome).toBe(EPairOutcome.Paired);
  });

  it("names a refusal separately from being unable to reach the bot", async () => {
    const refused = await pairDevice(reply(400, { error: "not-found" }), "https://bot", "ZZZZ9999", "Mac");
    expect(refused.outcome).toBe(EPairOutcome.Refused);

    const down = await pairDevice(
      async () => {
        throw new Error("ENOTFOUND");
      },
      "https://bot",
      "3WEAJ4DR",
      "Mac",
    );
    expect(down.outcome).toBe(EPairOutcome.Unreachable);
  });

  it("tells a MISSING ROUTE apart from a refusal", async () => {
    // The two need opposite things from the member. A refusal means get a fresh
    // code; a missing route means no code will ever work and an officer has to
    // update the bot. Folding them together sends them round a loop.
    for (const status of [404, 405]) {
      const r = await pairDevice(reply(status, {}), "https://bot", "3WEAJ4DR", "Mac");
      expect(r.outcome, String(status)).toBe(EPairOutcome.NotDeployed);
    }
    const refused = await pairDevice(reply(400, { error: "not-found" }), "https://bot", "ZZZZ9999", "Mac");
    expect(refused.outcome).toBe(EPairOutcome.Refused);
  });

  it("refuses a 200 that is missing the token, rather than storing junk", async () => {
    const r = await pairDevice(reply(200, { guildId: "g", userId: "u" }), "https://bot", "3WEAJ4DR", "Mac");
    expect(r.outcome).toBe(EPairOutcome.BadReply);
  });
});

describe("uploadBatch", () => {
  const batch = { from: 0, lines: ["a"] };

  it("classifies every status the server can answer with", async () => {
    const cases: Array<[number, unknown, EUploadOutcome]> = [
      [200, { accepted: 1, duplicate: 0, rejected: 0, nextFrom: 1 }, EUploadOutcome.Accepted],
      [401, { error: "unauthorized" }, EUploadOutcome.Unauthorized],
      [429, { error: "over_budget" }, EUploadOutcome.RateLimited],
      [400, { error: "bad_run" }, EUploadOutcome.Rejected],
      [404, {}, EUploadOutcome.NotDeployed],
      [405, {}, EUploadOutcome.NotDeployed],
      [503, {}, EUploadOutcome.ServerError],
    ];
    for (const [status, body, expected] of cases) {
      const r = await uploadBatch(reply(status, body), "https://bot", "tok", "run", "f.txt", batch);
      expect(r.outcome, String(status)).toBe(expected);
    }
  });

  it("marks the transient failures retryable and the rest not", () => {
    expect(isRetryable(EUploadOutcome.Unreachable)).toBe(true);
    expect(isRetryable(EUploadOutcome.ServerError)).toBe(true);
    expect(isRetryable(EUploadOutcome.RateLimited)).toBe(true);
    expect(isRetryable(EUploadOutcome.Unauthorized)).toBe(false);
    expect(isRetryable(EUploadOutcome.Rejected)).toBe(false);
    // Not the member's to fix, but it heals itself when the bot is updated.
    expect(isRetryable(EUploadOutcome.NotDeployed)).toBe(true);
  });

  it("recognises a missing endpoint by status", () => {
    expect(isMissingEndpoint(404)).toBe(true);
    expect(isMissingEndpoint(405)).toBe(true);
    expect(isMissingEndpoint(400)).toBe(false);
    expect(isMissingEndpoint(500)).toBe(false);
  });
});

// --- the loop ----------------------------------------------------------------

type THarness = {
  calls: Array<{ run: string; from: number; count: number }>;
  setReply: (fn: (from: number) => { status: number; body: unknown }) => void;
  file: { path: string | null; text: string };
  clock: { now: number };
  logs: string[];
};

const harness = (): { uploader: ReturnType<typeof createUploader>; h: THarness } => {
  const h: THarness = {
    calls: [],
    setReply: () => undefined,
    file: { path: "/logs/a.txt", text: "" },
    clock: { now: 1_000 },
    logs: [],
  };
  let replyFor = (from: number): { status: number; body: unknown } => ({
    status: 200,
    body: { accepted: 1, duplicate: 0, rejected: 0, nextFrom: from },
  });
  h.setReply = (fn) => {
    replyFor = fn;
  };
  let runSeq = 0;

  const uploader = createUploader({
    fetchLike: async (_url, init) => {
      const body = JSON.parse(init.body) as { run: string; from: number; lines: string[] };
      h.calls.push({ run: body.run, from: body.from, count: body.lines.length });
      const r = replyFor(body.from + body.lines.length);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
    },
    base: "https://bot",
    token: () => "tok",
    enabled: () => true,
    currentFile: () => h.file.path,
    readFile: async () => h.file.text,
    newRunId: () => `run-${++runSeq}`,
    now: () => h.clock.now,
    log: (l) => h.logs.push(l),
  });
  return { uploader, h };
};

describe("uploader loop", () => {
  it("sends new lines and then goes quiet", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\ntwo\n";
    await uploader.tick();
    expect(h.calls).toEqual([{ run: "run-1", from: 0, count: 2 }]);
    expect(uploader.status().state).toBe(EUploaderState.UpToDate);

    await uploader.tick();
    expect(h.calls).toHaveLength(1); // nothing new — no second call
  });

  it("resumes at the cursor as the file grows", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\n";
    await uploader.tick();
    h.file.text = "one\ntwo\nthree\n";
    await uploader.tick();
    expect(h.calls[1]).toEqual({ run: "run-1", from: 1, count: 2 });
  });

  it("mints a NEW run when the engine rolls the file", async () => {
    // Without this the second file's line 0 collides with the first file's
    // line 0 under the server's UNIQUE key and is silently swallowed.
    const { uploader, h } = harness();
    h.file.text = "one\ntwo\n";
    await uploader.tick();
    h.file.path = "/logs/b.txt";
    h.file.text = "three\n";
    await uploader.tick();
    expect(h.calls[1]).toEqual({ run: "run-2", from: 0, count: 1 });
  });

  it("retries a network failure with backoff, without losing the cursor", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\n";
    h.setReply(() => ({ status: 503, body: {} }));
    await uploader.tick();
    expect(uploader.status().state).toBe(EUploaderState.Retrying);
    expect(uploader.status().failures).toBe(1);

    // Too soon — the backoff holds it back.
    await uploader.tick();
    expect(h.calls).toHaveLength(1);

    h.clock.now += retryDelayMs(1) + 1;
    h.setReply((from) => ({ status: 200, body: { accepted: 1, duplicate: 0, rejected: 0, nextFrom: from } }));
    await uploader.tick();
    expect(h.calls[1]).toEqual({ run: "run-1", from: 0, count: 1 });
    expect(uploader.status().state).toBe(EUploaderState.UpToDate);
    expect(uploader.status().failures).toBe(0);
  });

  it("a bot without the route gets its own state, and RESUMES once updated", async () => {
    // The exact situation on 2026-08-22: the endpoints existed only on develop,
    // so the app would have hit 404 on prod. It must not blame the network, and
    // it must recover on its own the moment an officer promotes the bot.
    const { uploader, h } = harness();
    h.file.text = "one\n";
    h.setReply(() => ({ status: 404, body: {} }));
    await uploader.tick();
    expect(uploader.status().state).toBe(EUploaderState.BotOutdated);
    expect(uploader.status().lastError).toBe(EUploadOutcome.NotDeployed);

    // Officer promotes the bot; no member action needed.
    h.clock.now += retryDelayMs(1) + 1;
    h.setReply((from) => ({ status: 200, body: { accepted: 1, duplicate: 0, rejected: 0, nextFrom: from } }));
    await uploader.tick();
    expect(uploader.status().state).toBe(EUploaderState.UpToDate);
    expect(h.calls[1]).toEqual({ run: "run-1", from: 0, count: 1 });
  });

  it("stops after a 401 instead of hammering a door that will not open", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\n";
    h.setReply(() => ({ status: 401, body: { error: "unauthorized" } }));
    await uploader.tick();
    expect(uploader.status().state).toBe(EUploaderState.Unauthorized);

    h.clock.now += 10 * 60_000;
    await uploader.tick();
    expect(h.calls).toHaveLength(1);
  });

  it("re-pairing clears the unauthorized state", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\n";
    h.setReply(() => ({ status: 401, body: { error: "unauthorized" } }));
    await uploader.tick();

    uploader.refresh();
    h.setReply((from) => ({ status: 200, body: { accepted: 1, duplicate: 0, rejected: 0, nextFrom: from } }));
    await uploader.tick();
    expect(uploader.status().state).toBe(EUploaderState.UpToDate);
  });

  it("counts only what the server ACCEPTED, so a duplicate resend inflates nothing", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\ntwo\n";
    h.setReply((from) => ({ status: 200, body: { accepted: 0, duplicate: 2, rejected: 0, nextFrom: from } }));
    await uploader.tick();
    expect(uploader.status().sentTotal).toBe(0);
  });

  it("does nothing at all when unpaired or switched off", async () => {
    const { h } = harness();
    h.file.text = "one\n";
    const unpaired = createUploader({
      fetchLike: async () => {
        throw new Error("must not be called");
      },
      base: "https://bot",
      token: () => null,
      enabled: () => true,
      currentFile: () => "/logs/a.txt",
      readFile: async () => "one\n",
      newRunId: () => "r",
      now: () => 1,
      log: () => undefined,
    });
    await unpaired.tick();
    expect(unpaired.status().state).toBe(EUploaderState.Unpaired);
  });

  it("survives a file that vanishes mid-read", async () => {
    // The engine rolls files; a read can lose the race. Next tick sees the new
    // one — this must not become an error state.
    const uploader = createUploader({
      fetchLike: async () => {
        throw new Error("must not be called");
      },
      base: "https://bot",
      token: () => "tok",
      enabled: () => true,
      currentFile: () => "/logs/gone.txt",
      readFile: async () => {
        throw new Error("ENOENT");
      },
      newRunId: () => "r",
      now: () => 1,
      log: () => undefined,
    });
    await expect(uploader.tick()).resolves.toBeUndefined();
    expect(uploader.status().state).not.toBe(EUploaderState.Blocked);
  });

  it("a new capture session starts a new run", async () => {
    const { uploader, h } = harness();
    h.file.text = "one\n";
    await uploader.tick();
    uploader.resetSession();
    await uploader.tick();
    expect(h.calls[1]?.run).toBe("run-2");
    expect(h.calls[1]?.from).toBe(0);
  });
});

describe("retryDelayMs", () => {
  it("backs off and then holds at the cap", () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(15_000);
    expect(retryDelayMs(99)).toBe(300_000);
    // Defensive: a zero or negative count must not index out of the table.
    expect(retryDelayMs(0)).toBe(5_000);
    expect(retryDelayMs(-5)).toBe(5_000);
  });
});

describe("a refusal shrinks the batch instead of parking the device", () => {
  /**
   * Found by the 2026-08-30 audit. `Blocked` had no exit — the guards at the
   * top of every tick return from it, nothing clears it, and the member's only
   * signal is one line in the app. A device that hit one refusal stopped
   * uploading for the rest of the session, silently, and a whole raid could go
   * missing that way.
   *
   * Nearly every refusal we can provoke is about the batch being too big for
   * the route, so halving is the cheapest thing that could make the next
   * attempt work. The sibling branch for `NotDeployed` already reasoned exactly
   * this way ("it heals by itself... rather than parking in a dead state they
   * must clear"); this is that reasoning applied where it was missing.
   */
  const REFUSE = { status: 400, body: { error: "batch_too_large" } };

  it("halves the batch and retries rather than going Blocked", async () => {
    const { uploader, h } = harness();
    h.file.text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    h.setReply(() => REFUSE);

    await uploader.tick();
    expect(h.calls[0]?.count).toBe(40);
    expect(uploader.status().state).toBe(EUploaderState.Retrying);

    h.clock.now += 60_000;
    await uploader.tick();
    expect(h.calls[1]?.count).toBe(20);
    expect(uploader.status().state).toBe(EUploaderState.Retrying);
  });

  it("succeeds as soon as a smaller batch fits, and goes back to full size", async () => {
    const { uploader, h } = harness();
    h.file.text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    let refuse = true;
    h.setReply((from) =>
      refuse ? REFUSE : { status: 200, body: { accepted: 1, duplicate: 0, rejected: 0, nextFrom: from } },
    );

    await uploader.tick();
    refuse = false;
    h.clock.now += 60_000;
    await uploader.tick();

    expect(h.calls[1]?.count).toBe(20);
    // The next pass is back at full width — the refusal is behind us and a
    // permanently halved uploader would be its own slow leak.
    h.file.text += "\nmore";
    await uploader.tick();
    expect(h.calls[2]?.count).toBeGreaterThan(1);
    expect(uploader.status().lastError).toBeNull();
  });

  it("parks only when ONE line is still refused — then the batch is not the problem", async () => {
    const { uploader, h } = harness();
    h.file.text = "a\nb\nc\nd";
    h.setReply(() => REFUSE);

    for (let i = 0; i < 12 && uploader.status().state !== EUploaderState.Blocked; i += 1) {
      h.clock.now += 60_000;
      await uploader.tick();
    }

    expect(uploader.status().state).toBe(EUploaderState.Blocked);
    expect(h.calls[h.calls.length - 1]?.count).toBe(1);
    expect(h.logs.some((l) => l.includes("even one line at a time"))).toBe(true);
  });

  it("still parks immediately on Unauthorized — that one really does need a human", async () => {
    const { uploader, h } = harness();
    h.file.text = "a\nb";
    h.setReply(() => ({ status: 401, body: {} }));

    await uploader.tick();
    expect(uploader.status().state).toBe(EUploaderState.Unauthorized);
    expect(h.calls).toHaveLength(1);
  });
});
