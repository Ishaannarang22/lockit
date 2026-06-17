import type { KdfParams } from "./kdf.js";

export const BLOB_VERSION = 1 as const;

export interface SealedBlob {
  v: typeof BLOB_VERSION;
  kdf: { algo: "argon2id"; salt: Uint8Array; params: KdfParams };
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

interface WireBlob {
  v: number;
  kdf: { algo: string; salt: string; params: KdfParams };
  nonce: string;
  ciphertext: string;
}

/** Serialize a sealed blob to the on-disk JSON envelope (base64 byte fields). */
export function encodeBlob(blob: SealedBlob): string {
  const wire: WireBlob = {
    v: blob.v,
    kdf: { algo: blob.kdf.algo, salt: b64(blob.kdf.salt), params: blob.kdf.params },
    nonce: b64(blob.nonce),
    ciphertext: b64(blob.ciphertext),
  };
  return JSON.stringify(wire);
}

/** Parse an on-disk envelope; throws on malformed JSON, an unknown version, or an unsupported kdf algo. */
export function decodeBlob(text: string): SealedBlob {
  const wire = JSON.parse(text) as WireBlob;
  if (wire.v !== BLOB_VERSION) {
    throw new Error(`unsupported sealed-blob version: ${wire.v}`);
  }
  if (wire.kdf?.algo !== "argon2id") {
    throw new Error(`unsupported kdf algo: ${wire.kdf?.algo}`);
  }
  return {
    v: BLOB_VERSION,
    kdf: { algo: "argon2id", salt: unb64(wire.kdf.salt), params: wire.kdf.params },
    nonce: unb64(wire.nonce),
    ciphertext: unb64(wire.ciphertext),
  };
}
