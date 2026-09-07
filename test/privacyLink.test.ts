import { describe, expect, it } from "vitest";
import { IPC, PRIVACY_URL } from "../src/shared/ipc.js";
import { stringsFor } from "../src/shared/strings.js";

// The settings popover's "Privacy policy" link. Its URL is an external promise (the
// marketing site's legal page, capture section) and every language must label it.
describe("privacy-policy link", () => {
  it("points at the policy's capture section over https", () => {
    const url = new URL(PRIVACY_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("guild-butler.com");
    expect(url.pathname).toBe("/legal/");
    expect(url.searchParams.get("tab")).toBe("privacy");
    expect(url.hash).toBe("#p-capture");
  });

  it("has its own channel, distinct from every other", () => {
    const values = Object.values(IPC);
    expect(values).toContain("app:open-privacy");
    expect(new Set(values).size).toBe(values.length);
  });

  it("is labelled in every language", () => {
    for (const lang of ["en", "uk", "ru", "de", "fr", "pt"] as const) {
      expect(stringsFor(lang).footer.privacy.trim().length, lang).toBeGreaterThan(0);
    }
  });
});
