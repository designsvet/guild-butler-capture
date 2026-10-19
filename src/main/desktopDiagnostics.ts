import { ECaptureStatus, type TCaptureState, type TPairingStatus } from "../shared/captureTypes.js";
import type { TDesktopHealth, TDesktopReportDraft } from "../shared/desktopSupport.js";

const age = (at: number | null, now: number): number | null => at == null || !Number.isFinite(at) ? null : Math.min(31_536_000, Math.max(0, Math.floor((now - at) / 1000)));

/** Construct fields explicitly: never serialize capture state, errors, settings or logs. */
export const desktopHealth = (state: TCaptureState, pairing: TPairingStatus, now: number): TDesktopHealth => ({
  captureState: state.status === ECaptureStatus.Idle ? "idle" : state.status === ECaptureStatus.Error ? "error" : state.status === ECaptureStatus.Stopping ? "stopping" : state.status === ECaptureStatus.Capturing || state.status === ECaptureStatus.Waiting ? "running" : "starting",
  gameDetected: state.albionSeen ? true : null,
  decoderState: state.engineBroken == null ? "unknown" : state.engineBroken.length > 0 ? "broken" : "healthy",
  // Handler identifiers, not arbitrary messages. No spaces, URLs, paths or message fragments.
  brokenHandlers: (state.engineBroken ?? []).map((h) => h.handler).filter((h) => /^(?:Ev|Op)[A-Za-z0-9]{2,60}$/.test(h)).slice(0, 20),
  uploadState: !pairing.paired ? "unpaired" : !pairing.uploadEnabled || pairing.upload.state === "disabled" ? "idle" : pairing.upload.failures > 0 || ["held", "unauthorized", "blocked", "bot-outdated", "retrying"].includes(pairing.upload.state) ? "error" : pairing.upload.state === "sending" || pairing.upload.state === "uploading" ? "uploading" : pairing.upload.lastSentAt != null ? "ok" : "idle",
  lastLootAgeSeconds: age(state.lastLootAt, now),
  lastUploadAgeSeconds: age(pairing.upload.lastSentAt, now),
});

/** Validate IPC without retaining unrecognized renderer fields. Free text is intentionally user authored. */
export const reportDraft = (raw: unknown): TDesktopReportDraft | null => {
  if (raw == null || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!["capture", "upload", "update", "pairing", "other"].includes(String(d.category))) return null;
  if (typeof d.summary !== "string" || d.summary.trim().length < 1 || d.summary.length > 160) return null;
  if (typeof d.description !== "string" || d.description.trim().length < 1 || d.description.length > 8000) return null;
  if (typeof d.expected !== "string" || d.expected.length > 2000 || typeof d.includeDiagnostics !== "boolean") return null;
  if (d.contact != null && (typeof d.contact !== "string" || d.contact.length > 160)) return null;
  return { category: d.category as TDesktopReportDraft["category"], summary: d.summary.trim(), description: d.description.trim(), expected: d.expected.trim(), includeDiagnostics: d.includeDiagnostics, ...(typeof d.contact === "string" && d.contact.trim() ? { contact: d.contact.trim() } : {}) };
};
