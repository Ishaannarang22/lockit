import { describe, it, expect } from "vitest";
import {
  emptyStore,
  upsertField,
  getSecret,
  listSecrets,
  removeSecret,
  secretEnv,
  isValidFieldKey,
} from "./store.js";
import type { StoreData, StoredSecret } from "./store.js";

describe("isValidFieldKey", () => {
  it("accepts valid env-var identifiers", () => {
    expect(isValidFieldKey("OPENAI_API_KEY")).toBe(true);
    expect(isValidFieldKey("A")).toBe(true);
    expect(isValidFieldKey("_B")).toBe(true);
    expect(isValidFieldKey("K123")).toBe(true);
    expect(isValidFieldKey("_")).toBe(true);
    expect(isValidFieldKey("lower_case")).toBe(true);
    expect(isValidFieldKey("Mixed_Case_123")).toBe(true);
  });

  it("rejects spaces", () => {
    expect(isValidFieldKey("BAD KEY")).toBe(false);
    expect(isValidFieldKey(" LEADING")).toBe(false);
    expect(isValidFieldKey("TRAILING ")).toBe(false);
  });

  it("rejects an equals sign", () => {
    expect(isValidFieldKey("K=V")).toBe(false);
  });

  it("rejects newlines", () => {
    expect(isValidFieldKey("has\nnewline")).toBe(false);
    expect(isValidFieldKey("trail\n")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidFieldKey("")).toBe(false);
  });

  it("rejects a name starting with a digit", () => {
    expect(isValidFieldKey("1leading")).toBe(false);
    expect(isValidFieldKey("9")).toBe(false);
  });

  it("rejects hyphens and dots (not valid env-var chars)", () => {
    expect(isValidFieldKey("A-B")).toBe(false);
    expect(isValidFieldKey("A.B")).toBe(false);
  });
});

describe("emptyStore", () => {
  it("returns a StoreData with version=1 and an empty secrets array", () => {
    expect(emptyStore()).toEqual({ version: 1, secrets: [] });
  });

  it("returns a fresh, independent instance each call", () => {
    const a = emptyStore();
    const b = emptyStore();
    expect(a).not.toBe(b);
    expect(a.secrets).not.toBe(b.secrets);
    a.secrets.push({ slug: "x/y", schema: "z", fields: [], aka: [], tags: [] });
    expect(b.secrets).toHaveLength(0);
  });
});

describe("upsertField — add and update", () => {
  it("adds a new secret if not present and stores the plaintext value", () => {
    const s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "OPENAI_API_KEY",
      type: "env",
      value: "sk-123",
    });
    expect(getSecret(s, "openai/dev")?.fields[0]?.value).toBe("sk-123");
    expect(getSecret(s, "openai/dev")?.schema).toBe("openai");
  });

  it("adds a new field to an existing secret", () => {
    let s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "A",
      type: "env",
      value: "1",
    });
    s = upsertField(s, {
      slug: "openai/dev",
      schema: "openai",
      key: "B",
      type: "env",
      value: "2",
    });
    expect(getSecret(s, "openai/dev")?.fields).toHaveLength(2);
    expect(getSecret(s, "openai/dev")?.fields.map((f) => f.key)).toEqual(["A", "B"]);
  });

  it("updates an existing field value in place (no duplicate)", () => {
    let s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "K",
      type: "env",
      value: "old",
    });
    s = upsertField(s, {
      slug: "openai/dev",
      schema: "openai",
      key: "K",
      type: "env",
      value: "new",
    });
    expect(getSecret(s, "openai/dev")?.fields).toHaveLength(1);
    expect(getSecret(s, "openai/dev")?.fields[0]?.value).toBe("new");
  });

  it("changes the field type and value together when updating", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v1",
    });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "K", type: "file", value: "v2" });
    const f = getSecret(s, "a/b")?.fields[0];
    expect(f?.type).toBe("file");
    expect(f?.value).toBe("v2");
  });

  it("does not change the schema of an existing secret on later upserts", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "first",
      key: "A",
      type: "env",
      value: "1",
    });
    // A later upsert names a different schema; the existing secret keeps its schema.
    s = upsertField(s, { slug: "a/b", schema: "second", key: "B", type: "env", value: "2" });
    expect(getSecret(s, "a/b")?.schema).toBe("first");
  });

  it("preserves other secrets intact when upserting one", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/one",
      schema: "x",
      key: "A",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "b/two", schema: "y", key: "B", type: "env", value: "2" });
    s = upsertField(s, { slug: "a/one", schema: "x", key: "C", type: "env", value: "3" });
    expect(getSecret(s, "b/two")?.fields).toHaveLength(1);
    expect(getSecret(s, "b/two")?.fields[0]?.value).toBe("2");
  });

  it("preserves other fields in the same secret when updating one", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "KEEP",
      type: "env",
      value: "keep-value",
    });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "CHANGE", type: "env", value: "old" });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "CHANGE", type: "env", value: "new" });
    const keep = getSecret(s, "a/b")?.fields.find((f) => f.key === "KEEP");
    expect(keep?.value).toBe("keep-value");
  });
});

