import { describe, it, expect } from "vitest";
import { sealWithPassphrase, openWithPassphrase } from "./vault-seal.js";
import { decodeBlob, encodeBlob, BLOB_VERSION } from "./blob.js";
import { type KdfParams } from "./kdf.js";

// The repo's "fast" KDF convention for unit tests: weak but in-bounds.
const fast: KdfParams = { iterations: 2, memorySize: 8192, parallelism: 1 };
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe("sealWithPassphrase basic flow", () => {
  it("returns a JSON blob string deserializable by decodeBlob", async () => {
    const blobText = await sealWithPassphrase(enc("payload"), "pw", fast);
    expect(typeof blobText).toBe("string");
    expect(() => JSON.parse(blobText)).not.toThrow();
    const blob = decodeBlob(blobText);
    expect(blob.v).toBe(BLOB_VERSION);
    expect(blob.kdf.algo).toBe("argon2id");
  });

  it("returns a Promise", () => {
    expect(sealWithPassphrase(enc("x"), "pw", fast)).toBeInstanceOf(Promise);
  });

  it("uses the default 16-byte salt length", async () => {
    const blob = decodeBlob(await sealWithPassphrase(enc("x"), "pw", fast));
    expect(blob.kdf.salt.length).toBe(16);
  });
});

describe("sealWithPassphrase / openWithPassphrase round-trip", () => {
  it("round-trips secret bytes with the correct passphrase", async () => {
    const secret = enc("OPENAI_API_KEY=sk-xyz");
    const blobText = await sealWithPassphrase(secret, "hunter2", fast);
    const opened = await openWithPassphrase(blobText, "hunter2");
    expect(dec(opened)).toBe("OPENAI_API_KEY=sk-xyz");
  });

  it("openWithPassphrase returns a Promise", async () => {
    const blobText = await sealWithPassphrase(enc("x"), "pw", fast);
    expect(openWithPassphrase(blobText, "pw")).toBeInstanceOf(Promise);
  });

  const cases: Array<[string, Uint8Array]> = [
    ["empty", new Uint8Array(0)],
    ["non-utf8 binary", new Uint8Array([0, 255, 1, 254, 128])],
    ["multi-byte unicode", enc("emoji 🔐 中文")],
    ["1 MiB pattern", Uint8Array.from({ length: 1 << 20 }, (_, i) => i & 0xff)],
  ];

  for (const [name, input] of cases) {
    it(`is byte-exact for ${name}`, async () => {
      const blob = await sealWithPassphrase(input, "pw", fast);
      const opened = await openWithPassphrase(blob, "pw");
      // Buffer.equals (not TextDecoder) so invalid-UTF8 bytes are compared exactly.
      expect(eq(opened, input)).toBe(true);
    });
  }
});

describe("sealWithPassphrase salt and nonce freshness", () => {
  it("uses a fresh random salt and nonce each call (no reuse, ciphertexts differ)", async () => {
    const msg = enc("same");
    const a = decodeBlob(await sealWithPassphrase(msg, "pw", fast));
    const b = decodeBlob(await sealWithPassphrase(msg, "pw", fast));
    expect(eq(a.kdf.salt, b.kdf.salt)).toBe(false);
    expect(eq(a.nonce, b.nonce)).toBe(false);
    expect(eq(a.ciphertext, b.ciphertext)).toBe(false);
  });

  it("never reuses a nonce across many seals under the same passphrase", async () => {
    const blobs = await Promise.all(
      Array.from({ length: 6 }, () => sealWithPassphrase(enc("m"), "pw", fast)),
    );
    const nonces = blobs.map((b) => Buffer.from(decodeBlob(b).nonce).toString("hex"));
    expect(new Set(nonces).size).toBe(6);
  });
});

