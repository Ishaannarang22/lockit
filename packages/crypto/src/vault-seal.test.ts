import { describe, it, expect } from "vitest";
import { sealWithPassphrase, openWithPassphrase } from "./vault-seal.js";
import { decodeBlob } from "./blob.js";

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
