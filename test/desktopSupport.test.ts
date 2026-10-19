import { describe, expect, it } from "vitest";
import { createDesktopSupport } from "../src/main/desktopSupport.js";
import { desktopHealth } from "../src/main/desktopDiagnostics.js";
import { initialCaptureState, initialPairingStatus } from "../src/shared/captureTypes.js";
import type { TDesktopResponse, TDesktopRoute } from "../src/main/uploadClient.js";

const draft = { category: "capture", summary: "Capture stops", description: "No loot arrives after launch", expected: "Loot should arrive", includeDiagnostics: true };
const setup = () => {
  let time = 0;
  let allowed = true;
  let consent = { enabled: false, chosen: false };
  let ids = 0;
  let calls: Array<{ route: TDesktopRoute; body: unknown }> = [];
  let respond = async (route: TDesktopRoute, body?: unknown): Promise<TDesktopResponse> => ({ ok: true, status: 200, body: route === "reports" ? { ok: true, reportId: (body as { reportId: string }).reportId, reportNumber: 12 } : { ok: true } });
  const service = createDesktopSupport({
    allowed: () => allowed, consent: () => consent, saveConsent: (enabled) => { consent = { enabled, chosen: true }; },
    identity: () => ({ installationId: "install-1", secret: "never-expose-this" }),
    metadata: { app: "guild-butler-capture", version: "0.8.8", platform: "win32", arch: "x64", channel: "stable" },
    health: () => desktopHealth(initialCaptureState, initialPairingStatus, time), now: () => time, uuid: () => `uuid-${++ids}`,
    request: async (route, _identity, body) => { calls.push({ route, body: structuredClone(body) }); return respond(route, body); },
  });
  return { service, calls, advance: (ms: number) => { time += ms; }, allow: (value: boolean) => { allowed = value; }, respond: (fn: typeof respond) => { respond = fn; } };
};

describe("desktop support runtime", () => {
  it("sends nothing until opt-in, and opt-out stops all subsequent heartbeats", async () => {
    const t = setup();
    t.advance(60_000); await t.service.heartbeat(); expect(t.calls).toEqual([]);
    await t.service.setConsent(true);
    t.advance(30_000); t.service.sample(); t.advance(30_000); await t.service.heartbeat();
    expect(t.calls.map((c) => c.route)).toEqual(["register", "heartbeat"]);
    expect(t.calls[1]!.body).toMatchObject({ appSeconds: 60, captureSeconds: 0 });
    await t.service.setConsent(false);
    t.advance(60_000); await t.service.heartbeat();
    expect(t.calls.map((c) => c.route)).toEqual(["register", "heartbeat", "register"]);
    expect(t.calls[2]!.body).toMatchObject({ telemetryEnabled: false });
  });
  it("never reports mock or replay state, even after opt-in or manual action", async () => {
    const t = setup(); t.allow(false); await t.service.setConsent(true); await t.service.heartbeat();
    expect(t.service.preview(draft)).toBeNull(); expect(await t.service.submit("any")).toMatchObject({ ok: false }); expect(t.calls).toEqual([]);
  });
  it("retries cumulative snapshots instead of counting a failed request twice", async () => {
    const t = setup(); await t.service.setConsent(true);
    t.respond(async () => ({ ok: false, status: 0, body: null }));
    t.advance(30_000); await t.service.heartbeat();
    t.advance(30_000); await t.service.heartbeat();
    expect(t.calls[1]!.body).toMatchObject({ sequence: 1, appSeconds: 30 });
    expect(t.calls[2]!.body).toMatchObject({ sequence: 2, appSeconds: 60 });
    expect((t.calls[1]!.body as { sessionId: string }).sessionId).toBe((t.calls[2]!.body as { sessionId: string }).sessionId);
  });
  it("reports unpaired with analytics off; preview cannot be changed after review; retries retain ID", async () => {
    const t = setup();
    const preview = t.service.preview(draft)!;
    preview.payload.summary = "injected after review";
    let attempts = 0;
    t.respond(async (route) => route === "reports" && ++attempts === 1 ? { ok: false, status: 0, body: null } : { ok: true, status: 200, body: { ok: true, reportId: preview.reportId, reportNumber: 12 } });
    expect(await t.service.submit(preview.reportId)).toEqual({ ok: false, reason: "network" });
    expect(await t.service.submit(preview.reportId)).toEqual({ ok: true, reportId: preview.reportId, reportNumber: 12 });
    expect(t.calls[0]!.body).toMatchObject({ telemetryEnabled: false });
    expect(t.calls[1]!.body).toEqual(t.calls[2]!.body);
    expect(t.calls[1]!.body).toMatchObject({ summary: draft.summary, diagnostics: { health: { uploadState: "unpaired" } } });
    await t.service.submit(preview.reportId);
    expect(t.calls).toHaveLength(3);
  });
  it("omits diagnostics entirely when unchecked and rejects oversized/empty drafts", () => {
    const t = setup();
    expect(t.service.preview({ ...draft, includeDiagnostics: false })!.payload).not.toHaveProperty("diagnostics");
    expect(t.service.preview({ ...draft, description: " " })).toBeNull();
    expect(t.service.preview({ ...draft, summary: "x".repeat(161) })).toBeNull();
    expect(t.service.preview({ ...draft, includeDiagnostics: "yes" })).toBeNull();
  });
});

