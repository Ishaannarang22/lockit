import { aeadSeal, aeadOpen, KEY_BYTES, type SealedBytes } from "./aead.js";

// Domain separation: keys wrapped for the unlock/cache path must not be
// interchangeable with generic AEAD payloads sealed under the same KEK.
const KEYWRAP_AAD = new TextEncoder().encode("kv:keywrap:v1");

/** Wrap a 32-byte key under a 32-byte key-encryption key (KEK). */
export async function wrapKey(key: Uint8Array, kek: Uint8Array): Promise<SealedBytes> {
  if (key.length !== KEY_BYTES) throw new Error(`key to wrap must be ${KEY_BYTES} bytes`);
  return aeadSeal(key, kek, KEYWRAP_AAD);
}

/** Unwrap a key previously wrapped under `kek`; rejects on a wrong KEK or tampering. */
export async function unwrapKey(wrapped: SealedBytes, kek: Uint8Array): Promise<Uint8Array> {
  const key = await aeadOpen(wrapped, kek, KEYWRAP_AAD);
  if (key.length !== KEY_BYTES) throw new Error(`unwrapped key must be ${KEY_BYTES} bytes`);
  return key;
}
