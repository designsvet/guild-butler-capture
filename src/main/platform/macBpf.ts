/**
 * macOS capture permissions — the reason the raw script needed `sudo`.
 *
 * libpcap opens /dev/bpf*, which ships root-owned 0600. The standard fix is
 * Wireshark's ChmodBPF approach, copied here in approach (not code): a one-time
 * ADMIN-authorised install drops a LaunchDaemon that, at every boot, puts the
 * bpf devices into an `access_bpf` group the user is a member of. Details and
 * the current-session bridge live in resources/mac/install-bpf-helper.sh.
 *
 * The app itself never asks for sudo and never runs as root: one macOS
 * password prompt (osascript "with administrator privileges"), once.
 */

import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, promises as fsp, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { ECaptureAccess } from "../../shared/captureTypes.js";

/**
 * Can this user open a bpf device? access(2) answers the PERMISSION question
 * without touching the device (busy ≠ denied). Checking a handful covers the
 * "first device busy" case; any readable+writable one means libpcap will find
 * a usable device too.
 */
export const checkBpfAccess = async (
  access: (path: string) => Promise<void> = async (p) => {
    await fsp.access(p, 4 | 2); // R_OK | W_OK without importing constants into the signature
  },
): Promise<ECaptureAccess> => {
  let sawDevice = false;
  for (let i = 0; i < 5; i += 1) {
    try {
      await access(`/dev/bpf${i}`);
      return ECaptureAccess.Ok;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        sawDevice = true;
      }
    }
  }
  return sawDevice ? ECaptureAccess.NoPermission : ECaptureAccess.Unknown;
};

/** POSIX single-quote escaping: safe for paths with spaces/quotes ("Application Support"). */
export const shellQuote = (part: string): string => {
  return `'${part.replace(/'/g, `'\\''`)}'`;
};

/** Escape a string into an AppleScript double-quoted literal. */
export const appleScriptQuote = (script: string): string => {
  return `"${script.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

/**
 * The osascript program that runs the installer with admin rights. Built as
 * data (and unit-tested with hostile paths) because this is exactly the kind
 * of string that works on the developer's machine and breaks on the first
 * user whose account name has a space in it.
 */
export const buildAdminInstallScript = (installerPath: string, userName: string, resourceDir: string): string => {
  const shellCmd = ["/bin/sh", installerPath, userName, resourceDir].map(shellQuote).join(" ");
  return `do shell script ${appleScriptQuote(shellCmd)} with administrator privileges`;
};

/**
 * Stage the installer resources into a private temp dir and return where to
 * run from. This is not tidiness — it is the fix for a real failure: the
 * privileged run happens via security_authtrampoline, and ROOT DOES NOT
 * BYPASS TCC. When the app sits under a File-Provider folder
 * (~/Library/CloudStorage/Dropbox…, the owner's dev layout), root is denied
 * reading the script the instant the password is accepted — four silent
 * "failed" attempts on the first hardware pass. The app itself (as the user,
 * who holds the TCC grant for their own Dropbox) copies the helper files
 * somewhere TCC-free first; the installer also `cp`s from this dir as root,
 * so the staging covers that read too.
 */
export const stageBpfResources = (resourceDir: string): { dir: string; installerPath: string } => {
  const dir = mkdtempSync(join(tmpdir(), "gbc-bpf-"));
  cpSync(resourceDir, dir, { recursive: true });
  return { dir, installerPath: join(dir, "install-bpf-helper.sh") };
};

/** Best-effort cleanup of a staged dir once the install attempt settled. */
export const removeStagedBpfResources = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // a leftover temp dir must never surface as an install failure
  }
};

export type TBpfInstallResult = {
  ok: boolean;
  /** The user dismissed the admin password prompt — a choice, not a failure. */
  cancelled: boolean;
  /** osascript's stderr / error message on failure, for the app log + UI. */
  detail: string | null;
};

/**
 * Dismissing the osascript password prompt surfaces as AppleScript error -128
 * ("User canceled."). Telling that apart from a real failure matters: one
 * needs "click it again and enter the password", the other needs the log.
 */
export const isUserCancelled = (errorText: string): boolean => {
  return /user canceled|\(-128\)|error -128/i.test(errorText);
};

/**
 * Run the one-time helper install. `ok` means the script completed — the
 * caller still re-probes access afterwards, because "the installer exited 0"
 * and "capture works now" are only the same when everything went right.
 */
export const installBpfHelper = async (resourceDir: string, installerPath: string): Promise<TBpfInstallResult> => {
  const script = buildAdminInstallScript(installerPath, userInfo().username, resourceDir);
  return await new Promise((resolve) => {
    execFile("osascript", ["-e", script], { timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err == null) {
        resolve({ ok: true, cancelled: false, detail: null });
        return;
      }
      const text = `${stderr ?? ""} ${err.message}`.replace(/\s+/g, " ").trim();
      resolve({ ok: false, cancelled: isUserCancelled(text), detail: text.slice(0, 500) || null });
    });
  });
};