describe("sealWithPassphrase KDF params persistence", () => {
  it("persists the fast params in the blob so it can be opened later", async () => {
    const blob = decodeBlob(await sealWithPassphrase(enc("x"), "pw", fast));
    expect(blob.kdf.params).toEqual(fast);
  });

  it("persists custom (non-default) params and opens correctly using them", async () => {
    const custom: KdfParams = { iterations: 3, memorySize: 16384, parallelism: 2 };
    const blobText = await sealWithPassphrase(enc("custom-secret"), "pw", custom);
    expect(decodeBlob(blobText).kdf.params).toEqual(custom);
    expect(dec(await openWithPassphrase(blobText, "pw"))).toBe("custom-secret");
  });

  it("seals under the interactive defaults when no params are passed", async () => {
    // Uses DEFAULT_KDF_PARAMS (64 MiB Argon2id) — heavier but still bounded.
    const blobText = await sealWithPassphrase(enc("default-secret"), "pw");
    expect(decodeBlob(blobText).kdf.params).toEqual({
      iterations: 3,
      memorySize: 65536,
      parallelism: 1,
    });
    expect(dec(await openWithPassphrase(blobText, "pw"))).toBe("default-secret");
  });
});

describe("openWithPassphrase rejection", () => {
  it("fails to open with a completely different passphrase", async () => {
    const blobText = await sealWithPassphrase(enc("x"), "right", fast);
    await expect(openWithPassphrase(blobText, "wrong")).rejects.toThrow();
  });

  it("fails with an off-by-one-character passphrase", async () => {
    const blobText = await sealWithPassphrase(enc("x"), "hunter2", fast);
    await expect(openWithPassphrase(blobText, "hunter3")).rejects.toThrow();
  });

  it("fails with an empty-string passphrase when sealed with a non-empty one", async () => {
    const blobText = await sealWithPassphrase(enc("x"), "non-empty", fast);
    await expect(openWithPassphrase(blobText, "")).rejects.toThrow();
  });
});

describe("on-disk envelope tamper detection", () => {
  const seal = (): Promise<string> => sealWithPassphrase(enc("secret"), "pw", fast);

  it("rejects a tampered kdf salt (re-derives a different key)", async () => {
    const blob = decodeBlob(await seal());
    blob.kdf.salt[0] = (blob.kdf.salt[0] ?? 0) ^ 0x01;
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a tampered iterations param (re-derives a different key)", async () => {
    const blob = decodeBlob(await seal());
    blob.kdf.params = { ...blob.kdf.params, iterations: blob.kdf.params.iterations + 1 };
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a tampered memorySize param (re-derives a different key)", async () => {
    const blob = decodeBlob(await seal());
    blob.kdf.params = { ...blob.kdf.params, memorySize: blob.kdf.params.memorySize * 2 };
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a tampered parallelism param (re-derives a different key)", async () => {
    const blob = decodeBlob(await seal());
    blob.kdf.params = { ...blob.kdf.params, parallelism: blob.kdf.params.parallelism + 1 };
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a tampered nonce (nonce is bound to the AEAD auth tag)", async () => {
    const blob = decodeBlob(await seal());
    blob.nonce[0] = (blob.nonce[0] ?? 0) ^ 0x01;
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a single bit flipped in the ciphertext", async () => {
    const blob = decodeBlob(await seal());
    blob.ciphertext[0] = (blob.ciphertext[0] ?? 0) ^ 0x01;
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a truncated ciphertext", async () => {
    const blob = decodeBlob(await seal());
    blob.ciphertext = blob.ciphertext.slice(0, blob.ciphertext.length - 1);
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects appended bytes on the ciphertext", async () => {
    const blob = decodeBlob(await seal());
    const grown = new Uint8Array(blob.ciphertext.length + 2);
    grown.set(blob.ciphertext);
    blob.ciphertext = grown;
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });
});

describe("openWithPassphrase header validation", () => {
  it("rejects a blob whose header advertises out-of-range KDF params", async () => {
    // A hostile header forcing 17 iterations must be rejected by deriveKey's bounds
    // check, not silently honored.
    const blob = decodeBlob(await sealWithPassphrase(enc("x"), "pw", fast));
    blob.kdf.params = { ...blob.kdf.params, iterations: 17 };
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow(
      /iterations out of range/,
    );
  });

  it("rejects an unsupported blob version before deriving a key", async () => {
    const wire = JSON.parse(await sealWithPassphrase(enc("x"), "pw", fast)) as { v: number };
    wire.v = 2;
    await expect(openWithPassphrase(JSON.stringify(wire), "pw")).rejects.toThrow(
      /unsupported.*version/i,
    );
  });
});
