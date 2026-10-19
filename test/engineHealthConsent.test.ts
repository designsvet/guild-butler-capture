import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { desktopReportingAllowed } from "../src/main/desktopUsage.js";
import { sendEngineHealth, type TFetchLike } from "../src/main/uploadClient.js";

// Execute the actual main-process boundary, not a duplicate policy predicate. Isolating
// this declaration avoids starting Electron, touching a profile, or spawning a capture.
const source = ts.createSourceFile(
  "index.ts", readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true,
);
const boundary = source.statements.find((statement) =>
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "forwardEngineHealth"),
);
if (!boundary) throw new Error("The actual forwardEngineHealth boundary must remain covered");
const executable = ts.transpileModule(`${boundary.getText(source)}\nglobalThis.invoke = forwardEngineHealth;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const broken = [{ handler: "EvAttachItemContainer", failures: 5, calls: 5 }];
const setup = (options: {
  enabled?: boolean; packaged?: boolean; env?: Record<string, string | undefined>; source?: string; paired?: boolean;
} = {}) => {
  const settings = { telemetryEnabled: options.enabled, apiBase: "http://127.0.0.1:8788", pairing: {} };
  const fetch = vi.fn<TFetchLike>().mockResolvedValue({ ok: true, status: 200, text: async () => '{"received":1}' });
  const decryptToken = vi.fn(() => options.paired === false ? null : "fixture-pairing-token");
  const appLog = vi.fn();
  const context = {
    SETTINGS_FILE: "unused-fixture-path", loadSettings: () => settings, safeStorage: {}, decryptToken,
    appLog, fetch, sendEngineHealth, desktopReportingAllowed,
    app: { isPackaged: options.packaged ?? true, getVersion: () => "0.8.10" },
    process: { env: options.env ?? {} }, currentEngine: { source: options.source ?? "bundled" },
    invoke: (_fresh: typeof broken): void => { throw new Error("VM did not install the actual boundary"); },
  };
  runInNewContext(executable, context);
  return { settings, fetch, decryptToken, appLog, report: () => context.invoke(broken) };
};

describe("legacy automatic engine health respects sharing consent", () => {
  it.each([undefined, false])("keeps local warnings but sends nothing when consent is %s", (enabled) => {
    const t = setup({ enabled }); t.report();
    expect(t.appLog).toHaveBeenCalledWith("engine health: broken EvAttachItemContainer 5/5");
    expect(t.decryptToken).not.toHaveBeenCalled();
    expect(t.fetch).not.toHaveBeenCalled();
  });
  it("uses the existing paired transport only after explicit opt-in", () => {
    const t = setup({ enabled: true }); t.report();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8788/control/capture/engine-health");
    expect(init.headers.authorization).toBe("Bearer fixture-pairing-token");
    expect(JSON.parse(init.body)).toEqual({ appVersion: "0.8.10", broken });
  });
  it("reads the current preference again and stops after sharing is switched off", () => {
    const t = setup({ enabled: true }); t.report();
    t.settings.telemetryEnabled = false; t.report();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.decryptToken).toHaveBeenCalledTimes(1);
    expect(t.appLog).toHaveBeenCalledTimes(2);
  });
  it("does not send an automatic paired report without pairing", () => {
    const t = setup({ enabled: true, paired: false }); t.report();
    expect(t.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { packaged: false },
    { source: "mock" },
    { source: "replay" },
    { env: { GBC_MOCK_ENGINE: "1" } },
    { env: { GBC_REPLAY: "1" } },
    { env: { GBC_REPLAY_ENGINE: "fixture" } },
    { env: { GBC_REPLAY_DIR: "fixture" } },
    { env: { GBC_NO_TELEMETRY: "1" } },
  ])("blocks non-production or disabled sessions despite saved opt-in: %j", (options) => {
    const t = setup({ enabled: true, ...options }); t.report();
    expect(t.appLog).toHaveBeenCalledWith("engine health: broken EvAttachItemContainer 5/5");
    expect(t.decryptToken).not.toHaveBeenCalled();
    expect(t.fetch).not.toHaveBeenCalled();
  });
});
