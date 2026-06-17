import { describe, it, expect } from "vitest";
import {
  sealWithPassphrase,
  openWithPassphrase,
  BLOB_VERSION,
  KEY_BYTES,
  NONCE_BYTES,
} from "./index.js";

// Exercises the public barrel (index.ts) — the sole entry point downstream
// packages import from — so an omitted or mis-wired re-export is caught.
describe("@kv/crypto barrel", () => {
  it("re-exposes stable constants", () => {
    expect(BLOB_VERSION).toBe(1);
    expect(KEY_BYTES).toBe(32);
    expect(NONCE_BYTES).toBe(24);
  });

  it("re-exports a working seal/open round-trip", async () => {
    const fast = { iterations: 2, memorySize: 8192, parallelism: 1 };
    const blob = await sealWithPassphrase(new TextEncoder().encode("v"), "pw", fast);
    expect(new TextDecoder().decode(await openWithPassphrase(blob, "pw"))).toBe("v");
  });
});
