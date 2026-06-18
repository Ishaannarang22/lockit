import { describe, it, expect } from "vitest";
import { wrapKey, unwrapKey } from "./keywrap.js";
import { aeadSeal, aeadOpen, randomBytes, KEY_BYTES, NONCE_BYTES } from "./aead.js";

const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
// The exact domain-separation AAD keywrap uses internally ("kv:keywrap:v1").
const KEYWRAP_AAD = new TextEncoder().encode("kv:keywrap:v1");

describe("wrapKey / unwrapKey round-trip", () => {
  it("wraps a 32-byte DEK under a KEK and unwraps it byte-for-byte", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const unwrapped = await unwrapKey(wrapped, kek);
    expect(eq(unwrapped, dek)).toBe(true);
  });

  it("produces a SealedBytes with a fresh NONCE_BYTES-length nonce and ciphertext", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    expect(Object.keys(wrapped).sort()).toEqual(["ciphertext", "nonce"]);
    expect(wrapped.nonce).toBeInstanceOf(Uint8Array);
    expect(wrapped.ciphertext).toBeInstanceOf(Uint8Array);
    expect(wrapped.nonce.length).toBe(NONCE_BYTES);
    // 32-byte key + 16-byte Poly1305 tag.
    expect(wrapped.ciphertext.length).toBe(KEY_BYTES + 16);
  });

  it("uses a fresh nonce each wrap (two wraps of one DEK differ)", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const a = await wrapKey(dek, kek);
    const b = await wrapKey(dek, kek);
    expect(eq(a.nonce, b.nonce)).toBe(false);
    expect(eq(a.ciphertext, b.ciphertext)).toBe(false);
  });

  it("returns Promises (awaitable)", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wp = wrapKey(dek, kek);
    expect(wp).toBeInstanceOf(Promise);
    const wrapped = await wp;
    const up = unwrapKey(wrapped, kek);
    expect(up).toBeInstanceOf(Promise);
    await up;
  });
});

describe("wrapKey input validation", () => {
  const badLengths: Array<[string, number]> = [
    ["0-byte", 0],
    ["16-byte", 16],
    ["31-byte", 31],
    ["33-byte", 33],
    ["64-byte", 64],
  ];

  for (const [name, len] of badLengths) {
    it(`rejects wrapping a ${name} key with a '32 bytes' message`, async () => {
      const kek = await randomBytes(KEY_BYTES);
      await expect(wrapKey(new Uint8Array(len), kek)).rejects.toThrow(/32 bytes/);
    });
  }
});

describe("unwrapKey rejection on wrong KEK", () => {
  it("rejects unwrapping under a different random KEK", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrong = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    await expect(unwrapKey(wrapped, wrong)).rejects.toThrow();
  });

  it("rejects unwrapping with a single bit flipped in the KEK", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const nearly = new Uint8Array(kek);
    nearly[0] = (nearly[0] ?? 0) ^ 0x01;
    await expect(unwrapKey(wrapped, nearly)).rejects.toThrow();
  });
});

describe("unwrapKey rejection on tampering", () => {
  it("rejects a tampered ciphertext (bit flip)", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const ct = new Uint8Array(wrapped.ciphertext);
    ct[0] = (ct[0] ?? 0) ^ 0x01;
    await expect(unwrapKey({ nonce: wrapped.nonce, ciphertext: ct }, kek)).rejects.toThrow();
  });

  it("rejects a tampered nonce", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const nonce = new Uint8Array(wrapped.nonce);
    nonce[0] = (nonce[0] ?? 0) ^ 0x01;
    await expect(unwrapKey({ nonce, ciphertext: wrapped.ciphertext }, kek)).rejects.toThrow();
  });

  it("rejects a shortened ciphertext", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    const ct = wrapped.ciphertext.slice(0, wrapped.ciphertext.length - 1);
    await expect(unwrapKey({ nonce: wrapped.nonce, ciphertext: ct }, kek)).rejects.toThrow();
  });
});

describe("unwrapKey output-length validation", () => {
  it("rejects when the unwrapped plaintext is not exactly 32 bytes", async () => {
    const kek = await randomBytes(KEY_BYTES);
    // Seal a non-32-byte payload under the *correct* keywrap AAD so the AEAD layer
    // opens cleanly; the explicit output-length guard must then reject it.
    const sealedShort = await aeadSeal(new Uint8Array(16), kek, KEYWRAP_AAD);
    await expect(unwrapKey(sealedShort, kek)).rejects.toThrow(/unwrapped key must be 32 bytes/);
  });

  it("rejects an over-length unwrapped plaintext (33 bytes)", async () => {
    const kek = await randomBytes(KEY_BYTES);
    const sealedLong = await aeadSeal(new Uint8Array(33), kek, KEYWRAP_AAD);
    await expect(unwrapKey(sealedLong, kek)).rejects.toThrow(/unwrapped key must be 32 bytes/);
  });
});

describe("keywrap domain separation", () => {
  it("a generic AEAD payload (empty AAD) under the same KEK cannot be unwrapped", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const generic = await aeadSeal(dek, kek); // no keywrap AAD
    await expect(unwrapKey(generic, kek)).rejects.toThrow();
  });

  it("a wrapped key cannot be opened as a generic (empty-AAD) AEAD payload", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    await expect(aeadOpen(wrapped, kek)).rejects.toThrow();
  });

  it("uses the distinct AAD 'kv:keywrap:v1' (a payload sealed under it unwraps)", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    // Manually sealing the 32-byte DEK under the exact keywrap AAD must unwrap.
    const manual = await aeadSeal(dek, kek, KEYWRAP_AAD);
    const unwrapped = await unwrapKey(manual, kek);
    expect(eq(unwrapped, dek)).toBe(true);
  });

  it("rejects a payload sealed under a near-miss AAD ('kv:keywrap:v2')", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrongDomain = await aeadSeal(dek, kek, new TextEncoder().encode("kv:keywrap:v2"));
    await expect(unwrapKey(wrongDomain, kek)).rejects.toThrow();
  });
});
