import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import type { THeldRange } from "../src/main/uploadPlan.js";
import { createHeldStore, heldUploadsFilePath, loadHeldRanges } from "../src/main/heldUploads.js";
import type { TBrokenHandler } from "../src/shared/captureTypes.js";
import { lootBroken } from "../src/shared/engineHealth.js";
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

/** Held ranges kept in memory, as heldUploads.ts keeps them on disk. */
const memoryHolds = (initial: THeldRange[] = []): { list: () => readonly THeldRange[]; add: (r: THeldRange) => boolean } => {
  const ranges = [...initial];
  return {
    list: () => ranges,
    add: (range) => {
      ranges.push(range);
      return true;
    },
  };
};

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
    held: () => false,
    holds: memoryHolds(),
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
      held: () => false,
      holds: memoryHolds(),
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
      held: () => false,
      holds: memoryHolds(),
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

describe("the held upload: a broken decoder's lines never reach the guild", () => {
  /**
   * raid-bot ADR 0159, amendment 2026-10-01. A game update in September 2026 had bank deposits
   * logged as loot for five days; 72 of them were uploaded and had to be cleaned out of the bot by
   * hand. So while the decoder is broken where loot is concerned, nothing is sent, and what the
   * engine writes meanwhile is never sent — not after the update either. This is money data on the
   * guild's side, so every way a held line could still leave is tried here: a restart, a new file,
   * a verdict landing mid-pass, a pairing made while held.
   *
   * Every line is unique, and every line the bot ever received is collected, so "never sent" is
   * checked against the whole history, not one call.
   */
  const ATTACH = { handler: "EvAttachItemContainer", failures: 5, calls: 5 };
  const FESTIVITIES = { handler: "EvFestivitiesUpdate", failures: 5, calls: 5 };
  const ENERGY = { handler: "OpGuildEnergyDrain", failures: 6, calls: 6 };

  type TWorld = {
    files: Map<string, string[]>;
    current: string | null;
    broken: TBrokenHandler[] | null;
    token: string | null;
    received: Array<{ run: string; file: string; from: number; lines: string[] }>;
    clock: { now: number };
    logs: string[];
    runs: number;
  };

  const world = (): TWorld => ({
    files: new Map(),
    current: "/logs/a.txt",
    broken: null,
    token: "tok",
    received: [],
    clock: { now: 1_000 },
    logs: [],
    runs: 0,
  });

  /** Lines `from`…`to - 1` of a file, each unique: "a.txt:7". */
  const write = (w: TWorld, file: string, to: number): void => {
    const lines = w.files.get(file) ?? [];
    for (let i = lines.length; i < to; i += 1) {
      lines.push(`${file.split("/").at(-1)}:${i}`);
    }
    w.files.set(file, lines);
  };

  /** One app: an uploader over the world, with the hold rule main uses (lootBroken). */
  const app = (
    w: TWorld,
    holds: { list: () => readonly THeldRange[]; add: (r: THeldRange) => boolean },
    over: { fetchLike?: Parameters<typeof createUploader>[0]["fetchLike"]; readFile?: (path: string) => Promise<string> } = {},
  ) =>
    createUploader({
      fetchLike:
        over.fetchLike ??
        (async (_url, init) => {
          const body = JSON.parse(init.body) as { run: string; file: string; from: number; lines: string[] };
          w.received.push(body);
          const reply = { accepted: body.lines.length, duplicate: 0, rejected: 0, nextFrom: body.from + body.lines.length };
          return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
        }),
      base: "https://bot",
      token: () => w.token,
      enabled: () => true,
      currentFile: () => w.current,
      readFile: over.readFile ?? (async (path) => `${(w.files.get(path) ?? []).join("\n")}\n`),
      newRunId: () => `run-${++w.runs}`,
      now: () => w.clock.now,
      log: (line) => w.logs.push(line),
      held: () => lootBroken(w.broken),
      holds,
    });

  const sentLines = (w: TWorld): string[] => w.received.flatMap((r) => r.lines);

  it("sends nothing while broken, and holds from where it stood", async () => {
    const w = world();
    const holds = memoryHolds();
    const up = app(w, holds);
    write(w, "/logs/a.txt", 5);
    await up.tick();
    expect(sentLines(w)).toEqual(["a.txt:0", "a.txt:1", "a.txt:2", "a.txt:3", "a.txt:4"]);

    write(w, "/logs/a.txt", 7);
    w.broken = [ATTACH];
    await up.tick();
    write(w, "/logs/a.txt", 12);
    w.clock.now += 10 * 60_000;
    await up.tick();
    await up.tick();

    expect(w.received).toHaveLength(1);
    expect(up.status().state).toBe(EUploaderState.Held);
    expect(holds.list()).toEqual([{ file: "/logs/a.txt", from: 5, run: "run-1", at: w.clock.now - 10 * 60_000 }]);
    // the five lines written before the verdict but not yet sent are held too: the verdict lags the break
    expect(sentLines(w).filter((l) => Number(l.split(":")[1]) >= 5)).toEqual([]);
  });

  it("the held range survives an app restart: the fixed app sends none of it, and nothing twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gbc-held-"));
    const file = heldUploadsFilePath(dir);
    const w = world();

    // The broken app: five lines go, then the verdict, then the engine writes on.
    const broken = app(w, createHeldStore(file, () => undefined));
    write(w, "/logs/a.txt", 5);
    await broken.tick();
    w.broken = [ATTACH];
    write(w, "/logs/a.txt", 40);
    await broken.tick();
    expect(loadHeldRanges(file).ranges).toEqual([{ file: "/logs/a.txt", from: 5, run: "run-1", at: 1_000 }]);

    // The update is an app restart: a new process, a new uploader, the break forgotten (it is
    // sticky only for an app session) — and, the worst case, the held file handed to it again.
    w.broken = null;
    w.runs = 0;
    const fixed = app(w, createHeldStore(file, () => undefined));
    write(w, "/logs/a.txt", 60);
    for (let i = 0; i < 5; i += 1) {
      w.clock.now += 60_000;
      await fixed.tick();
    }
    expect(w.received).toHaveLength(1);
    expect(fixed.status().state).toBe(EUploaderState.UpToDate);
  });

  it("lines written while broken are never sent, even after the fix — however the file comes back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gbc-held-"));
    const file = heldUploadsFilePath(dir);
    const w = world();
    const broken = app(w, createHeldStore(file, () => undefined));
    // Broken before this uploader sent anything of the file: all of it is held.
    w.broken = [ATTACH];
    write(w, "/logs/a.txt", 30);
    await broken.tick();
    expect(loadHeldRanges(file).ranges).toEqual([{ file: "/logs/a.txt", from: 0, run: null, at: 1_000 }]);

    w.broken = null;
    const fixed = app(w, createHeldStore(file, () => undefined));
    // The file comes back as the current one, grows, shrinks (replaced), grows again.
    write(w, "/logs/a.txt", 50);
    await fixed.tick();
    w.files.set("/logs/a.txt", ["a.txt:0"]);
    await fixed.tick();
    write(w, "/logs/a.txt", 80);
    await fixed.tick();
    fixed.resetSession();
    await fixed.tick();
    expect(sentLines(w)).toEqual([]);
  });

  it("lines written after the fix are sent: the fixed engine's new file goes whole", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gbc-held-"));
    const file = heldUploadsFilePath(dir);
    const w = world();
    const broken = app(w, createHeldStore(file, () => undefined));
    write(w, "/logs/a.txt", 3);
    await broken.tick();
    w.broken = [ATTACH];
    write(w, "/logs/a.txt", 9);
    await broken.tick();

    w.broken = null;
    const fixed = app(w, createHeldStore(file, () => undefined));
    w.current = "/logs/b.txt";
    write(w, "/logs/b.txt", 4);
    await fixed.tick();
    expect(w.received.at(-1)).toEqual({ run: "run-2", file: "/logs/b.txt", from: 0, lines: ["b.txt:0", "b.txt:1", "b.txt:2", "b.txt:3"] });
    write(w, "/logs/b.txt", 6);
    await fixed.tick();
    expect(sentLines(w)).toEqual(["a.txt:0", "a.txt:1", "a.txt:2", "b.txt:0", "b.txt:1", "b.txt:2", "b.txt:3", "b.txt:4", "b.txt:5"]);
    expect(fixed.status().state).toBe(EUploaderState.UpToDate);
  });

  it("a broken handler that feeds no loot holds nothing", async () => {
    const w = world();
    const holds = memoryHolds();
    const up = app(w, holds);
    w.broken = [ENERGY, FESTIVITIES];
    write(w, "/logs/a.txt", 4);
    await up.tick();
    expect(sentLines(w)).toEqual(["a.txt:0", "a.txt:1", "a.txt:2", "a.txt:3"]);
    expect(holds.list()).toEqual([]);
    expect(up.status().state).toBe(EUploaderState.UpToDate);

    // …until one that does joins them.
    w.broken = [ATTACH, ENERGY, FESTIVITIES];
    write(w, "/logs/a.txt", 8);
    await up.tick();
    expect(w.received).toHaveLength(1);
    expect(holds.list()).toEqual([expect.objectContaining({ file: "/logs/a.txt", from: 4 })]);
  });

  it("an engine restart while broken writes a new file: held from its first line", async () => {
    const w = world();
    const holds = memoryHolds();
    const up = app(w, holds);
    write(w, "/logs/a.txt", 3);
    await up.tick();
    w.broken = [ATTACH];
    await up.tick();
    w.current = "/logs/b.txt";
    write(w, "/logs/b.txt", 10);
    await up.tick();
    up.resetSession();
    w.current = "/logs/c.txt";
    write(w, "/logs/c.txt", 2);
    await up.tick();
    expect(holds.list().map((r) => [r.file, r.from, r.run])).toEqual([
      ["/logs/a.txt", 3, "run-1"],
      ["/logs/b.txt", 0, null],
      ["/logs/c.txt", 0, null],
    ]);
    expect(sentLines(w)).toEqual(["a.txt:0", "a.txt:1", "a.txt:2"]);
  });

  it("holds even unpaired or switched off — pairing while broken sends nothing", async () => {
    const w = world();
    w.token = null;
    const holds = memoryHolds();
    const up = app(w, holds);
    w.broken = [ATTACH];
    write(w, "/logs/a.txt", 6);
    await up.tick();
    expect(up.status().state).toBe(EUploaderState.Unpaired);
    expect(holds.list()).toEqual([expect.objectContaining({ file: "/logs/a.txt", from: 0 })]);

    w.token = "tok";
    up.refresh();
    await up.tick();
    expect(w.received).toEqual([]);
    expect(up.status().state).toBe(EUploaderState.Held);
  });

  it("a verdict that lands while a batch is in flight: that batch (read before it) goes, nothing after it", async () => {
    const w = world();
    const holds = memoryHolds();
    let release: () => void = () => {};
    const inFlight = new Promise<void>((r) => {
      release = r;
    });
    const up = app(w, holds, {
      fetchLike: async (_url, init) => {
        const body = JSON.parse(init.body) as { run: string; file: string; from: number; lines: string[] };
        await inFlight;
        w.received.push(body);
        const reply = { accepted: body.lines.length, duplicate: 0, rejected: 0, nextFrom: body.from + body.lines.length };
        return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
      },
    });
    write(w, "/logs/a.txt", 5);
    const pass = up.tick();
    await new Promise((r) => setTimeout(r, 0));
    w.broken = [ATTACH];
    write(w, "/logs/a.txt", 9);
    // A second pass while the first is in flight does nothing (non-overlapping).
    await up.tick();
    release();
    await pass;
    expect(holds.list()).toEqual([expect.objectContaining({ file: "/logs/a.txt", from: 5, run: "run-1" })]);
    expect(up.status().state).toBe(EUploaderState.Held);
    w.clock.now += 60_000;
    await up.tick();
    expect(sentLines(w)).toEqual(["a.txt:0", "a.txt:1", "a.txt:2", "a.txt:3", "a.txt:4"]);
  });

  it("a verdict that lands while the file is being read: nothing of what was read is sent", async () => {
    const w = world();
    const holds = memoryHolds();
    let release: () => void = () => {};
    const reading = new Promise<void>((r) => {
      release = r;
    });
    const up = app(w, holds, {
      readFile: async (path) => {
        await reading;
        return `${(w.files.get(path) ?? []).join("\n")}\n`;
      },
    });
    write(w, "/logs/a.txt", 5);
    const pass = up.tick();
    await new Promise((r) => setTimeout(r, 0));
    w.broken = [ATTACH];
    release();
    await pass;
    expect(w.received).toEqual([]);
    expect(holds.list()).toEqual([expect.objectContaining({ file: "/logs/a.txt", from: 0 })]);
    expect(up.status().state).toBe(EUploaderState.Held);
  });

  it("says Held at once, even while backing off from a failed send", async () => {
    const w = world();
    const up = app(w, memoryHolds(), {
      fetchLike: async () => ({ ok: false, status: 503, text: async () => "{}" }),
    });
    write(w, "/logs/a.txt", 2);
    await up.tick();
    expect(up.status().state).toBe(EUploaderState.Retrying);
    w.broken = [ATTACH];
    // still inside the backoff: no attempt is due, but the foot must not keep saying "retrying"
    await up.tick();
    expect(up.status().state).toBe(EUploaderState.Held);
  });

  it("a device that needs pairing again still says so while held", async () => {
    const w = world();
    const up = app(w, memoryHolds(), {
      fetchLike: async () => ({ ok: false, status: 401, text: async () => "{}" }),
    });
    write(w, "/logs/a.txt", 2);
    await up.tick();
    expect(up.status().state).toBe(EUploaderState.Unauthorized);
    w.broken = [ATTACH];
    await up.tick();
    expect(up.status().state).toBe(EUploaderState.Unauthorized);
  });
});
