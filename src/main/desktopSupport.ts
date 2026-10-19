import type { TDesktopDiagnostics, TDesktopHeartbeat, TDesktopRegistration, TDesktopReportPayload, TDesktopReportPreview, TDesktopReportResult, TDesktopSupportStatus, TDesktopHealth } from "../shared/desktopSupport.js";
import { reportDraft } from "./desktopDiagnostics.js";
import type { TDesktopIdentity } from "./desktopIdentity.js";
import { createUsageClock, type TUsageActivity } from "./desktopUsage.js";
import type { TDesktopResponse, TDesktopRoute } from "./uploadClient.js";

export type TDesktopSupportDeps = {
  allowed: () => boolean;
  consent: () => { enabled: boolean; chosen: boolean };
  saveConsent: (enabled: boolean) => void;
  identity: () => TDesktopIdentity | null;
  metadata: Omit<TDesktopRegistration, "schemaVersion" | "installationId" | "telemetryEnabled">;
  health: () => TDesktopHealth;
  now: () => number;
  uuid: () => string;
  request: (route: TDesktopRoute, identity: TDesktopIdentity, body: unknown) => Promise<TDesktopResponse>;
};

/** Shared by the old app and the new shell. Nothing here can start, stop or block capture. */
export const createDesktopSupport = (deps: TDesktopSupportDeps) => {
  const clock = createUsageClock(deps.now);
  let identity: TDesktopIdentity | null = null;
  let sessionId = deps.uuid();
  let sequence = 0;
  let registered: boolean | null = null;
  let registering: Promise<boolean> | null = null;
  let busy = false;
  let pending: TDesktopHeartbeat | null = null;
  let wasAllowed = deps.allowed();
  if (!wasAllowed) clock.pause();
  const syncAllowed = (): void => {
    const current = deps.allowed();
    if (current === wasAllowed) return;
    wasAllowed = current;
    clock.reset();
    sessionId = deps.uuid();
    sequence = 0;
    pending = null;
    if (current) clock.resume(); else clock.pause();
  };
  // Small, in-memory review cache. Drafts are never written to logs or disk.
  const previews = new Map<string, { payload: TDesktopReportPayload; result?: TDesktopReportResult }>();
  const submissions = new Map<string, Promise<TDesktopReportResult>>();
  const enabled = (): boolean => deps.allowed() && deps.consent().enabled;
  const status = (): TDesktopSupportStatus => ({ telemetryEnabled: deps.consent().enabled, consentChosen: deps.consent().chosen, available: deps.allowed() });
  const register = async (telemetryEnabled: boolean): Promise<boolean> => {
    if (!deps.allowed()) return false;
    if (registering) await registering;
    if (registered === telemetryEnabled) return true;
    identity ??= deps.identity();
    if (identity == null) return false;
    registering = (async () => {
      const response = await deps.request("register", identity!, { schemaVersion: 1, ...deps.metadata, installationId: identity!.installationId, telemetryEnabled });
      if (response.ok) registered = telemetryEnabled;
      return response.ok;
    })();
    try { return await registering; } finally { registering = null; }
  };
  const diagnostics = (): TDesktopDiagnostics => {
    clock.sample();
    const totals = clock.totals();
    return { health: deps.health(), appSeconds: totals.appSeconds, captureSeconds: totals.captureSeconds };
  };
  const flush = async (): Promise<void> => {
    if (busy || !enabled() || pending == null) return;
    busy = true;
    try {
      if (!await register(true) || !enabled() || identity == null || pending == null) return;
      const snapshot = pending;
      const response = await deps.request("heartbeat", identity, snapshot);
      // A newer pending snapshot replaces the retry. Cumulative totals make lost replies harmless.
      if (response.ok && pending === snapshot) pending = null;
    } finally { busy = false; }
  };
  return {
    status,
    activity: (activity: TUsageActivity): void => { syncAllowed(); clock.activity(activity); },
    sample: (): void => { syncAllowed(); clock.sample(); },
    suspend: (): void => clock.pause(),
    resume: (): void => { syncAllowed(); if (deps.allowed()) clock.resume(); },
    setConsent: async (value: boolean): Promise<TDesktopSupportStatus> => {
      const changed = deps.consent().enabled !== value;
      deps.saveConsent(value);
      if (changed) { clock.reset(); sessionId = deps.uuid(); sequence = 0; pending = null; }
      if (deps.allowed() && (value || identity != null)) await register(value);
      return status();
    },
    heartbeat: async (): Promise<void> => {
      syncAllowed();
      clock.sample();
      if (!enabled()) { pending = null; return; }
      const totals = clock.totals();
      pending = { schemaVersion: 1, sessionId, sequence: ++sequence, appSeconds: totals.appSeconds, captureSeconds: totals.captureSeconds, health: deps.health() };
      await flush();
    },
    preview: (raw: unknown): TDesktopReportPreview | null => {
      if (!deps.allowed()) return null;
      const draft = reportDraft(raw);
      if (draft == null) return null;
      const reportId = deps.uuid();
      const payload: TDesktopReportPayload = { schemaVersion: 1, reportId, ...draft, ...(draft.includeDiagnostics ? { diagnostics: diagnostics() } : {}) };
      while (previews.size >= 8) { const oldest = previews.keys().next().value as string; previews.delete(oldest); }
      previews.set(reportId, { payload });
      return { reportId, payload: structuredClone(payload) };
    },
    submit: async (reportId: string): Promise<TDesktopReportResult> => {
      if (!deps.allowed()) return { ok: false, reason: "unavailable" };
      const preview = previews.get(reportId);
      if (!preview) return { ok: false, reason: "invalid" };
      if (preview.result?.ok) return preview.result;
      const inFlight = submissions.get(reportId);
      if (inFlight) return inFlight;
      const submit = (async (): Promise<TDesktopReportResult> => {
        if (!await register(enabled()) || identity == null) return { ok: false, reason: identity == null ? "unavailable" : "network" };
        const response = await deps.request("reports", identity, preview.payload);
        const number = response.body?.reportNumber;
        if (response.ok && response.body?.ok === true && response.body.reportId === reportId && (typeof number === "number" && Number.isSafeInteger(number) && number > 0)) {
          const result: TDesktopReportResult = { ok: true, reportId, reportNumber: number };
          preview.result = result;
          return result;
        }
        return { ok: false, reason: response.status === 429 ? "rate-limited" : response.status >= 400 && response.status < 500 ? "rejected" : "network" };
      })();
      submissions.set(reportId, submit);
      try { return await submit; } finally { submissions.delete(reportId); }
    },
  };
};
