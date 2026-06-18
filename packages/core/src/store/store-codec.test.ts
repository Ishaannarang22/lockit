import { describe, it, expect } from "vitest";
import { emptyStore, upsertField } from "./store.js";
import { encodeStore, decodeStore } from "./store-codec.js";
import type { StoreData } from "./store.js";

const enc = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

const sampleStore = (): StoreData =>
  upsertField(emptyStore(), {
    slug: "openai/dev",
    schema: "openai",
    key: "OPENAI_API_KEY",
    type: "env",
    value: "sk-123",
  });

describe("encodeStore", () => {
  it("serializes StoreData to a Uint8Array of UTF-8 JSON bytes", () => {
    const bytes = encodeStore(sampleStore());
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(bytes);
    expect(JSON.parse(text)).toEqual(sampleStore());
  });

  it("includes all secrets, fields, and values in the bytes", () => {
    const text = new TextDecoder().decode(encodeStore(sampleStore()));
    expect(text).toContain("openai/dev");
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).toContain("sk-123");
  });

  it("is deterministic: same input produces identical bytes", () => {
    const a = encodeStore(sampleStore());
    const b = encodeStore(sampleStore());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("encodes an empty store", () => {
    const text = new TextDecoder().decode(encodeStore(emptyStore()));
    expect(JSON.parse(text)).toEqual({ version: 1, secrets: [] });
  });
});

describe("decodeStore — round-trip", () => {
  it("round-trips a store through bytes", () => {
    const s = sampleStore();
    expect(decodeStore(encodeStore(s))).toEqual(s);
  });

  it("round-trips an empty store", () => {
    expect(decodeStore(encodeStore(emptyStore()))).toEqual(emptyStore());
  });

  it("round-trips a store with multiple secrets and field types", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/one",
      schema: "x",
      key: "ENVV",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "a/one", schema: "x", key: "FILEV", type: "file", value: "2" });
    s = upsertField(s, { slug: "b/two", schema: "y", key: "K", type: "env", value: "3" });
    expect(decodeStore(encodeStore(s))).toEqual(s);
  });
});

describe("decodeStore — version guard", () => {
  it("rejects an unsupported version with a descriptive message", () => {
    expect(() => decodeStore(enc({ version: 2, secrets: [] }))).toThrow(
      /unsupported store version: 2/,
    );
  });

  it("rejects a future version 99", () => {
    expect(() => decodeStore(enc({ version: 99, secrets: [] }))).toThrow(
      /unsupported store version: 99/,
    );
  });

  it("rejects a missing version field", () => {
    expect(() => decodeStore(enc({ secrets: [] }))).toThrow(/unsupported store version/);
  });

  it("rejects a version of the wrong type (string '1')", () => {
    expect(() => decodeStore(enc({ version: "1", secrets: [] }))).toThrow(
      /unsupported store version/,
    );
  });

  it("rejects a null version", () => {
    expect(() => decodeStore(enc({ version: null, secrets: [] }))).toThrow(
      /unsupported store version/,
    );
  });
});

describe("decodeStore — structural guard", () => {
  it("rejects secrets that is not an array (object)", () => {
    expect(() => decodeStore(enc({ version: 1, secrets: {} }))).toThrow(/malformed store/);
  });

  it("rejects secrets that is not an array (string)", () => {
    expect(() => decodeStore(enc({ version: 1, secrets: "nope" }))).toThrow(/malformed store/);
  });

  it("rejects a secret missing its slug", () => {
    expect(() =>
      decodeStore(enc({ version: 1, secrets: [{ schema: "x", aka: [], tags: [], fields: [] }] })),
    ).toThrow(/malformed store/);
  });

  it("rejects a secret missing its schema", () => {
    expect(() =>
      decodeStore(enc({ version: 1, secrets: [{ slug: "a/b", aka: [], tags: [], fields: [] }] })),
    ).toThrow(/malformed store/);
  });

  it("rejects a secret missing its aka array", () => {
    expect(() =>
      decodeStore(
        enc({ version: 1, secrets: [{ slug: "a/b", schema: "x", tags: [], fields: [] }] }),
      ),
    ).toThrow(/malformed store/);
  });

  it("rejects a secret missing its tags array", () => {
    expect(() =>
      decodeStore(
        enc({ version: 1, secrets: [{ slug: "a/b", schema: "x", aka: [], fields: [] }] }),
      ),
    ).toThrow(/malformed store/);
  });

  it("rejects a secret missing its fields array", () => {
    expect(() =>
      decodeStore(enc({ version: 1, secrets: [{ slug: "a/b", schema: "x", aka: [], tags: [] }] })),
    ).toThrow(/malformed store/);
  });

  it("rejects a secret whose slug is the wrong type", () => {
    expect(() =>
      decodeStore(
        enc({ version: 1, secrets: [{ slug: 42, schema: "x", aka: [], tags: [], fields: [] }] }),
      ),
    ).toThrow(/malformed store/);
  });

  it("rejects a secret whose aka is not an array", () => {
    expect(() =>
      decodeStore(
        enc({
          version: 1,
          secrets: [{ slug: "a/b", schema: "x", aka: "no", tags: [], fields: [] }],
        }),
      ),
    ).toThrow(/malformed store/);
  });

  it("rejects a null entry in the secrets array", () => {
    expect(() => decodeStore(enc({ version: 1, secrets: [null] }))).toThrow(/malformed store/);
  });

  it("rejects a non-object entry in the secrets array", () => {
    expect(() => decodeStore(enc({ version: 1, secrets: ["a/b"] }))).toThrow(/malformed store/);
  });
});

describe("decodeStore — field-object guard", () => {
  const withField = (field: unknown): Uint8Array =>
    enc({
      version: 1,
      secrets: [{ slug: "a/b", schema: "x", aka: [], tags: [], fields: [field] }],
    });

  it("rejects a field missing its key", () => {
    expect(() => decodeStore(withField({ value: "v", type: "env" }))).toThrow(/malformed store/);
  });

  it("rejects a field missing its value", () => {
    expect(() => decodeStore(withField({ key: "K", type: "env" }))).toThrow(/malformed store/);
  });

  it("rejects a field whose key is the wrong type", () => {
    expect(() => decodeStore(withField({ key: 1, value: "v", type: "env" }))).toThrow(
      /malformed store/,
    );
  });

  it("rejects a field whose value is the wrong type", () => {
    expect(() => decodeStore(withField({ key: "K", value: 1, type: "env" }))).toThrow(
      /malformed store/,
    );
  });

  it("rejects a null field entry", () => {
    expect(() => decodeStore(withField(null))).toThrow(/malformed store/);
  });

  it("accepts a structurally valid field (key + value strings)", () => {
    const store = decodeStore(withField({ key: "K", value: "v", type: "env" }));
    expect(store.secrets[0]?.fields[0]?.key).toBe("K");
  });
});

describe("decodeStore — parse errors", () => {
  it("throws on bytes that are not valid JSON", () => {
    expect(() => decodeStore(new TextEncoder().encode("{not json"))).toThrow();
  });
});
