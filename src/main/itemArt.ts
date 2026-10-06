/**
 * The item-art protocol's pure core. The host supplies disk and HTTP access;
 * this module owns the allowed request shape, image checks and shared loads.
 */

type TItemArtRequest = { item: string; key: string; url: string };
type TItemArtReply = { ok: boolean; bytes: Uint8Array; contentType: string | null };
type TItemArtDependencies = {
  read: (key: string) => Promise<Uint8Array | null>;
  write: (key: string, bytes: Uint8Array) => Promise<void>;
  fetch: (url: string) => Promise<TItemArtReply>;
  log: (message: string, error?: unknown) => void;
};

const PREFIX = "albion-art://item/";
const ITEM_ID = /^[A-Z0-9_]+(?:@[0-4])?$/;
const MAX_ITEM_LENGTH = 160;
const MAX_PNG_BYTES = 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Validate the original URL before any URL parser can normalize its path. */
export const itemArtRequest = (url: string): TItemArtRequest | null => {
  if (!url.startsWith(PREFIX)) {
    return null;
  }
  const item = url.slice(PREFIX.length);
  if (item.length === 0 || item.length > MAX_ITEM_LENGTH || ITEM_ID.exec(item)?.[0] !== item) {
    return null;
  }
  return {
    item,
    key: item.replace("@", "-ENCHANT-"),
    url: `https://render.albiononline.com/v1/item/${encodeURIComponent(item)}.png?size=64&quality=1`,
  };
};

const validPng = (bytes: Uint8Array): boolean => {
  return (
    bytes instanceof Uint8Array &&
    bytes.length >= PNG_MAGIC.length &&
    bytes.length <= MAX_PNG_BYTES &&
    PNG_MAGIC.every((value, index) => bytes[index] === value)
  );
};

/** Cached images work offline; overlapping requests for one item share all I/O. */
export const createItemArt = ({ read, write, fetch, log }: TItemArtDependencies) => {
  const pending = new Map<string, Promise<Uint8Array | null>>();

  const report = (message: string, error?: unknown): void => {
    try {
      log(message, error);
    } catch {
      // A broken logger must not turn an unavailable image into a rejected load.
    }
  };

  const loadRequest = async ({ item, key, url }: TItemArtRequest): Promise<Uint8Array | null> => {
    try {
      const cached = await read(key);
      if (cached !== null) {
        if (validPng(cached)) {
          return cached;
        }
        report(`Item art cache entry refused: ${item}`);
      }
    } catch (error) {
      report(`Item art cache read failed: ${item}`, error);
    }

    let reply: TItemArtReply;
    try {
      reply = await fetch(url);
    } catch (error) {
      report(`Item art fetch failed: ${item}`, error);
      return null;
    }
    const contentType = reply.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (!reply.ok || contentType !== "image/png" || !validPng(reply.bytes)) {
      report(`Item art reply refused: ${item}`);
      return null;
    }

    try {
      await write(key, reply.bytes);
    } catch (error) {
      report(`Item art cache write failed: ${item}`, error);
    }
    return reply.bytes;
  };

  return async (url: string): Promise<Uint8Array | null> => {
    const request = itemArtRequest(url);
    if (request === null) {
      report("Item art URL refused");
      return null;
    }
    const existing = pending.get(request.key);
    if (existing !== undefined) {
      return existing;
    }
    const loading = loadRequest(request).finally(() => {
      pending.delete(request.key);
    });
    pending.set(request.key, loading);
    return loading;
  };
};
