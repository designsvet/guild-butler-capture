/** Shared wire/IPC contract. No paths, hostnames, character names or raw logs belong here. */
export type TDesktopHealth = {
  captureState: "idle" | "starting" | "running" | "stopping" | "error";
  gameDetected: boolean | null;
  decoderState: "unknown" | "healthy" | "broken";
  brokenHandlers: string[];
  uploadState: "unpaired" | "idle" | "uploading" | "ok" | "error";
  lastLootAgeSeconds: number | null;
  lastUploadAgeSeconds: number | null;
};
export type TDesktopDiagnostics = { health: TDesktopHealth; appSeconds: number; captureSeconds: number };
export type TDesktopSupportStatus = { telemetryEnabled: boolean; consentChosen: boolean; available: boolean };
export type TDesktopReportDraft = {
  category: "capture" | "upload" | "update" | "pairing" | "other";
  summary: string;
  description: string;
  expected: string;
  contact?: string;
  includeDiagnostics: boolean;
};
export type TDesktopReportPayload = TDesktopReportDraft & { schemaVersion: 1; reportId: string; diagnostics?: TDesktopDiagnostics };
export type TDesktopReportPreview = { reportId: string; payload: TDesktopReportPayload };
export type TDesktopReportResult = { ok: true; reportId: string; reportNumber: number } | { ok: false; reason: "unavailable" | "invalid" | "network" | "rate-limited" | "rejected" };
export type TDesktopRegistration = {
  schemaVersion: 1;
  installationId: string;
  app: "guild-butler-capture" | "loot-butler";
  version: string;
  platform: "win32" | "darwin" | "linux";
  arch: string;
  channel: "stable" | "beta" | "development";
  telemetryEnabled: boolean;
};
export type TDesktopHeartbeat = {
  schemaVersion: 1; sessionId: string; sequence: number; appSeconds: number; captureSeconds: number; health: TDesktopHealth;
};

export type TDesktopSupportApi = {
  desktopSupportGet: () => Promise<TDesktopSupportStatus>;
  desktopSupportConsent: (enabled: boolean) => Promise<TDesktopSupportStatus>;
  desktopReportPreview: (draft: TDesktopReportDraft) => Promise<TDesktopReportPreview | null>;
  desktopReportSubmit: (reportId: string) => Promise<TDesktopReportResult>;
};
