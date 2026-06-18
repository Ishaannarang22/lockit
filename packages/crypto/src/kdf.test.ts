import { describe, it, expect } from "vitest";
import { deriveKey, DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";

// A 16-byte salt (>= the 8-byte minimum) reused across deterministic checks.
const salt = new Uint8Array(16).fill(7);
// The repo's "fast" KDF convention for unit tests: weak but in-bounds.
const fast: KdfParams = { iterations: 2, memorySize: 8192, parallelism: 1 };
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe("DEFAULT_KDF_PARAMS", () => {
  it("uses iterations: 3", () => {
    expect(DEFAULT_KDF_PARAMS.iterations).toBe(3);
  });

  it("uses memorySize: 65536 (64 MiB)", () => {
    expect(DEFAULT_KDF_PARAMS.memorySize).toBe(65536);
  });

  it("uses parallelism: 1", () => {
    expect(DEFAULT_KDF_PARAMS.parallelism).toBe(1);
  });

  it("matches the KdfParams shape with only the three required integer fields", () => {
    expect(Object.keys(DEFAULT_KDF_PARAMS).sort()).toEqual([
      "iterations",
      "memorySize",
      "parallelism",
    ]);
    for (const v of Object.values(DEFAULT_KDF_PARAMS)) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("deriveKey Argon2id output", () => {
  it("returns exactly 32 bytes as a Uint8Array", async () => {
    const key = await deriveKey("correct horse battery staple", salt, fast);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("returns a Promise", () => {
    expect(deriveKey("pw", salt, fast)).toBeInstanceOf(Promise);
  });
});

describe("deriveKey determinism", () => {
  it("derives the same key for identical passphrase + salt + params", async () => {
    const a = await deriveKey("pw", salt, fast);
    const b = await deriveKey("pw", salt, fast);
    expect(eq(a, b)).toBe(true);
  });

  it("derives a different key for a different passphrase", async () => {
    const a = await deriveKey("pw1", salt, fast);
    const b = await deriveKey("pw2", salt, fast);
    expect(eq(a, b)).toBe(false);
  });

  it("derives a different key for a different salt", async () => {
    const other = new Uint8Array(16).fill(9);
    const a = await deriveKey("pw", salt, fast);
    const b = await deriveKey("pw", other, fast);
    expect(eq(a, b)).toBe(false);
  });

  it("derives a different key for a different iterations count", async () => {
    const a = await deriveKey("pw", salt, { ...fast, iterations: 2 });
    const b = await deriveKey("pw", salt, { ...fast, iterations: 3 });
    expect(eq(a, b)).toBe(false);
  });

  it("derives a different key for a different memorySize", async () => {
    const a = await deriveKey("pw", salt, { ...fast, memorySize: 8192 });
    const b = await deriveKey("pw", salt, { ...fast, memorySize: 16384 });
    expect(eq(a, b)).toBe(false);
  });

  it("derives a different key for a different parallelism", async () => {
    const a = await deriveKey("pw", salt, { ...fast, parallelism: 1 });
    const b = await deriveKey("pw", salt, { ...fast, parallelism: 2 });
    expect(eq(a, b)).toBe(false);
  });
});

describe("deriveKey salt minimum enforcement", () => {
  const tooShort: Array<[string, number]> = [
    ["0-byte", 0],
    ["4-byte", 4],
    ["7-byte (one under)", 7],
  ];

  for (const [name, len] of tooShort) {
    it(`rejects a ${name} salt mentioning the minimum`, async () => {
      await expect(deriveKey("pw", new Uint8Array(len), fast)).rejects.toThrow(
        /salt must be at least 8 bytes/,
      );
    });
  }

  it("accepts an exactly 8-byte salt", async () => {
    const key = await deriveKey("pw", new Uint8Array(8).fill(1), fast);
    expect(key.length).toBe(32);
  });

  it("accepts a salt longer than 8 bytes", async () => {
    const key = await deriveKey("pw", new Uint8Array(32).fill(1), fast);
    expect(key.length).toBe(32);
  });
});

describe("deriveKey param bounds: iterations", () => {
  const bad: Array<[string, number]> = [
    ["zero", 0],
    ["negative", -1],
    ["non-integer 3.5", 3.5],
    ["17 (one over max)", 17],
    ["1000", 1000],
  ];

  for (const [name, iterations] of bad) {
    it(`rejects iterations=${name} with an 'iterations out of range' message`, async () => {
      await expect(deriveKey("pw", salt, { ...fast, iterations })).rejects.toThrow(
        /iterations out of range/,
      );
    });
  }

  it("accepts iterations at the lower bound (1)", async () => {
    const key = await deriveKey("pw", salt, { ...fast, iterations: 1 });
    expect(key.length).toBe(32);
  });

  it("accepts iterations at the upper bound (16)", async () => {
    const key = await deriveKey("pw", salt, { ...fast, iterations: 16 });
    expect(key.length).toBe(32);
  });
});

describe("deriveKey param bounds: memorySize", () => {
  const bad: Array<[string, number]> = [
    ["zero", 0],
    ["negative", -1],
    ["non-integer 65536.5", 65536.5],
    ["8191 (one under 8 MiB floor)", 8191],
    ["4096 (4 MiB)", 4096],
    ["1048577 (one over 1 GiB ceiling)", 1048577],
    ["2097152 (2 GiB)", 2097152],
  ];

  for (const [name, memorySize] of bad) {
    it(`rejects memorySize=${name} with a 'memorySize out of range' message`, async () => {
      await expect(deriveKey("pw", salt, { ...fast, memorySize })).rejects.toThrow(
        /memorySize out of range/,
      );
    });
  }

  it("rejects an absurd memorySize before allocating (no RangeError)", async () => {
    // 4 GiB (4194304 KiB) would crash an unchecked allocator; the bounds check must
    // reject it with the domain error, never a RangeError out of the allocator.
    await expect(deriveKey("pw", salt, { ...fast, memorySize: 4194304 })).rejects.toThrow(
      /memorySize out of range/,
    );
  });

  it("accepts memorySize at the lower bound (8192 / 8 MiB)", async () => {
    const key = await deriveKey("pw", salt, { ...fast, memorySize: 8192 });
    expect(key.length).toBe(32);
  });
});

describe("deriveKey param bounds: parallelism", () => {
  const bad: Array<[string, number]> = [
    ["zero", 0],
    ["negative", -1],
    ["non-integer 2.5", 2.5],
    ["5 (one over max)", 5],
    ["100", 100],
  ];

  for (const [name, parallelism] of bad) {
    it(`rejects parallelism=${name} with a 'parallelism out of range' message`, async () => {
      await expect(deriveKey("pw", salt, { ...fast, parallelism })).rejects.toThrow(
        /parallelism out of range/,
      );
    });
  }

  it("accepts parallelism at the lower bound (1)", async () => {
    const key = await deriveKey("pw", salt, { ...fast, parallelism: 1 });
    expect(key.length).toBe(32);
  });

  it("accepts parallelism at the upper bound (4)", async () => {
    const key = await deriveKey("pw", salt, { ...fast, parallelism: 4 });
    expect(key.length).toBe(32);
  });
});

// Type-shape assertion so later tasks rely on a stable params contract.
const _params: KdfParams = { iterations: 3, memorySize: 65536, parallelism: 1 };
void _params;
