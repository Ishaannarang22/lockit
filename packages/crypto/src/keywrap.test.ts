import { describe, it, expect } from "vitest";
import { wrapKey, unwrapKey } from "./keywrap.js";
import { aeadSeal, aeadOpen, randomBytes, KEY_BYTES } from "./aead.js";

describe("key wrap/unwrap", () => {
  it("round-trips a key under a KEK", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const unwrapped = await unwrapKey(wrapped, kek);
    expect(Buffer.from(unwrapped).equals(Buffer.from(dek))).toBe(true);
  });

  it("rejects unwrapping under the wrong KEK", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrong = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    await expect(unwrapKey(wrapped, wrong)).rejects.toThrow();
  });

  it("rejects a tampered wrapped key", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const tampered = { nonce: wrapped.nonce, ciphertext: new Uint8Array(wrapped.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0x01;
    await expect(unwrapKey(tampered, kek)).rejects.toThrow();
  });

  it("rejects wrapping a key that is not 32 bytes", async () => {
    const kek = await randomBytes(KEY_BYTES);
    await expect(wrapKey(new Uint8Array(16), kek)).rejects.toThrow(/32 bytes/);
  });

  it("is domain-separated from plain AEAD", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    // A generic payload sealed under the same KEK (no keywrap AAD) must not unwrap.
    const generic = await aeadSeal(dek, kek);
    await expect(unwrapKey(generic, kek)).rejects.toThrow();
    // And a wrapped key must not open as a generic (empty-AAD) payload.
    const wrapped = await wrapKey(dek, kek);
    await expect(aeadOpen(wrapped, kek)).rejects.toThrow();
  });
});
