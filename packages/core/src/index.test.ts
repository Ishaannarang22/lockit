import { describe, it, expect } from "vitest";
import { createSecret, isValidSlug } from "./index.js";

describe("createSecret", () => {
  it("creates a value-free secret with defaults", () => {
    const s = createSecret({
      slug: "supabase/acme",
      schema: "supabase",
      fields: [{ key: "SUPABASE_URL", type: "env", hasValue: true }],
    });
    expect(s.slug).toBe("supabase/acme");
    expect(s.aka).toEqual([]);
    expect(s.versions).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.fields[0]?.hasValue).toBe(true);
  });

  it("rejects an invalid slug", () => {
    expect(() => createSecret({ slug: "Bad Slug!", schema: "x" })).toThrow(/invalid slug/);
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
    ).toThrow(/duplicate field key/);
  });

  it("rejects an empty schema", () => {
    expect(() => createSecret({ slug: "openai/dev", schema: "" })).toThrow(/schema/);
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase slash-segmented slugs, rejects others", () => {
    expect(isValidSlug("openai/dev")).toBe(true);
    expect(isValidSlug("a/b/c")).toBe(true);
    expect(isValidSlug("supabase/acme")).toBe(true);
    expect(isValidSlug("Bad")).toBe(false);
    expect(isValidSlug("/leading")).toBe(false);
    expect(isValidSlug("trailing/")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("has space")).toBe(false);
  });
});
