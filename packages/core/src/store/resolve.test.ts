import { describe, it, expect } from "vitest";
import { resolveVar, resolveRef } from "./resolve.js";
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

const withPulse = upsertField(emptyStore(), { slug: "pulse", schema: "pulse", key: "API_KEY", type: "env", value: "v" });

describe("resolveRef", () => {
  it("resolves a provider ref to its single-field secret", () => {
    expect(resolveRef(withPulse, "pulse")).toEqual({ status: "found", bundle: "pulse", field: { key: "API_KEY", type: "env", value: "v" } });
  });
  it("returns none when no secret of that provider exists", () => {
    expect(resolveRef(emptyStore(), "pulse")).toEqual({ status: "none" });
  });
  it("is ambiguous when two secrets share the provider", () => {
    const two = upsertField(upsertField(emptyStore(),
      { slug: "pulse/a", schema: "pulse", key: "API_KEY", type: "env", value: "1" }),
      { slug: "pulse/b", schema: "pulse", key: "API_KEY", type: "env", value: "2" });
    expect(resolveRef(two, "pulse")).toEqual({ status: "ambiguous", bundles: ["pulse/a", "pulse/b"] });
  });
  it("resolves an explicit provider#FIELD", () => {
    expect(resolveRef(withPulse, "pulse#API_KEY").status).toBe("found");
  });
  it("resolves an exact slug with a qualifier", () => {
    const q = upsertField(emptyStore(), { slug: "pulse/test", schema: "pulse", key: "API_KEY", type: "env", value: "t" });
    expect(resolveRef(q, "pulse/test")).toEqual({ status: "found", bundle: "pulse/test", field: { key: "API_KEY", type: "env", value: "t" } });
  });
});