describe("upsertField — validation", () => {
  it("rejects an invalid slug", () => {
    expect(() =>
      upsertField(emptyStore(), {
        slug: "Bad Slug",
        schema: "x",
        key: "K",
        type: "env",
        value: "v",
      }),
    ).toThrow(/invalid slug/);
  });

  it("rejects an empty schema", () => {
    expect(() =>
      upsertField(emptyStore(), { slug: "a/b", schema: "", key: "K", type: "env", value: "v" }),
    ).toThrow(/schema must not be empty/);
  });

  it("rejects an invalid field key for every malformed example", () => {
    for (const bad of ["BAD KEY", "K=V", "has\nnewline", "", "1leading", "A-B", "A.B"]) {
      expect(() =>
        upsertField(emptyStore(), { slug: "a/b", schema: "x", key: bad, type: "env", value: "v" }),
      ).toThrow(/invalid field key/);
    }
  });

  it("validates slug before field key (slug error wins)", () => {
    expect(() =>
      upsertField(emptyStore(), {
        slug: "Bad",
        schema: "x",
        key: "1bad",
        type: "env",
        value: "v",
      }),
    ).toThrow(/invalid slug/);
  });

  it("validates schema before field key (schema error wins over bad key)", () => {
    expect(() =>
      upsertField(emptyStore(), {
        slug: "a/b",
        schema: "",
        key: "1bad",
        type: "env",
        value: "v",
      }),
    ).toThrow(/schema must not be empty/);
  });

  it("does not enter a rejected key into the store (input store untouched)", () => {
    const start = emptyStore();
    expect(() =>
      upsertField(start, { slug: "a/b", schema: "x", key: "1bad", type: "env", value: "v" }),
    ).toThrow();
    expect(start.secrets).toHaveLength(0);
  });
});

describe("upsertField — immutability / copy-on-write isolation", () => {
  it("returns a new StoreData and does not mutate the input store", () => {
    const start = emptyStore();
    const next = upsertField(start, {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v",
    });
    expect(next).not.toBe(start);
    expect(start.secrets).toHaveLength(0);
    expect(next.secrets).toHaveLength(1);
  });

  it("does not mutate the previous store's secret records when adding a field", () => {
    const s1 = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "A",
      type: "env",
      value: "1",
    });
    const snapshot = JSON.stringify(s1);
    upsertField(s1, { slug: "a/b", schema: "x", key: "B", type: "env", value: "2" });
    expect(JSON.stringify(s1)).toBe(snapshot);
    expect(getSecret(s1, "a/b")?.fields).toHaveLength(1);
  });

  // Copy-on-write: upsertField deep-copies field objects, so updating a value in
  // the next store does not mutate the previous store's field.
  it("does not mutate the previous store's field when updating a value in the next store", () => {
    const s1 = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "old",
    });
    const s2 = upsertField(s1, { slug: "a/b", schema: "x", key: "K", type: "env", value: "new" });
    expect(getSecret(s1, "a/b")?.fields[0]?.value).toBe("old");
    expect(getSecret(s2, "a/b")?.fields[0]?.value).toBe("new");
  });

  it("copies the fields array (not shared by reference between versions)", () => {
    const s1 = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "A",
      type: "env",
      value: "1",
    });
    const s2 = upsertField(s1, { slug: "a/b", schema: "x", key: "B", type: "env", value: "2" });
    const f1 = getSecret(s1, "a/b")?.fields;
    const f2 = getSecret(s2, "a/b")?.fields;
    expect(f1).not.toBe(f2);
    expect(f1).toHaveLength(1);
    expect(f2).toHaveLength(2);
  });
});

