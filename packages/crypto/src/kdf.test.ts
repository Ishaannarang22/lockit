import { describe, it, expect } from "vitest";
import { deriveKey, DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";

const salt = new Uint8Array(16).fill(7);

describe("deriveKey (Argon2id)", () => {
  it("derives a 32-byte key", async () => {
    const key = await deriveKey("correct horse battery staple", salt, DEFAULT_KDF_PARAMS);
    expect(key.length).toBe(32);
  });

  it("is deterministic for the same passphrase, salt, and params", async () => {
    const a = await deriveKey("pw", salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey("pw", salt, DEFAULT_KDF_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("differs for a different passphrase", async () => {
    const a = await deriveKey("pw1", salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey("pw2", salt, DEFAULT_KDF_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("differs for a different salt", async () => {
    const other = new Uint8Array(16).fill(9);
    const a = await deriveKey("pw", salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey("pw", other, DEFAULT_KDF_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("rejects a salt shorter than 8 bytes", async () => {
    await expect(deriveKey("pw", new Uint8Array(4), DEFAULT_KDF_PARAMS)).rejects.toThrow();
  });
});

// Type-shape assertion so later tasks rely on a stable params contract.
const _params: KdfParams = { iterations: 3, memorySize: 65536, parallelism: 1 };
