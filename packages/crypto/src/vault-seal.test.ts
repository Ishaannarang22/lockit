import { describe, it, expect } from "vitest";
import { sealWithPassphrase, openWithPassphrase } from "./vault-seal.js";
import { decodeBlob, encodeBlob } from "./blob.js";

const fast = { iterations: 2, memorySize: 8192, parallelism: 1 };

describe("sealWithPassphrase / openWithPassphrase", () => {
  it("round-trips secret bytes with the correct passphrase", async () => {
    const secret = new TextEncoder().encode("OPENAI_API_KEY=sk-xyz");
    const blobText = await sealWithPassphrase(secret, "hunter2", fast);
    const opened = await openWithPassphrase(blobText, "hunter2");
    expect(new TextDecoder().decode(opened)).toBe("OPENAI_API_KEY=sk-xyz");
  });

  it("fails to open with the wrong passphrase", async () => {
    const blobText = await sealWithPassphrase(new TextEncoder().encode("x"), "right", fast);
    await expect(openWithPassphrase(blobText, "wrong")).rejects.toThrow();
  });

  it("uses a fresh random salt and nonce each time (no plaintext, no reuse)", async () => {
    const msg = new TextEncoder().encode("same");
    const a = decodeBlob(await sealWithPassphrase(msg, "pw", fast));
    const b = decodeBlob(await sealWithPassphrase(msg, "pw", fast));
    expect(Buffer.from(a.kdf.salt).equals(Buffer.from(b.kdf.salt))).toBe(false);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("persists the kdf params in the blob so it can be opened later", async () => {
    const blob = decodeBlob(await sealWithPassphrase(new TextEncoder().encode("x"), "pw", fast));
    expect(blob.kdf.params).toEqual(fast);
  });
});

describe("on-disk envelope tamper detection", () => {
  const seal = () => sealWithPassphrase(new TextEncoder().encode("secret"), "pw", fast);

  it("rejects a tampered kdf salt", async () => {
    const blob = decodeBlob(await seal());
    blob.kdf.salt[0] = (blob.kdf.salt[0] ?? 0) ^ 0x01;
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects tampered kdf params (re-derives a different key)", async () => {
    const blob = decodeBlob(await seal());
    blob.kdf.params = { ...blob.kdf.params, iterations: blob.kdf.params.iterations + 1 };
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });

  it("rejects a tampered nonce", async () => {
    const blob = decodeBlob(await seal());
    blob.nonce[0] = (blob.nonce[0] ?? 0) ^ 0x01;
    await expect(openWithPassphrase(encodeBlob(blob), "pw")).rejects.toThrow();
  });
});

describe("sealWithPassphrase round-trips arbitrary byte payloads", () => {
  const cases: Array<[string, Uint8Array]> = [
    ["empty", new Uint8Array(0)],
    ["non-utf8 binary", new Uint8Array([0, 255, 1, 254, 128])],
    ["multi-byte unicode", new TextEncoder().encode("emoji 🔐 中文")],
    ["1 MiB pattern", Uint8Array.from({ length: 1 << 20 }, (_, i) => i & 0xff)],
  ];

  for (const [name, input] of cases) {
    it(`is byte-exact for ${name}`, async () => {
      const blob = await sealWithPassphrase(input, "pw", fast);
      const opened = await openWithPassphrase(blob, "pw");
      // Buffer.equals (not TextDecoder) so invalid-UTF8 bytes are compared exactly.
      expect(Buffer.from(opened).equals(Buffer.from(input))).toBe(true);
    });
  }
});