describe("getSecret", () => {
  it("returns the StoredSecret by exact slug", () => {
    const s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "K",
      type: "env",
      value: "v",
    });
    const got = getSecret(s, "openai/dev");
    expect(got?.slug).toBe("openai/dev");
    expect(got?.fields[0]?.value).toBe("v");
  });

  it("returns undefined when the slug is not found", () => {
    expect(getSecret(emptyStore(), "missing/one")).toBeUndefined();
  });

  it("does not match by prefix or substring", () => {
    const s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "K",
      type: "env",
      value: "v",
    });
    expect(getSecret(s, "openai")).toBeUndefined();
    expect(getSecret(s, "openai/de")).toBeUndefined();
    expect(getSecret(s, "openai/dev/")).toBeUndefined();
  });

  it("does not mutate the store", () => {
    const s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v",
    });
    const snapshot = JSON.stringify(s);
    getSecret(s, "a/b");
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("listSecrets — value-free projection", () => {
  it("returns an empty array for an empty store", () => {
    expect(listSecrets(emptyStore())).toEqual([]);
  });

  it("projects fields to key/type/hasValue and never the value", () => {
    const s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "OPENAI_API_KEY",
      type: "env",
      value: "sk-123",
    });
    const listed = listSecrets(s);
    expect(listed[0]?.fields[0]).toEqual({
      key: "OPENAI_API_KEY",
      type: "env",
      hasValue: true,
    });
    expect(JSON.stringify(listed)).not.toContain("sk-123");
  });

  it("sets hasValue=true for a non-empty value and false for an empty value", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "FILLED",
      type: "env",
      value: "x",
    });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "EMPTY", type: "env", value: "" });
    const fields = listSecrets(s)[0]?.fields ?? [];
    const filled = fields.find((f) => f.key === "FILLED");
    const empty = fields.find((f) => f.key === "EMPTY");
    expect(filled?.hasValue).toBe(true);
    expect(empty?.hasValue).toBe(false);
  });

  it("carries slug, schema, aka, tags, and value-free versions", () => {
    const s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "K",
      type: "env",
      value: "v",
    });
    const listed = listSecrets(s)[0];
    expect(listed?.slug).toBe("openai/dev");
    expect(listed?.schema).toBe("openai");
    expect(listed?.aka).toEqual([]);
    expect(listed?.tags).toEqual([]);
    expect(listed?.versions).toEqual([]);
  });

  it("preserves field type in the projection (file vs env)", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "E",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "F", type: "file", value: "2" });
    const fields = listSecrets(s)[0]?.fields ?? [];
    expect(fields.find((f) => f.key === "E")?.type).toBe("env");
    expect(fields.find((f) => f.key === "F")?.type).toBe("file");
  });

  it("lists every secret in the store", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/one",
      schema: "x",
      key: "A",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "b/two", schema: "y", key: "B", type: "env", value: "2" });
    const slugs = listSecrets(s).map((x) => x.slug);
    expect(slugs).toEqual(["a/one", "b/two"]);
  });

  it("never exposes a file-field value either", () => {
    const s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "CERT",
      type: "file",
      value: "-----BEGIN-PRIVATE-secret-data-----",
    });
    expect(JSON.stringify(listSecrets(s))).not.toContain("secret-data");
  });

  // The mapped `fields` array IS fresh, so pushing to it is safe.
  it("returns a fresh fields array (pushing to the listed fields does not affect the store)", () => {
    const s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v",
    });
    const listed = listSecrets(s);
    listed[0]?.fields.push({ key: "INJECTED", type: "env", hasValue: false });
    expect(getSecret(s, "a/b")?.fields).toHaveLength(1);
  });

  // listSecrets copies each secret's aka/tags, so mutating the listed result does
  // not affect the store.
  it("returns fresh aka/tags arrays (mutating the listed result does not affect the store)", () => {
    const s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v",
    });
    const snapshot = JSON.stringify(s);
    const listed = listSecrets(s);
    listed[0]?.tags.push("mutated");
    listed[0]?.aka.push("alias");
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("secretEnv — env-only injection map", () => {
  it("maps env fields to a key=>value record", () => {
    let s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "A",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "openai/dev", schema: "openai", key: "B", type: "env", value: "2" });
    const sec = getSecret(s, "openai/dev");
    expect(sec).toBeDefined();
    expect(secretEnv(sec as StoredSecret)).toEqual({ A: "1", B: "2" });
  });

  it("excludes file-type fields", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "ENVV",
      type: "env",
      value: "env-val",
    });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "FILEV", type: "file", value: "file-val" });
    const env = secretEnv(getSecret(s, "a/b") as StoredSecret);
    expect(env).toEqual({ ENVV: "env-val" });
    expect(env).not.toHaveProperty("FILEV");
  });

  it("returns an empty record for a secret with only file fields", () => {
    const s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "FILEV",
      type: "file",
      value: "file-val",
    });
    expect(secretEnv(getSecret(s, "a/b") as StoredSecret)).toEqual({});
  });

  it("returns an empty record for a secret with no fields at all", () => {
    const sec: StoredSecret = { slug: "a/b", schema: "x", fields: [], aka: [], tags: [] };
    expect(secretEnv(sec)).toEqual({});
  });

  it("preserves env values exactly, including empty strings", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "FULL",
      type: "env",
      value: "exact value with spaces",
    });
    s = upsertField(s, { slug: "a/b", schema: "x", key: "EMPTY", type: "env", value: "" });
    expect(secretEnv(getSecret(s, "a/b") as StoredSecret)).toEqual({
      FULL: "exact value with spaces",
      EMPTY: "",
    });
  });
});

