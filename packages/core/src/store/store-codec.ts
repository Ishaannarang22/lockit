import type { StoreData } from "./store.js";

/** Serialize a store to UTF-8 JSON bytes (the plaintext that gets sealed). */
export function encodeStore(store: StoreData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(store));
}

function isStoredSecret(x: unknown): boolean {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.slug === "string" &&
    typeof s.schema === "string" &&
    Array.isArray(s.aka) &&
    Array.isArray(s.tags) &&
    Array.isArray(s.fields) &&
    s.fields.every((f) => {
      if (typeof f !== "object" || f === null) return false;
      const field = f as Record<string, unknown>;
      return typeof field.key === "string" && typeof field.value === "string";
    })
  );
}

/** Parse UTF-8 JSON bytes back into a store, validating the on-disk shape so a
 *  corrupted-but-decryptable store fails loudly instead of crashing the read path. */
export function decodeStore(bytes: Uint8Array): StoreData {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StoreData;
  if (parsed.version !== 1) {
    throw new Error(`unsupported store version: ${String(parsed.version)}`);
  }
  if (!Array.isArray(parsed.secrets) || !parsed.secrets.every(isStoredSecret)) {
    throw new Error("malformed store");
  }
  return parsed;
}
