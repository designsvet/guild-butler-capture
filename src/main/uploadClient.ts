/**
 * Talking to the bot's control server (ADR 0092 P2 slice 4).
 *
 * Two calls: trade a pairing code for a device token, and push a batch of
 * captured lines. Both take an injected `fetch` so the whole surface is
 * testable with no network and no Electron.
 *
 * Every failure is a NAMED outcome rather than a thrown error. The renderer
 * shows a different sentence per reason, and "upload failed" is precisely the
 * message this project has already twice paid to avoid — once for the macOS
 * permission fix, once for the Npcap install.
 */

import type { TBatch } from "./uploadPlan.js";

/**
 * Where the bot lives. Overridable for staging, because the staging bot is a
 * separate deployment and a tester must be able to point at it without a
 * rebuild — the same reason the engine folder is overridable.
 */
export const DEFAULT_API_BASE = "https://app.guild-butler.com";

export const apiBase = (override: string | undefined | null): string => {
  const value = (override ?? "").trim();
  if (value.length === 0) {
    return DEFAULT_API_BASE;
  }
  return value.replace(/\/+$/, "");
};

export enum EPairOutcome {
  Paired = "paired",
  /** The server refused the code: wrong, expired, already used, or at the device cap. */
  Refused = "refused",
  /** Could not reach the bot at all. */
  Unreachable = "unreachable",
  /** Reached it, but the reply was not what this version expects. */
  BadReply = "bad-reply",
  /**
   * The endpoint is not there (404/405).
   *
   * Distinct from Refused on purpose. Both are "not ok", but they need OPPOSITE
   * things from the member: a refusal means get a fresh code, while a missing
   * route means nothing they do with codes will ever work — an officer has to
   * update the bot. Folding this into Refused sends them round a loop
   * regenerating codes against a bot that has no route to redeem them.
   */
  NotDeployed = "not-deployed",
}

export type TPairedDevice = {
  token: string;
  guildId: string;
  userId: string;
  deviceId: number;
  deviceName: string;
};

export type TPairResult =
  | { outcome: EPairOutcome.Paired; device: TPairedDevice }
  | { outcome: Exclude<EPairOutcome, EPairOutcome.Paired>; detail: string | null };

export type TFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Is this "the route isn't there", rather than "the route said no"?
 *
 * 404/405 from a bot that predates this feature, or from a base URL pointing
 * somewhere that isn't the bot at all. The two are indistinguishable from the
 * status alone, so the copy names both possibilities rather than guessing.
 */
export const isMissingEndpoint = (status: number): boolean => {
  return status === 404 || status === 405;
};

