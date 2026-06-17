import { describe, it, expect } from "vitest";
import { encodeBlob, decodeBlob, BLOB_VERSION, type SealedBlob } from "./blob.js";
import { DEFAULT_KDF_PARAMS } from "./kdf.js";

const sample: SealedBlob = {
  v: BLOB_VERSION,
  kdf: { algo: "argon2id", salt: new Uint8Array(16).fill(1), params: DEFAULT_KDF_PARAMS },
  nonce: new Uint8Array(24).fill(2),
  ciphertext: new Uint8Array([9, 8, 7, 6]),
};

describe("sealed-blob format", () => {
  it("round-trips through encode/decode", () => {
    const decoded = decodeBlob(encodeBlob(sample));
    expect(decoded.v).toBe(BLOB_VERSION);
    expect(decoded.kdf.algo).toBe("argon2id");
    expect(Buffer.from(decoded.kdf.salt).equals(Buffer.from(sample.kdf.salt))).toBe(true);
    expect(Buffer.from(decoded.nonce).equals(Buffer.from(sample.nonce))).toBe(true);
    expect(Buffer.from(decoded.ciphertext).equals(Buffer.from(sample.ciphertext))).toBe(true);
    expect(decoded.kdf.params).toEqual(DEFAULT_KDF_PARAMS);
  });

  it("encodes to valid JSON text", () => {
    expect(() => JSON.parse(encodeBlob(sample))).not.toThrow();
  });

  it("rejects an unknown version", () => {
    const bad = JSON.stringify({ ...JSON.parse(encodeBlob(sample)), v: 999 });
    expect(() => decodeBlob(bad)).toThrow(/unsupported.*version/i);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeBlob("{not json")).toThrow();
  });
});