it("constructs diagnostic allowlist without raw personal data or invalid handler labels", () => {
  const health = desktopHealth({ ...initialCaptureState, character: "PrivatePlayer", logFile: "/Users/private/capture.txt", errorDetail: "Bearer TOPSECRET", engineBroken: [{ handler: "EvAttachItemContainer", calls: 5, failures: 5 }, { handler: "/Users/private", calls: 2, failures: 2 }] }, { ...initialPairingStatus, deviceName: "Private Laptop", guildId: "private-server" }, Date.now());
  expect(health.brokenHandlers).toEqual(["EvAttachItemContainer"]);
  expect(JSON.stringify(health)).not.toMatch(/Private|TOPSECRET|private|Users|Bearer/);
  expect(Object.keys(health).sort()).toEqual(["captureState", "gameDetected", "decoderState", "brokenHandlers", "uploadState", "lastLootAgeSeconds", "lastUploadAgeSeconds"].sort());
});

it("shares one in-flight report submission across double clicks", async () => {
  const t = setup();
  const preview = t.service.preview(draft)!;
  let resolveReport!: (reply: TDesktopResponse) => void;
  t.respond(async (route) => route === "reports" ? new Promise((resolve) => { resolveReport = resolve; }) : { ok: true, status: 200, body: {} });
  const first = t.service.submit(preview.reportId);
  const second = t.service.submit(preview.reportId);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(t.calls.filter((call) => call.route === "reports")).toHaveLength(1);
  resolveReport({ ok: true, status: 200, body: { ok: true, reportId: preview.reportId, reportNumber: 23 } });
  expect(await first).toEqual(await second);
});

it("excludes replay time if a session changes back to a real engine", async () => {
  const t = setup(); await t.service.setConsent(true);
  t.advance(30_000); await t.service.heartbeat();
  t.allow(false); t.service.sample();
  t.advance(60_000); await t.service.heartbeat();
  t.allow(true); t.service.sample();
  t.advance(30_000); await t.service.heartbeat();
  expect(t.calls.at(-1)!.body).toMatchObject({ sequence: 1, appSeconds: 30 });
});


it("does not show a receipt for a mismatched or malformed acknowledgement", async () => {
  const t = setup();
  const preview = t.service.preview(draft)!;
  for (const body of [{ reportNumber: 12 }, { ok: true, reportId: "wrong", reportNumber: 12 }, { ok: false, reportId: preview.reportId, reportNumber: 12 }]) {
    t.respond(async (route) => ({ ok: true, status: 200, body: route === "reports" ? body : { ok: true } }));
    expect(await t.service.submit(preview.reportId)).toEqual({ ok: false, reason: "network" });
  }
});