const parseJson = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value != null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const pairDevice = async (
  fetchLike: TFetchLike,
  base: string,
  code: string,
  deviceName: string,
): Promise<TPairResult> => {
  let res: Awaited<ReturnType<TFetchLike>>;
  try {
    res = await fetchLike(`${apiBase(base)}/control/capture/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName }),
    });
  } catch (err) {
    return { outcome: EPairOutcome.Unreachable, detail: err instanceof Error ? err.message : null };
  }

  const text = await res.text().catch(() => "");
  const body = parseJson(text);
  if (isMissingEndpoint(res.status)) {
    return { outcome: EPairOutcome.NotDeployed, detail: String(res.status) };
  }
  if (!res.ok) {
    // The server deliberately gives one shape for every refusal, so there is
    // no oracle for whether a given code exists. Pass its reason through for
    // the app log; the member gets one sentence either way.
    return { outcome: EPairOutcome.Refused, detail: typeof body?.error === "string" ? body.error : null };
  }
  const token = body?.token;
  const guildId = body?.guildId;
  const userId = body?.userId;
  if (typeof token !== "string" || typeof guildId !== "string" || typeof userId !== "string") {
    return { outcome: EPairOutcome.BadReply, detail: null };
  }
  return {
    outcome: EPairOutcome.Paired,
    device: {
      token,
      guildId,
      userId,
      deviceId: typeof body?.deviceId === "number" ? body.deviceId : 0,
      deviceName: typeof body?.deviceName === "string" ? body.deviceName : deviceName,
    },
  };
};

export enum EUploadOutcome {
  Accepted = "accepted",
  /** The token is dead — revoked from Discord, or this guild is gone. */
  Unauthorized = "unauthorized",
  /** Over the per-device hourly budget. Not an error; come back later. */
  RateLimited = "rate-limited",
  /** The server rejected the batch's shape. A bug on this side. */
  Rejected = "rejected",
  /** Network, DNS, TLS — anything that means "try again". */
  Unreachable = "unreachable",
  /** The bot is up but unhappy (5xx). Retryable. */
  ServerError = "server-error",
  /**
   * The upload route is not on this bot (404/405) — it predates the feature.
   *
   * Deliberately RETRYABLE even though the member can do nothing about it: once
   * an officer updates the bot, the app resumes on its own instead of needing
   * the member to notice and re-press something. It gets its own sentence so
   * the UI does not claim a transient network problem.
   */
  NotDeployed = "not-deployed",
}

export type TUploadReply = {
  accepted: number;
  duplicate: number;
  rejected: number;
  nextFrom: number | null;
};

export type TUploadResult =
  | { outcome: EUploadOutcome.Accepted; reply: TUploadReply }
  | { outcome: Exclude<EUploadOutcome, EUploadOutcome.Accepted>; detail: string | null };

/** Outcomes worth retrying the SAME batch for. The rest need a human or a fix. */
export const isRetryable = (outcome: EUploadOutcome): boolean => {
  return (
    outcome === EUploadOutcome.Unreachable ||
    outcome === EUploadOutcome.ServerError ||
    outcome === EUploadOutcome.RateLimited ||
    // Not the member's to fix, but it heals by itself when the bot is updated —
    // so keep trying rather than parking in a dead state they must clear.
    outcome === EUploadOutcome.NotDeployed
  );
};

export const uploadBatch = async (
  fetchLike: TFetchLike,
  base: string,
  token: string,
  run: string,
  file: string,
  batch: TBatch,
): Promise<TUploadResult> => {
  let res: Awaited<ReturnType<TFetchLike>>;
  try {
    res = await fetchLike(`${apiBase(base)}/control/capture/upload`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ run, file, from: batch.from, lines: batch.lines }),
    });
  } catch (err) {
    return { outcome: EUploadOutcome.Unreachable, detail: err instanceof Error ? err.message : null };
  }

  const text = await res.text().catch(() => "");
  const body = parseJson(text);
  if (res.status === 401) {
    return { outcome: EUploadOutcome.Unauthorized, detail: null };
  }
  if (res.status === 429) {
    return { outcome: EUploadOutcome.RateLimited, detail: typeof body?.error === "string" ? body.error : null };
  }
  if (isMissingEndpoint(res.status)) {
    return { outcome: EUploadOutcome.NotDeployed, detail: String(res.status) };
  }
  if (res.status >= 500) {
    return { outcome: EUploadOutcome.ServerError, detail: String(res.status) };
  }
  if (!res.ok) {
    return { outcome: EUploadOutcome.Rejected, detail: typeof body?.error === "string" ? body.error : null };
  }
  return {
    outcome: EUploadOutcome.Accepted,
    reply: {
      accepted: typeof body?.accepted === "number" ? body.accepted : 0,
      duplicate: typeof body?.duplicate === "number" ? body.duplicate : 0,
      rejected: typeof body?.rejected === "number" ? body.rejected : 0,
      nextFrom: typeof body?.nextFrom === "number" ? body.nextFrom : null,
    },
  };
};

/**
 * Post one daily-bonus rotation snapshot (raid-bot ADR 0102).
 *
 * A sibling of `uploadBatch`, not a mode of it: same token, same base, same outcome vocabulary
 * — but the payload is a SNAPSHOT of server state rather than an append to this member's file,
 * so it has no cursor, no run, and nothing to resume. A failure is simply dropped: the next
 * login sends the rotation again, and a stale snapshot the bot already holds is worth more than
 * a retry queue for data that refreshes itself.
 */
/**
 * Post one guild siphoned-energy reading (raid-bot ADR 0022).
 *
 * Shaped like `sendFestivities` — same token, same outcome vocabulary, no cursor, no retry —
 * with one difference that matters: a rotation is the same fact for everyone on a server, while
 * this is ONE GUILD'S private number. The bot decides whose by the pairing, and refuses a
 * reading whose guild does not match what that Discord server is bound to.
 *
 * Dropped on failure, deliberately. The engine re-reads the total continuously, so the next
 * line is minutes away at worst — and a retry queue would be the wrong shape anyway: replaying
 * an hour-old reading as if it were current puts a flat stretch into a history whose whole
 * purpose is to be differenced.
 */
/**
 * Post one page of the guild's energy log (raid-bot ADR 0022).
 *
 * Unlike a reading — one number, cheap to lose, re-read seconds later — a page is the only
 * copy this session will offer of those rows: the client fetches each page once, as the log
 * is scrolled, and nothing re-asks. It is still not retried here, because the bot's mirror is
 * append-and-deduplicate and the next fetch of the same log re-delivers everything; a queue
 * would buy resilience against exactly the failure (bot down) that the next scroll fixes.
 *
 * The bot refuses a page whose guild does not match the pairing's binding, and refuses one
 * from a device whose owner may not paste the log by hand — the same gate, at the same width.
 */
export const sendEnergyLogPage = async (
  fetchLike: TFetchLike,
  base: string,
  token: string,
  payload: {
    server: string | null;
    albionGuildId: string | null;
    rows: ReadonlyArray<{ playerName: string; type: number; amount: number; happenedAt: number }>;
  },
): Promise<TUploadResult> => {
  let res: Awaited<ReturnType<TFetchLike>>;
  try {
    res = await fetchLike(`${apiBase(base)}/control/capture/energy-log`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { outcome: EUploadOutcome.Unreachable, detail: err instanceof Error ? err.message : null };
  }

  const text = await res.text().catch(() => "");
  const body = parseJson(text);
  if (res.status === 401) {
    return { outcome: EUploadOutcome.Unauthorized, detail: null };
  }
  if (res.status === 403) {
    // The device's owner may not put rows into this guild's energy mirror. Not retryable and
    // not a bug: an ordinary member's capture is trusted for readings, not for balances.
    return { outcome: EUploadOutcome.Rejected, detail: "forbidden" };
  }
  if (res.status === 429) {
    return { outcome: EUploadOutcome.RateLimited, detail: null };
  }
  if (isMissingEndpoint(res.status)) {
    return { outcome: EUploadOutcome.NotDeployed, detail: String(res.status) };
  }
  if (res.status >= 500) {
    return { outcome: EUploadOutcome.ServerError, detail: String(res.status) };
  }
  if (!res.ok) {
    return { outcome: EUploadOutcome.Rejected, detail: typeof body?.error === "string" ? body.error : null };
  }
  return {
    outcome: EUploadOutcome.Accepted,
    reply: {
      accepted: typeof body?.stored === "number" ? body.stored : 0,
      // Rows the mirror already held. The common case by far: the log is re-read whole every
      // time somebody opens it, so only the newest rows of a page are ever new.
      duplicate: typeof body?.known === "number" ? body.known : 0,
      rejected: typeof body?.refused === "number" ? body.refused : 0,
      nextFrom: null,
    },
  };
};

export const sendEnergyReading = async (
  fetchLike: TFetchLike,
  base: string,
  token: string,
  payload: {
    server: string | null;
    guildName: string;
    albionGuildId: string | null;
    total: number;
    readAt: number;
  },
): Promise<TUploadResult> => {
  let res: Awaited<ReturnType<TFetchLike>>;
  try {
    res = await fetchLike(`${apiBase(base)}/control/capture/energy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { outcome: EUploadOutcome.Unreachable, detail: err instanceof Error ? err.message : null };
  }

  const text = await res.text().catch(() => "");
  const body = parseJson(text);
  if (res.status === 401) {
    return { outcome: EUploadOutcome.Unauthorized, detail: null };
  }
  if (res.status === 429) {
    return { outcome: EUploadOutcome.RateLimited, detail: null };
  }
  if (isMissingEndpoint(res.status)) {
    return { outcome: EUploadOutcome.NotDeployed, detail: String(res.status) };
  }
  if (res.status >= 500) {
    return { outcome: EUploadOutcome.ServerError, detail: String(res.status) };
  }
  if (!res.ok) {
    return { outcome: EUploadOutcome.Rejected, detail: typeof body?.error === "string" ? body.error : null };
  }
  return {
    outcome: EUploadOutcome.Accepted,
    reply: {
      accepted: body?.stored === true ? 1 : 0,
      // Not an error: a reading the bot already holds, or one inside its rate window. The
      // engine emits far more readings than a history needs.
      duplicate: body?.stored === true ? 0 : 1,
      rejected: 0,
      nextFrom: null,
    },
  };
};

export const sendFestivities = async (
  fetchLike: TFetchLike,
  base: string,
  token: string,
  payload: {
    server: string;
    capturedAt: number;
    eventCode: number;
    entries: ReadonlyArray<{ kind: number; category: string; uniqueName: string; startMs: number; endMs: number }>;
  },
): Promise<TUploadResult> => {
  let res: Awaited<ReturnType<TFetchLike>>;
  try {
    res = await fetchLike(`${apiBase(base)}/control/capture/festivities`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { outcome: EUploadOutcome.Unreachable, detail: err instanceof Error ? err.message : null };
  }

  const text = await res.text().catch(() => "");
  const body = parseJson(text);
  if (res.status === 401) {
    return { outcome: EUploadOutcome.Unauthorized, detail: null };
  }
  if (res.status === 429) {
    return { outcome: EUploadOutcome.RateLimited, detail: null };
  }
  if (isMissingEndpoint(res.status)) {
    return { outcome: EUploadOutcome.NotDeployed, detail: String(res.status) };
  }
  if (res.status >= 500) {
    return { outcome: EUploadOutcome.ServerError, detail: String(res.status) };
  }
  if (!res.ok) {
    return { outcome: EUploadOutcome.Rejected, detail: typeof body?.error === "string" ? body.error : null };
  }
  return {
    outcome: EUploadOutcome.Accepted,
    reply: {
      accepted: typeof body?.stored === "number" ? body.stored : 0,
      duplicate: body?.superseded === true ? 1 : 0,
      rejected: 0,
      nextFrom: null,
    },
  };
};
