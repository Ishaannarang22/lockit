import { describe, it, expect } from "vitest";
import {
  aeadSeal,
  aeadOpen,
  KEY_BYTES,
  NONCE_BYTES,
  randomBytes,
  type SealedBytes,
} from "./aead.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe("aead constants", () => {
  it("exposes the XChaCha20-Poly1305 key size as 32", () => {
    expect(KEY_BYTES).toBe(32);
  });

  it("exposes the XChaCha20-Poly1305 nonce size as 24", () => {
    expect(NONCE_BYTES).toBe(24);
  });
});

describe("aeadSeal round-trip", () => {
  it("seals plaintext to a fresh-nonce SealedBytes and opens back byte-for-byte", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = enc("sk-secret-value");
    const sealed = await aeadSeal(message, key);
    expect(sealed.nonce.length).toBe(NONCE_BYTES);
    const opened = await aeadOpen(sealed, key);
    expect(eq(opened, message)).toBe(true);
    expect(dec(opened)).toBe("sk-secret-value");
  });

  it("produces a ciphertext that differs from the plaintext (actual encryption)", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = enc("not-encrypted?");
    const sealed = await aeadSeal(message, key);
    expect(eq(sealed.ciphertext, message)).toBe(false);
  });

  it("returns an object whose nonce and ciphertext are both Uint8Array", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("x"), key);
    expect(sealed.nonce).toBeInstanceOf(Uint8Array);
    expect(sealed.ciphertext).toBeInstanceOf(Uint8Array);
    expect(Object.keys(sealed).sort()).toEqual(["ciphertext", "nonce"]);
  });

  it("appends a 16-byte Poly1305 tag (empty plaintext yields a 16-byte ciphertext)", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(new Uint8Array(0), key);
    expect(sealed.ciphertext.length).toBe(16);
    const opened = await aeadOpen(sealed, key);
    expect(opened.length).toBe(0);
  });

  it("uses a fresh random nonce: successive seals under one key differ in nonce and ciphertext", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = enc("same-message");
    const a = await aeadSeal(message, key);
    const b = await aeadSeal(message, key);
    expect(eq(a.nonce, b.nonce)).toBe(false);
    expect(eq(a.ciphertext, b.ciphertext)).toBe(false);
    // Both still open to the identical plaintext.
    expect(eq(await aeadOpen(a, key), message)).toBe(true);
    expect(eq(await aeadOpen(b, key), message)).toBe(true);
  });
});

describe("aeadSeal AAD binding", () => {
  it("defaults AAD to empty and opens with the same default", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("hello"), key);
    // Opening with an explicit empty AAD is equivalent to the default.
    expect(eq(await aeadOpen(sealed, key), enc("hello"))).toBe(true);
    expect(eq(await aeadOpen(sealed, key, new Uint8Array(0)), enc("hello"))).toBe(true);
  });

  it("opens successfully when the open AAD is identical to the seal AAD", async () => {
    const key = await randomBytes(KEY_BYTES);
    const aad = enc("ctx-A");
    const sealed = await aeadSeal(enc("hi"), key, aad);
    expect(eq(await aeadOpen(sealed, key, enc("ctx-A")), enc("hi"))).toBe(true);
  });

  it("rejects open with mismatched AAD even with the correct key", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("hello"), key, enc("ctx-A"));
    await expect(aeadOpen(sealed, key, enc("ctx-B"))).rejects.toThrow();
  });

  it("rejects open with the default (empty) AAD when sealed with a non-empty AAD", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("hello"), key, enc("ctx-A"));
    await expect(aeadOpen(sealed, key)).rejects.toThrow();
  });

  it("binds arbitrary (including non-UTF8 binary) AAD byte sequences", async () => {
    const key = await randomBytes(KEY_BYTES);
    const aad = new Uint8Array([0, 255, 1, 254, 128, 7]);
    const sealed = await aeadSeal(enc("payload"), key, aad);
    expect(
      eq(await aeadOpen(sealed, key, new Uint8Array([0, 255, 1, 254, 128, 7])), enc("payload")),
    ).toBe(true);
    // A single byte flipped in the AAD must reject.
    await expect(aeadOpen(sealed, key, new Uint8Array([0, 255, 1, 254, 128, 8]))).rejects.toThrow();
  });
});

