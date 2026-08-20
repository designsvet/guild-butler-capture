import { describe, expect, it } from "vitest";

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appleScriptQuote,
  buildAdminInstallScript,
  checkBpfAccess,
  isUserCancelled,
  removeStagedBpfResources,
  shellQuote,
  stageBpfResources,
} from "../src/main/platform/macBpf.js";
import { classifyNpcap, npcapChildPathEnv, parseRegAdminOnly, probeNpcap } from "../src/main/platform/winNpcap.js";
import { ECaptureAccess } from "../src/shared/captureTypes.js";

const errnoError = (code: string): NodeJS.ErrnoException => {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
};

describe("macOS bpf access probe", () => {
  it("any accessible device means Ok (busy first devices are not a denial)", async () => {
    const verdict = await checkBpfAccess(async (path) => {
      if (path !== "/dev/bpf2") {
        throw errnoError("EACCES");
      }
    });
    expect(verdict).toBe(ECaptureAccess.Ok);
  });

  it("all devices denied means NoPermission", async () => {
    const verdict = await checkBpfAccess(async () => {
      throw errnoError("EACCES");
    });
    expect(verdict).toBe(ECaptureAccess.NoPermission);
  });

  it("no devices at all (not a mac, odd kernel) means Unknown — fail open", async () => {
    const verdict = await checkBpfAccess(async () => {
      throw errnoError("ENOENT");
    });
    expect(verdict).toBe(ECaptureAccess.Unknown);
  });
});

describe("macOS admin install script builder", () => {
  it("survives spaces and single quotes in every argument", () => {
    const script = buildAdminInstallScript(
      "/Applications/Guild Butler Capture.app/Contents/Resources/mac/install-bpf-helper.sh",
      "o'brien",
      "/Applications/Guild Butler Capture.app/Contents/Resources/mac",
    );
    expect(script.startsWith('do shell script "')).toBe(true);
    expect(script.endsWith('" with administrator privileges')).toBe(true);
    // the embedded shell command still single-quotes each part
    expect(script).toContain("install-bpf-helper.sh");
    expect(script).toContain("o'\\''brien".replace(/\\/g, "\\\\"));
  });

  it("shellQuote and appleScriptQuote survive hostile input", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("o'brien")).toBe("'o'\\''brien'");
    expect(appleScriptQuote('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
  });

  it("stages the helper files to a temp dir the privileged run can read (root does not bypass TCC)", () => {
    const fakeResources = mkdtempSync(join(tmpdir(), "gbc-res-"));
    mkdirSync(fakeResources, { recursive: true });
    writeFileSync(join(fakeResources, "install-bpf-helper.sh"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(fakeResources, "fix-bpf.sh"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(fakeResources, "com.guildbutler.capture.bpf.plist"), "<plist/>");
    try {
      const staged = stageBpfResources(fakeResources);
      try {
        expect(staged.installerPath).toBe(join(staged.dir, "install-bpf-helper.sh"));
        // the installer reads its two payload files from the SAME staged dir
        expect(readFileSync(staged.installerPath, "utf8")).toContain("exit 0");
        expect(existsSync(join(staged.dir, "fix-bpf.sh"))).toBe(true);
        expect(existsSync(join(staged.dir, "com.guildbutler.capture.bpf.plist"))).toBe(true);
        expect(staged.dir.startsWith(fakeResources)).toBe(false);
      } finally {
        removeStagedBpfResources(staged.dir);
        expect(existsSync(staged.dir)).toBe(false);
      }
    } finally {
      rmSync(fakeResources, { recursive: true, force: true });
    }
  });

  it("tells a dismissed password prompt apart from a real installer failure", () => {
    // osascript's exact words for a dismissed auth dialog (AppleScript error -128)
    expect(isUserCancelled("execution error: User canceled. (-128)")).toBe(true);
    expect(isUserCancelled("Error: user canceled")).toBe(true);
    expect(isUserCancelled("dseditgroup: Operation failed with error eDSPermissionError")).toBe(false);
    expect(isUserCancelled("sh: /nonexistent/install-bpf-helper.sh: No such file or directory")).toBe(false);
  });
});

describe("windows npcap classification", () => {
  it("no dll anywhere → NpcapMissing", () => {
    expect(classifyNpcap({ npcapDirDll: false, system32Dll: false, adminOnly: null })).toBe(
      ECaptureAccess.NpcapMissing,
    );
  });

  it("installed with AdminOnly=1 → NpcapAdminOnly", () => {
    expect(classifyNpcap({ npcapDirDll: true, system32Dll: false, adminOnly: 1 })).toBe(ECaptureAccess.NpcapAdminOnly);
  });

  it("installed, unrestricted (or unreadable registry) → Ok", () => {
    expect(classifyNpcap({ npcapDirDll: true, system32Dll: true, adminOnly: 0 })).toBe(ECaptureAccess.Ok);
    expect(classifyNpcap({ npcapDirDll: false, system32Dll: true, adminOnly: null })).toBe(ECaptureAccess.Ok);
  });

  it("parses reg query output, hex included", () => {
    const output = [
      "",
      "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\npcap\\Parameters",
      "    AdminOnly    REG_DWORD    0x1",
      "",
    ].join("\r\n");
    expect(parseRegAdminOnly(output)).toBe(1);
    expect(parseRegAdminOnly("garbage")).toBeNull();
    expect(parseRegAdminOnly("AdminOnly    REG_DWORD    0x0")).toBe(0);
  });

  it("probe combines fs + registry through injected deps", async () => {
    const probe = await probeNpcap({
      exists: (p) => p === "C:\\Windows\\System32\\Npcap\\wpcap.dll",
      regQuery: () => Promise.resolve("AdminOnly    REG_DWORD    0x1"),
      systemRoot: "C:\\Windows\\",
    });
    expect(probe).toEqual({ npcapDirDll: true, system32Dll: false, adminOnly: 1 });
  });

  it("prepends the Npcap dir to the child PATH exactly once", () => {
    const first = npcapChildPathEnv("C:\\Windows", "C:\\bin;D:\\tools");
    expect(first).toBe("C:\\Windows\\System32\\Npcap;C:\\bin;D:\\tools");
    expect(npcapChildPathEnv("C:\\Windows", first)).toBe(first);
    expect(npcapChildPathEnv("C:\\Windows", undefined)).toBe("C:\\Windows\\System32\\Npcap");
  });
});