describe("removeSecret", () => {
  it("removes a secret by exact slug match", () => {
    let s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "K",
      type: "env",
      value: "v",
    });
    s = removeSecret(s, "openai/dev");
    expect(getSecret(s, "openai/dev")).toBeUndefined();
  });

  it("returns a new StoreData and does not mutate the input store", () => {
    const start = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v",
    });
    const next = removeSecret(start, "a/b");
    expect(next).not.toBe(start);
    expect(getSecret(start, "a/b")).toBeDefined();
    expect(getSecret(next, "a/b")).toBeUndefined();
  });

  it("preserves all other secrets intact", () => {
    let s = upsertField(emptyStore(), {
      slug: "a/one",
      schema: "x",
      key: "A",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "b/two", schema: "y", key: "B", type: "env", value: "2" });
    s = removeSecret(s, "a/one");
    expect(getSecret(s, "a/one")).toBeUndefined();
    expect(getSecret(s, "b/two")?.fields[0]?.value).toBe("2");
  });

  it("is idempotent: removing a missing slug is a no-op (no error)", () => {
    const start = upsertField(emptyStore(), {
      slug: "a/b",
      schema: "x",
      key: "K",
      type: "env",
      value: "v",
    });
    const next = removeSecret(start, "does/not-exist");
    expect(next.secrets).toHaveLength(1);
    expect(getSecret(next, "a/b")).toBeDefined();
  });

  it("removing from an empty store yields an empty store", () => {
    expect(removeSecret(emptyStore(), "a/b")).toEqual(emptyStore());
  });

  it("always stamps version 1 on the result", () => {
    const result: StoreData = removeSecret(emptyStore(), "x/y");
    expect(result.version).toBe(1);
  });
});
