import { describe, it, expect } from "vitest";
import { encodeBlob, decodeBlob, BLOB_VERSION, type SealedBlob } from "./blob.js";
import { DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";

const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

const sample: SealedBlob = {
  v: BLOB_VERSION,
  kdf: { algo: "argon2id", salt: new Uint8Array(16).fill(1), params: DEFAULT_KDF_PARAMS },
  nonce: new Uint8Array(24).fill(2),
  ciphertext: new Uint8Array([9, 8, 7, 6]),
};

// The serialized wire shape (base64 byte fields) that decodeBlob accepts.
interface Wire {
  v: number;
  kdf: { algo: string; salt: string; params: KdfParams };
  nonce: string;
  ciphertext: string;
}
const wireOf = (blob: SealedBlob): Wire => JSON.parse(encodeBlob(blob)) as Wire;

describe("BLOB_VERSION constant", () => {
  it("equals 1", () => {
    expect(BLOB_VERSION).toBe(1);
  });
});

describe("encodeBlob serialization", () => {
  it("produces valid, parseable JSON text", () => {
    expect(() => JSON.parse(encodeBlob(sample))).not.toThrow();
  });

  it("includes the version field (v) as a number literal", () => {
    expect(wireOf(sample).v).toBe(BLOB_VERSION);
  });

  it("includes a kdf object with algo='argon2id'", () => {
    expect(wireOf(sample).kdf.algo).toBe("argon2id");
  });

  it("serializes KdfParams unchanged inside the kdf object", () => {
    expect(wireOf(sample).kdf.params).toEqual(DEFAULT_KDF_PARAMS);
  });

  it("encodes salt, nonce, and ciphertext as base64 strings", () => {
    const wire = wireOf(sample);
    expect(typeof wire.kdf.salt).toBe("string");
    expect(typeof wire.nonce).toBe("string");
    expect(typeof wire.ciphertext).toBe("string");
  });

  it("encodes base64 that decodes back to the original bytes", () => {
    const wire = wireOf(sample);
    expect(eq(new Uint8Array(Buffer.from(wire.kdf.salt, "base64")), sample.kdf.salt)).toBe(true);
    expect(eq(new Uint8Array(Buffer.from(wire.nonce, "base64")), sample.nonce)).toBe(true);
    expect(eq(new Uint8Array(Buffer.from(wire.ciphertext, "base64")), sample.ciphertext)).toBe(
      true,
    );
  });
});

describe("decodeBlob parsing and round-trip", () => {
  it("decodes a valid envelope to a SealedBlob with the right field types", () => {
    const decoded = decodeBlob(encodeBlob(sample));
    expect(decoded.v).toBe(BLOB_VERSION);
    expect(decoded.kdf.algo).toBe("argon2id");
    expect(decoded.kdf.salt).toBeInstanceOf(Uint8Array);
    expect(decoded.nonce).toBeInstanceOf(Uint8Array);
    expect(decoded.ciphertext).toBeInstanceOf(Uint8Array);
  });

  it("round-trips every field byte-for-byte through encode/decode", () => {
    const decoded = decodeBlob(encodeBlob(sample));
    expect(eq(decoded.kdf.salt, sample.kdf.salt)).toBe(true);
    expect(eq(decoded.nonce, sample.nonce)).toBe(true);
    expect(eq(decoded.ciphertext, sample.ciphertext)).toBe(true);
    expect(decoded.kdf.params).toEqual(sample.kdf.params);
  });

  it("preserves custom (non-default) KdfParams exactly", () => {
    const custom: SealedBlob = {
      ...sample,
      kdf: {
        algo: "argon2id",
        salt: new Uint8Array(8).fill(5),
        params: { iterations: 4, memorySize: 16384, parallelism: 2 },
      },
    };
    const decoded = decodeBlob(encodeBlob(custom));
    expect(decoded.kdf.params).toEqual({ iterations: 4, memorySize: 16384, parallelism: 2 });
  });
});

describe("decodeBlob version check", () => {
  const badVersions = [0, 2, 999, -1];
  for (const v of badVersions) {
    it(`rejects version ${v} with an 'unsupported...version' message`, () => {
      expect(() => decodeBlob(JSON.stringify({ ...wireOf(sample), v }))).toThrow(
        /unsupported.*version/i,
      );
    });
  }

  it("accepts exactly BLOB_VERSION (1)", () => {
    expect(() => decodeBlob(JSON.stringify({ ...wireOf(sample), v: 1 }))).not.toThrow();
  });
});

describe("decodeBlob KDF algo check", () => {
  const badAlgos = ["scrypt", "pbkdf2", "bcrypt", ""];
  for (const algo of badAlgos) {
    it(`rejects kdf algo '${algo || "<empty>"}' with an 'unsupported kdf algo' message`, () => {
      const wire = { ...wireOf(sample), kdf: { ...wireOf(sample).kdf, algo } };
      expect(() => decodeBlob(JSON.stringify(wire))).toThrow(/unsupported kdf algo/i);
    });
  }

  it("rejects a blob with a missing kdf object", () => {
    expect(() =>
      decodeBlob(JSON.stringify({ v: BLOB_VERSION, nonce: "AA", ciphertext: "AA" })),
    ).toThrow(/unsupported kdf algo/i);
  });

  it("accepts the supported 'argon2id' algo", () => {
    expect(() => decodeBlob(encodeBlob(sample))).not.toThrow();
  });
});

describe("decodeBlob malformed-input handling", () => {
  it("rejects non-JSON input", () => {
    expect(() => decodeBlob("not json at all")).toThrow();
  });

  it("rejects incomplete JSON", () => {
    expect(() => decodeBlob("{not json")).toThrow();
  });

  it("rejects an empty string (JSON.parse syntax error)", () => {
    expect(() => decodeBlob("")).toThrow();
  });

  it("rejects the literal null (no fields to read)", () => {
    // JSON.parse("null") succeeds, then reading `.v` off null must throw.
    expect(() => decodeBlob("null")).toThrow();
  });
});
