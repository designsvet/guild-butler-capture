import { describe, expect, it } from "vitest";
import { sendDesktopRequest } from "../src/main/uploadClient.js";

describe("desktop transport", () => {
  it("keeps credentials in headers and permits a report without pairing", async () => {
    let request: { headers: Record<string, string>; body: string; signal: AbortSignal } | undefined;
    const result = await sendDesktopRequest(async (url, init) => {
      expect(url).toBe("https://staging.example/control/desktop/reports"); request = init;
      return { ok: true, status: 200, text: async () => '{"ok":true,"reportNumber":25}' };
    }, "https://staging.example/", "reports", "installation-secret", null, { reportId: "report-1" });
    expect(result.body?.reportNumber).toBe(25);
    expect(request!.headers.Authorization).toBe("Bearer installation-secret");
    expect(request!.headers).not.toHaveProperty("x-capture-token");
    expect(request!.body).not.toContain("secret");
    expect(request!.signal).toBeInstanceOf(AbortSignal);
  });
  it("forwards optional pairing only as authentication and reports network errors as a retryable result", async () => {
    const response = await sendDesktopRequest(async (_url, init) => {
      expect(init.headers["x-capture-token"]).toBe("capture-credential"); throw new Error("network down");
    }, "", "register", "installation-secret", "capture-credential", {});
    expect(response).toEqual({ ok: false, status: 0, body: null });
  });
});
