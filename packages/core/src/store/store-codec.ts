import type { StoreData } from "./store.js";

/** Serialize a store to UTF-8 JSON bytes (the plaintext that gets sealed). */
export function encodeStore(store: StoreData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(store));
}

/** Parse UTF-8 JSON bytes back into a store, validating the on-disk shape. */
export function decodeStore(bytes: Uint8Array): StoreData {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StoreData;
  if (parsed.version !== 1) {
    throw new Error(`unsupported store version: ${String(parsed.version)}`);
  }
  if (!Array.isArray(parsed.secrets)) {
    throw new Error("malformed store");
  }
  return parsed;
}
