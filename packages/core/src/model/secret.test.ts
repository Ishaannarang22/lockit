import { describe, it, expect } from "vitest";
import { createSecret, isValidSlug } from "./secret.js";
import type { Field, SecretInput } from "./secret.js";

describe("isValidSlug", () => {
  it("accepts simple slash-segmented lowercase slugs", () => {
    expect(isValidSlug("openai/dev")).toBe(true);
    expect(isValidSlug("a/b/c")).toBe(true);
    expect(isValidSlug("supabase/acme")).toBe(true);
  });

  it("accepts a single bare segment with no slash", () => {
    expect(isValidSlug("openai")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("0")).toBe(true);
  });

  it("accepts multiple slash levels", () => {
    expect(isValidSlug("a/b/c/d/e")).toBe(true);
  });

  it("accepts dot, underscore, and hyphen within a segment", () => {
    expect(isValidSlug("a.b")).toBe(true);
    expect(isValidSlug("a_b")).toBe(true);
    expect(isValidSlug("a-b")).toBe(true);
    expect(isValidSlug("foo.bar_baz-qux/seg.2_3-4")).toBe(true);
  });

  it("accepts a segment starting with a digit", () => {
    expect(isValidSlug("9live/0day")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidSlug("Bad")).toBe(false);
    expect(isValidSlug("openai/Dev")).toBe(false);
    expect(isValidSlug("OPENAI")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidSlug("has space")).toBe(false);
    expect(isValidSlug("a/b c")).toBe(false);
    expect(isValidSlug(" leading-space")).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(isValidSlug("/leading")).toBe(false);
  });

  it("rejects a trailing slash", () => {
    expect(isValidSlug("trailing/")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidSlug("")).toBe(false);
  });

  it("rejects consecutive slashes (empty segment)", () => {
    expect(isValidSlug("a//b")).toBe(false);
  });

  it("rejects a segment that starts with a non-alphanumeric character", () => {
    expect(isValidSlug(".a")).toBe(false);
    expect(isValidSlug("_a")).toBe(false);
    expect(isValidSlug("-a")).toBe(false);
    expect(isValidSlug("a/.b")).toBe(false);
    expect(isValidSlug("a/-b")).toBe(false);
    expect(isValidSlug("a/_b")).toBe(false);
  });

  it("rejects disallowed punctuation and symbols", () => {
    expect(isValidSlug("a!b")).toBe(false);
    expect(isValidSlug("a:b")).toBe(false);
    expect(isValidSlug("a@b")).toBe(false);
    expect(isValidSlug("a\\b")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
  });

  it("rejects a newline embedded in an otherwise-valid slug", () => {
    expect(isValidSlug("a/b\n")).toBe(false);
    expect(isValidSlug("a\nb")).toBe(false);
  });
});

describe("createSecret", () => {
  it("creates a value-free Secret with a valid slug and schema", () => {
    const s = createSecret({ slug: "supabase/acme", schema: "supabase" });
    expect(s.slug).toBe("supabase/acme");
    expect(s.schema).toBe("supabase");
  });

  it("sets defaults: aka=[], versions=[], tags=[], fields=[] when omitted", () => {
    const s = createSecret({ slug: "openai/dev", schema: "openai" });
    expect(s.aka).toEqual([]);
    expect(s.versions).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.fields).toEqual([]);
  });

  it("uses provided fields, aka, and tags", () => {
    const fields: Field[] = [{ key: "OPENAI_API_KEY", type: "env", hasValue: true }];
    const s = createSecret({
      slug: "openai/dev",
      schema: "openai",
      fields,
      aka: ["legacy/openai"],
      tags: ["prod", "ai"],
    });
    expect(s.fields).toEqual(fields);
    expect(s.aka).toEqual(["legacy/openai"]);
    expect(s.tags).toEqual(["prod", "ai"]);
  });

  it("preserves field order", () => {
    const fields: Field[] = [
      { key: "B", type: "env", hasValue: true },
      { key: "A", type: "file", hasValue: false },
      { key: "C", type: "env", hasValue: true },
    ];
    const s = createSecret({ slug: "a/b", schema: "x", fields });
    expect(s.fields.map((f) => f.key)).toEqual(["B", "A", "C"]);
  });

  it("carries the value-free field shape (key, type, hasValue only)", () => {
    const s = createSecret({
      slug: "a/b",
      schema: "x",
      fields: [{ key: "K", type: "file", hasValue: false }],
    });
    expect(s.fields[0]).toEqual({ key: "K", type: "file", hasValue: false });
  });

  it("rejects an invalid slug with a descriptive message", () => {
    expect(() => createSecret({ slug: "Bad Slug!", schema: "x" })).toThrow(/invalid slug/);
  });

  it("includes the offending slug (JSON-quoted) in the error", () => {
    expect(() => createSecret({ slug: "Bad", schema: "x" })).toThrow(/invalid slug: "Bad"/);
  });

  it("rejects an empty schema", () => {
    expect(() => createSecret({ slug: "openai/dev", schema: "" })).toThrow(
      /schema must not be empty/,
    );
  });

  it("rejects duplicate field keys", () => {
    expect(() =>
      createSecret({
        slug: "openai/dev",
        schema: "openai",
        fields: [
          { key: "OPENAI_API_KEY", type: "env", hasValue: true },
          { key: "OPENAI_API_KEY", type: "env", hasValue: false },
        ],
      }),
    ).toThrow(/duplicate field key: OPENAI_API_KEY/);
  });

  it("allows distinct field keys", () => {
    const s = createSecret({
      slug: "a/b",
      schema: "x",
      fields: [
        { key: "A", type: "env", hasValue: true },
        { key: "B", type: "env", hasValue: true },
      ],
    });
    expect(s.fields).toHaveLength(2);
  });

  it("does not mutate the input object", () => {
    const input: SecretInput = {
      slug: "a/b",
      schema: "x",
      fields: [{ key: "A", type: "env", hasValue: true }],
    };
    const before = JSON.stringify(input);
    createSecret(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("checks the slug before the schema (slug error wins)", () => {
    expect(() => createSecret({ slug: "Bad", schema: "" })).toThrow(/invalid slug/);
  });

  it("checks duplicate keys only after slug and schema pass", () => {
    expect(() =>
      createSecret({
        slug: "Bad",
        schema: "x",
        fields: [
          { key: "A", type: "env", hasValue: true },
          { key: "A", type: "env", hasValue: true },
        ],
      }),
    ).toThrow(/invalid slug/);
  });
});
