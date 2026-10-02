import { describe, expect, it, vi } from "vitest";

import { createItemArt, itemArtRequest } from "../src/main/itemArt.js";

type TReply = { ok: boolean; bytes: Uint8Array; contentType: string | null };
const URL = "albion-art://item/T4_BAG@2";
const UPSTREAM = "https://render.albiononline.com/v1/item/T4_BAG%402.png?size=64&quality=1";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const bytesOfLength = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  bytes.set(PNG);
  return bytes;
};
const dependencies = () => ({
  read: vi.fn(async (_key: string): Promise<Uint8Array | null> => null),
  write: vi.fn(async (_key: string, _bytes: Uint8Array): Promise<void> => {}),
  fetch: vi.fn(async (_url: string): Promise<TReply> => ({ ok: true, bytes: PNG, contentType: "image/png" })),
  log: vi.fn((_message: string, _error?: unknown): void => {}),
});

describe("item art request boundary", () => {
  it("derives a safe cache key and a fixed upstream from a canonical item URL", () => {
    expect(itemArtRequest(URL)).toEqual({ item: "T4_BAG@2", key: "T4_BAG-ENCHANT-2", url: UPSTREAM });
    expect(itemArtRequest("albion-art://item/T8_2H_GLAIVE@4")).toEqual({
      item: "T8_2H_GLAIVE@4",
      key: "T8_2H_GLAIVE-ENCHANT-4",
      url: "https://render.albiononline.com/v1/item/T8_2H_GLAIVE%404.png?size=64&quality=1",
    });
    expect(itemArtRequest("albion-art://item/T4_BAG")?.key).toBe("T4_BAG");
  });

  it.each([
    "https://render.albiononline.com/v1/item/T4_BAG.png",
    "http://127.0.0.1/T4_BAG",
    "file:///etc/passwd",
    "albion-art://127.0.0.1/T4_BAG",
    "albion-art://item.evil.test/T4_BAG",
    "albion-art://user@item/T4_BAG",
    "albion-art://user:password@item/T4_BAG",
    "albion-art://item:443/T4_BAG",
    "albion-art://item:/T4_BAG",
    "albion-art://item/T4_BAG?url=https://evil.test/",
    "albion-art://item/T4_BAG?",
    "albion-art://item/T4_BAG#fragment",
    "albion-art://item/T4_BAG#",
    "albion-art://item/../T4_BAG",
    "albion-art://item/T4_BAG/../T5_BAG",
    "albion-art://item/%2e%2e/T4_BAG",
    "albion-art://item/%2E%2E%2FT4_BAG",
    "albion-art://item/%54%34_BAG",
    "albion-art://item/T4_BAG%402",
    "albion-art://item/T4_BAG%2fT5_BAG",
    "albion-art://item//T4_BAG",
    "albion-art://item/T4_BAG/",
    "albion-art://item/T4_BAG\\T5_BAG",
    "albion-art://item/",
    "albion-art://item/t4_bag",
    "albion-art://item/T4_BAG@5",
    "albion-art://item/T4_BAG@02",
    "albion-art://item/T4_BAG@2@3",
    "albion-art://item/T4-BAG",
    "albion-art://item/T4_BAG.png",
    "albion-art://item/T4_BAG\n",
    "albion-art://item/T4_BAG\r\n",
    " albion-art://item/T4_BAG",
    "ALBION-ART://item/T4_BAG",
    "albion-art://ITEM/T4_BAG",
  ])("refuses noncanonical or unsafe input: %s", (url) => {
    expect(itemArtRequest(url)).toBeNull();
  });

  it("bounds the complete item id to 160 characters", () => {
    expect(itemArtRequest(`albion-art://item/${"A".repeat(160)}`)?.item.length).toBe(160);
    expect(itemArtRequest(`albion-art://item/${"A".repeat(161)}`)).toBeNull();
    expect(itemArtRequest(`albion-art://item/${"A".repeat(159)}@2`)).toBeNull();
  });
});

