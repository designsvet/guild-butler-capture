/**
 * Windows capture readiness — Npcap.
 *
 * The engine's `cap` module links against wpcap.dll. Npcap installs its DLLs
 * into System32\Npcap; the legacy "WinPcap API-compatible mode" ALSO copies
 * them into System32 itself. Rather than demand compat mode, the app prepends
 * the Npcap dir to the child's PATH (`npcapChildPathEnv`), so either install
 * shape works.
 *
 * Npcap's OEM licence forbids bundling its installer without paying, so the
 * app detects, explains, and links to the official download instead. The one
 * installer option that bites: "Restrict Npcap driver's access to
 * Administrators only" — detected via the service's registry parameters so the
 * app can say exactly that instead of a generic failure.
 */

import { ECaptureAccess } from "../../shared/captureTypes.js";

export type TNpcapProbe = {
  /** System32\Npcap\wpcap.dll exists (a normal Npcap install). */
  npcapDirDll: boolean;
  /** System32\wpcap.dll exists (WinPcap-compat mode, or legacy WinPcap). */
  system32Dll: boolean;
  /** HKLM\...\Services\npcap\Parameters\AdminOnly, when readable. */
  adminOnly: number | null;
};

/** Pure verdict from the probe results. */
export const classifyNpcap = (probe: TNpcapProbe): ECaptureAccess => {
  if (!probe.npcapDirDll && !probe.system32Dll) {
    return ECaptureAccess.NpcapMissing;
  }
  if (probe.adminOnly === 1) {
    return ECaptureAccess.NpcapAdminOnly;
  }
  return ECaptureAccess.Ok;
};

/**
 * Parse `reg query HKLM\SYSTEM\CurrentControlSet\Services\npcap\Parameters /v AdminOnly`
 * output. Null = value absent or query failed (treated as "not restricted" —
 * fail open, the engine's own error will tell the truth).
 */
export const parseRegAdminOnly = (output: string): number | null => {
  const m = /AdminOnly\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(output);
  if (m?.[1] == null) {
    return null;
  }
  const value = Number.parseInt(m[1], 16);
  return Number.isNaN(value) ? null : value;
};

/** The Npcap DLL dir the capture child's PATH must include. */
export const npcapDir = (systemRoot: string): string => {
  return `${systemRoot.replace(/[\\/]+$/, "")}\\System32\\Npcap`;
};

/** PATH for the engine child process, Npcap first so wpcap.dll always resolves. */
export const npcapChildPathEnv = (systemRoot: string, currentPath: string | undefined): string => {
  const dir = npcapDir(systemRoot);
  if (currentPath == null || currentPath.length === 0) {
    return dir;
  }
  return currentPath.split(";").includes(dir) ? currentPath : `${dir};${currentPath}`;
};

export type TNpcapProbeDeps = {
  exists: (path: string) => boolean;
  /** Runs `reg query …` and resolves with stdout ("" on failure). */
  regQuery: (keyPath: string, valueName: string) => Promise<string>;
  systemRoot: string;
};

export const probeNpcap = async (deps: TNpcapProbeDeps): Promise<TNpcapProbe> => {
  const root = deps.systemRoot.replace(/[\\/]+$/, "");
  const regOut = await deps.regQuery("HKLM\\SYSTEM\\CurrentControlSet\\Services\\npcap\\Parameters", "AdminOnly");
  return {
    npcapDirDll: deps.exists(`${root}\\System32\\Npcap\\wpcap.dll`),
    system32Dll: deps.exists(`${root}\\System32\\wpcap.dll`),
    adminOnly: parseRegAdminOnly(regOut),
  };
};
