import { describe, it, expect } from "vitest";
import * as kv from "./index.js";
import {
  aeadSeal,
  aeadOpen,
  randomBytes,
  KEY_BYTES,
  NONCE_BYTES,
  deriveKey,
  DEFAULT_KDF_PARAMS,
  encodeBlob,
  decodeBlob,
  BLOB_VERSION,
  sealWithPassphrase,
  openWithPassphrase,
  wrapKey,
  unwrapKey,
  assertIdentityId,
  createShareArtifact,
  generateSharingIdentity,
  identityId,
  openShareArtifact,
  publicIdentityFromWire,
  publicIdentityToWire,
  publicSharingIdentity,
} from "./index.js";

// Exercises the public barrel (index.ts) — the sole entry point downstream
// packages import from — so an omitted or mis-wired re-export is caught.
const fast = { iterations: 2, memorySize: 8192, parallelism: 1 };
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("@lockit/crypto barrel: exported constants", () => {
  it("re-exposes stable constants", () => {
    expect(BLOB_VERSION).toBe(1);
    expect(KEY_BYTES).toBe(32);
    expect(NONCE_BYTES).toBe(24);
  });

  it("re-exports DEFAULT_KDF_PARAMS with the documented shape", () => {
    expect(DEFAULT_KDF_PARAMS).toEqual({ iterations: 3, memorySize: 65536, parallelism: 1 });
  });
});

describe("@lockit/crypto barrel: exported functions are present and callable", () => {
  const fns: Array<[string, unknown]> = [
    ["aeadSeal", aeadSeal],
    ["aeadOpen", aeadOpen],
    ["randomBytes", randomBytes],
    ["deriveKey", deriveKey],
    ["encodeBlob", encodeBlob],
    ["decodeBlob", decodeBlob],
    ["sealWithPassphrase", sealWithPassphrase],
    ["openWithPassphrase", openWithPassphrase],
    ["wrapKey", wrapKey],
    ["unwrapKey", unwrapKey],
    ["assertIdentityId", assertIdentityId],
    ["createShareArtifact", createShareArtifact],
    ["generateSharingIdentity", generateSharingIdentity],
    ["identityId", identityId],
    ["openShareArtifact", openShareArtifact],
    ["publicIdentityFromWire", publicIdentityFromWire],
    ["publicIdentityToWire", publicIdentityToWire],
    ["publicSharingIdentity", publicSharingIdentity],
  ];

  for (const [name, fn] of fns) {
    it(`re-exports ${name} as a function`, () => {
      expect(typeof fn).toBe("function");
    });
  }

  it("exposes exactly the documented public surface (no accidental extras)", () => {
    expect(Object.keys(kv).sort()).toEqual(
      [
        "BLOB_VERSION",
        "DEFAULT_KDF_PARAMS",
        "KEY_BYTES",
        "NONCE_BYTES",
        "aeadOpen",
        "aeadSeal",
        "assertIdentityId",
        "createShareArtifact",
        "decodeBlob",
        "deriveKey",
        "encodeBlob",
        "generateSharingIdentity",
        "identityId",
        "openShareArtifact",
        "openWithPassphrase",
        "publicIdentityFromWire",
        "publicIdentityToWire",
        "publicSharingIdentity",
        "randomBytes",
        "sealWithPassphrase",
        "unwrapKey",
        "wrapKey",
      ].sort(),
    );
  });
});

describe("@lockit/crypto barrel: exports are functional end-to-end", () => {
  it("re-exports a working passphrase seal/open round-trip", async () => {
    const blob = await sealWithPassphrase(enc("v"), "pw", fast);
    expect(new TextDecoder().decode(await openWithPassphrase(blob, "pw"))).toBe("v");
  });

  it("re-exports a working aead + keywrap path via the barrel", async () => {
    const dek = await randomBytes(KEY_BYTES);
    const kek = await randomBytes(KEY_BYTES);
    const wrapped = await wrapKey(dek, kek);
    expect(Buffer.from(await unwrapKey(wrapped, kek)).equals(Buffer.from(dek))).toBe(true);

    const sealed = await aeadSeal(enc("hi"), dek);
    expect(new TextDecoder().decode(await aeadOpen(sealed, dek))).toBe("hi");
  });

  it("re-exports a working deriveKey + blob round-trip via the barrel", async () => {
    const salt = await randomBytes(16);
    const key = await deriveKey("pw", salt, fast);
    expect(key.length).toBe(KEY_BYTES);
    const blob = {
      v: BLOB_VERSION,
      kdf: { algo: "argon2id" as const, salt, params: fast },
      nonce: await randomBytes(NONCE_BYTES),
      ciphertext: enc("ct"),
    };
    expect(decodeBlob(encodeBlob(blob)).kdf.algo).toBe("argon2id");
  });
});
