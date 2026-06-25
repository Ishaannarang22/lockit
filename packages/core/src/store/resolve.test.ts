import { describe, it, expect } from "vitest";
import { resolveVar } from "./resolve.js";
import { upsertField, emptyStore } from "./store.js";
import type { StoreData } from "./store.js";

function withField(store: StoreData, slug: string, key: string, value: string): StoreData {
  return upsertField(store, { slug, schema: slug.split("/")[0] ?? slug, key, type: "env", value });
}

describe("resolveVar", () => {
  it("returns none when no bundle has the variable", () => {
    expect(resolveVar(emptyStore(), "FOO")).toEqual({ status: "none" });
  });
  it("returns found for a unique bare variable", () => {
    const s = withField(emptyStore(), "app/dev", "FOO", "bar");
    expect(resolveVar(s, "FOO")).toEqual({
      status: "found",
      bundle: "app/dev",
      field: { key: "FOO", type: "env", value: "bar" },
    });
  });
  it("returns ambiguous with sorted bundles when two bundles share a name", () => {
    let s = withField(emptyStore(), "b/dev", "FOO", "1");
    s = withField(s, "a/dev", "FOO", "2");
    expect(resolveVar(s, "FOO")).toEqual({ status: "ambiguous", bundles: ["a/dev", "b/dev"] });
  });
  it("resolves a bundle#KEY qualifier directly, bypassing ambiguity", () => {
    let s = withField(emptyStore(), "b/dev", "FOO", "1");
    s = withField(s, "a/dev", "FOO", "2");
    expect(resolveVar(s, "a/dev#FOO")).toEqual({
      status: "found",
      bundle: "a/dev",
      field: { key: "FOO", type: "env", value: "2" },
    });
  });
  it("returns none for a qualifier whose bundle lacks the key", () => {
    const s = withField(emptyStore(), "a/dev", "FOO", "1");
    expect(resolveVar(s, "a/dev#NOPE")).toEqual({ status: "none" });
  });
});