describe("item art loading", () => {
  it("rejects unsafe requests before disk or network access", async () => {
    const deps = dependencies();
    expect(await createItemArt(deps)("albion-art://item/../T4_BAG")).toBeNull();
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledOnce();
  });

  it("fetches only the fixed upstream and persists a valid PNG under its safe key", async () => {
    const deps = dependencies();
    expect(await createItemArt(deps)(URL)).toEqual(PNG);
    expect(deps.read).toHaveBeenCalledWith("T4_BAG-ENCHANT-2");
    expect(deps.fetch).toHaveBeenCalledWith(UPSTREAM);
    expect(deps.write).toHaveBeenCalledWith("T4_BAG-ENCHANT-2", PNG);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("serves valid cached bytes while offline without trying the network", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue(PNG);
    deps.fetch.mockRejectedValue(new Error("offline"));
    expect(await createItemArt(deps)(URL)).toEqual(PNG);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong PNG signature", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])],
    ["truncated signature", PNG.slice(0, 7)],
    ["over one MiB", bytesOfLength(1024 * 1024 + 1)],
  ])("refetches a cached entry with %s", async (_label, bytes) => {
    const deps = dependencies();
    deps.read.mockResolvedValue(bytes as Uint8Array);
    expect(await createItemArt(deps)(URL)).toEqual(PNG);
    expect(deps.fetch).toHaveBeenCalledOnce();
    expect(deps.write).toHaveBeenCalledWith("T4_BAG-ENCHANT-2", PNG);
    expect(deps.log).toHaveBeenCalledOnce();
  });

  it.each<TReply>([
    { ok: false, bytes: PNG, contentType: "image/png" },
    { ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), contentType: "image/png" },
    { ok: true, bytes: PNG.slice(0, 7), contentType: "image/png" },
    { ok: true, bytes: bytesOfLength(1024 * 1024 + 1), contentType: "image/png" },
    { ok: true, bytes: PNG, contentType: "text/html" },
    { ok: true, bytes: PNG, contentType: null },
  ])("does not cache a failed or invalid PNG response %#", async (reply) => {
    const deps = dependencies();
    deps.fetch.mockResolvedValue(reply);
    expect(await createItemArt(deps)(URL)).toBeNull();
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledOnce();
  });

  it("accepts the one MiB boundary and a PNG content type with parameters", async () => {
    const deps = dependencies();
    const bytes = bytesOfLength(1024 * 1024);
    deps.fetch.mockResolvedValue({ ok: true, bytes, contentType: "image/png; charset=binary" });
    expect(await createItemArt(deps)(URL)).toEqual(bytes);
    expect(deps.write).toHaveBeenCalledOnce();
  });

  it("reports an offline cache miss and returns null", async () => {
    const deps = dependencies();
    const failure = new Error("offline");
    deps.fetch.mockRejectedValue(failure);
    expect(await createItemArt(deps)(URL)).toBeNull();
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("Item art fetch failed: T4_BAG@2", failure);
  });

  it("recovers from a cache read error by fetching", async () => {
    const deps = dependencies();
    const failure = new Error("disk read failed");
    deps.read.mockRejectedValue(failure);
    expect(await createItemArt(deps)(URL)).toEqual(PNG);
    expect(deps.write).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith("Item art cache read failed: T4_BAG@2", failure);
  });

  it("still serves a fetched image when saving it fails", async () => {
    const deps = dependencies();
    const failure = new Error("disk write failed");
    deps.write.mockRejectedValue(failure);
    expect(await createItemArt(deps)(URL)).toEqual(PNG);
    expect(deps.log).toHaveBeenCalledWith("Item art cache write failed: T4_BAG@2", failure);
  });

  it("coalesces overlapping loads for the same item, including the cache write", async () => {
    const deps = dependencies();
    let finish: (reply: TReply) => void = () => {};
    deps.fetch.mockReturnValue(
      new Promise<TReply>((resolve) => {
        finish = resolve;
      }),
    );
    const load = createItemArt(deps);
    const first = load(URL);
    const second = load(URL);
    await Promise.resolve();
    expect(deps.read).toHaveBeenCalledOnce();
    expect(deps.fetch).toHaveBeenCalledOnce();
    finish({ ok: true, bytes: PNG, contentType: "image/png" });
    expect(await Promise.all([first, second])).toEqual([PNG, PNG]);
    expect(deps.write).toHaveBeenCalledOnce();
  });

  it("keeps distinct item loads independent", async () => {
    const deps = dependencies();
    const load = createItemArt(deps);
    expect(await Promise.all([load(URL), load("albion-art://item/T5_BAG")])).toEqual([PNG, PNG]);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.write).toHaveBeenCalledWith("T5_BAG", PNG);
  });

  it("clears a failed in-flight load so the next request can retry", async () => {
    const deps = dependencies();
    deps.fetch.mockRejectedValueOnce(new Error("offline"));
    const load = createItemArt(deps);
    expect(await load(URL)).toBeNull();
    expect(await load(URL)).toEqual(PNG);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns null even if reporting a failure also throws", async () => {
    const deps = dependencies();
    deps.fetch.mockRejectedValue(new Error("offline"));
    deps.log.mockImplementation(() => {
      throw new Error("broken logger");
    });
    expect(await createItemArt(deps)(URL)).toBeNull();
  });
});