describe("aeadOpen rejection on tampering", () => {
  const sealFor = async (): Promise<{ key: Uint8Array; sealed: SealedBytes }> => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("data-to-protect"), key);
    return { key, sealed };
  };

  it("rejects a single bit flipped in the ciphertext", async () => {
    const { key, sealed } = await sealFor();
    const ct = new Uint8Array(sealed.ciphertext);
    ct[0] = (ct[0] ?? 0) ^ 0x01;
    await expect(aeadOpen({ nonce: sealed.nonce, ciphertext: ct }, key)).rejects.toThrow();
  });

  it("rejects any byte modified in the ciphertext (last byte)", async () => {
    const { key, sealed } = await sealFor();
    const ct = new Uint8Array(sealed.ciphertext);
    const last = ct.length - 1;
    ct[last] = (ct[last] ?? 0) ^ 0xff;
    await expect(aeadOpen({ nonce: sealed.nonce, ciphertext: ct }, key)).rejects.toThrow();
  });

  it("rejects a flipped bit in the nonce", async () => {
    const { key, sealed } = await sealFor();
    const nonce = new Uint8Array(sealed.nonce);
    nonce[0] = (nonce[0] ?? 0) ^ 0x01;
    await expect(aeadOpen({ nonce, ciphertext: sealed.ciphertext }, key)).rejects.toThrow();
  });

  it("rejects truncated/shortened ciphertext", async () => {
    const { key, sealed } = await sealFor();
    const truncated = sealed.ciphertext.slice(0, sealed.ciphertext.length - 1);
    await expect(aeadOpen({ nonce: sealed.nonce, ciphertext: truncated }, key)).rejects.toThrow();
  });

  it("rejects a ciphertext shorter than the 16-byte auth tag", async () => {
    const { key, sealed } = await sealFor();
    await expect(
      aeadOpen({ nonce: sealed.nonce, ciphertext: new Uint8Array(4) }, key),
    ).rejects.toThrow();
  });

  it("rejects appended junk bytes", async () => {
    const { key, sealed } = await sealFor();
    const appended = new Uint8Array(sealed.ciphertext.length + 3);
    appended.set(sealed.ciphertext);
    appended[sealed.ciphertext.length] = 0x42;
    await expect(aeadOpen({ nonce: sealed.nonce, ciphertext: appended }, key)).rejects.toThrow();
  });
});

describe("aeadOpen rejection on wrong key", () => {
  it("rejects opening with a different random 32-byte key", async () => {
    const key = await randomBytes(KEY_BYTES);
    const wrong = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("data"), key);
    await expect(aeadOpen(sealed, wrong)).rejects.toThrow();
  });

  it("rejects opening with a single bit flipped in the correct key", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("data"), key);
    const nearly = new Uint8Array(key);
    nearly[0] = (nearly[0] ?? 0) ^ 0x01;
    await expect(aeadOpen(sealed, nearly)).rejects.toThrow();
  });

  it("rejects opening with an all-zero key when sealed under a random key", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("data"), key);
    await expect(aeadOpen(sealed, new Uint8Array(KEY_BYTES))).rejects.toThrow();
  });
});

describe("aeadSeal key-length enforcement", () => {
  const badLengths: Array<[string, number]> = [
    ["0-byte", 0],
    ["16-byte (half)", 16],
    ["31-byte (one under)", 31],
    ["33-byte (one over)", 33],
    ["64-byte (double)", 64],
  ];

  for (const [name, len] of badLengths) {
    it(`rejects a ${name} key with a '32 bytes' message`, async () => {
      await expect(aeadSeal(enc("x"), new Uint8Array(len))).rejects.toThrow(/key must be 32 bytes/);
    });
  }

  it("accepts exactly a 32-byte key", async () => {
    const sealed = await aeadSeal(enc("x"), new Uint8Array(KEY_BYTES));
    expect(sealed.ciphertext.length).toBeGreaterThan(0);
  });
});

describe("aeadOpen key-length enforcement", () => {
  it("rejects a too-short key during open with the same '32 bytes' message", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("x"), key);
    await expect(aeadOpen(sealed, new Uint8Array(16))).rejects.toThrow(/key must be 32 bytes/);
  });

  it("rejects a too-long key during open with the same '32 bytes' message", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("x"), key);
    await expect(aeadOpen(sealed, new Uint8Array(33))).rejects.toThrow(/key must be 32 bytes/);
  });

  it("rejects a 0-byte key during open", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("x"), key);
    await expect(aeadOpen(sealed, new Uint8Array(0))).rejects.toThrow(/key must be 32 bytes/);
  });
});

describe("randomBytes contract", () => {
  it("returns exactly n bytes for several sizes", async () => {
    for (const n of [1, 8, 16, 24, 32, 64, 1000]) {
      expect((await randomBytes(n)).length).toBe(n);
    }
  });

  it("returns a Uint8Array", async () => {
    expect(await randomBytes(16)).toBeInstanceOf(Uint8Array);
  });

  it("returns an empty Uint8Array for n=0", async () => {
    const z = await randomBytes(0);
    expect(z).toBeInstanceOf(Uint8Array);
    expect(z.length).toBe(0);
  });

  it("produces non-deterministic values across invocations", async () => {
    const samples = await Promise.all(Array.from({ length: 8 }, () => randomBytes(32)));
    const seen = new Set(samples.map((b) => Buffer.from(b).toString("hex")));
    // All 8 high-entropy samples should be distinct.
    expect(seen.size).toBe(8);
  });
});

describe("async function boundaries", () => {
  it("randomBytes returns a Promise", () => {
    expect(randomBytes(1)).toBeInstanceOf(Promise);
  });

  it("aeadSeal returns a Promise", async () => {
    const key = await randomBytes(KEY_BYTES);
    const p = aeadSeal(enc("x"), key);
    expect(p).toBeInstanceOf(Promise);
    await p;
  });

  it("aeadOpen returns a Promise", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(enc("x"), key);
    const p = aeadOpen(sealed, key);
    expect(p).toBeInstanceOf(Promise);
    await p;
  });
});
