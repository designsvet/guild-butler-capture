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
    outcome === EUploadOutcome.RateLimited
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
