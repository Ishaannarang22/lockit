import { describe, it, expect } from "vitest";
import { aeadSeal, aeadOpen, KEY_BYTES, NONCE_BYTES, randomBytes } from "./aead.js";

describe("aead round-trip", () => {
  it("seals and opens back to the original plaintext", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = new TextEncoder().encode("sk-secret-value");
    const sealed = await aeadSeal(message, key);
    expect(sealed.nonce.length).toBe(NONCE_BYTES);
    expect(sealed.ciphertext).not.toEqual(message); // actually encrypted
    const opened = await aeadOpen(sealed, key);
    expect(new TextDecoder().decode(opened)).toBe("sk-secret-value");
  });

  it("binds associated data (AAD): mismatched AAD fails to open", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = new TextEncoder().encode("hello");
    const sealed = await aeadSeal(message, key, new TextEncoder().encode("ctx-A"));
    await expect(aeadOpen(sealed, key, new TextEncoder().encode("ctx-B"))).rejects.toThrow();
  });
});

describe("aead tamper detection", () => {
  it("rejects a flipped ciphertext byte", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(new TextEncoder().encode("data"), key);
    const tampered = {
      nonce: sealed.nonce,
      ciphertext: new Uint8Array(sealed.ciphertext),
    };
    tampered.ciphertext[0] ^= 0x01;
    await expect(aeadOpen(tampered, key)).rejects.toThrow();
  });

  it("rejects a wrong key", async () => {
    const key = await randomBytes(KEY_BYTES);
    const wrong = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(new TextEncoder().encode("data"), key);
    await expect(aeadOpen(sealed, wrong)).rejects.toThrow();
  });
});
