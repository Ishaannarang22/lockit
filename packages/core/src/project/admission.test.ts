import { describe, it, expect } from "vitest";
import { emptyStore, upsertField } from "../store/store.js";
import type { StoreData } from "../store/store.js";
import { emptyVault, bindKey } from "./vault.js";
import { parseRef, resolveBinding, resolveVaultEnv, resolveAdmit } from "./admission.js";

function seed(): StoreData {
  let s = upsertField(emptyStore(), {
    slug: "app/db",
    schema: "app",
    key: "DATABASE_URL",
    type: "env",
    value: "pg://a",
  });
  s = upsertField(s, {
    slug: "openai/personal",
    schema: "openai",
    key: "OPENAI_API_KEY",
    type: "env",
    value: "sk-xyz",
  });
  return s;
}

describe("parseRef", () => {
  it("splits slug#field, rejects malformed", () => {
    expect(parseRef("app/db#DATABASE_URL")).toEqual({ slug: "app/db", field: "DATABASE_URL" });
    expect(() => parseRef("nofield")).toThrow();
    expect(() => parseRef("#x")).toThrow();
    expect(() => parseRef("x#")).toThrow();
  });
});

describe("resolveBinding (sandbox)", () => {
  it("resolves a bound name to its value", () => {
    const v = bindKey(emptyVault(), "DATABASE_URL", "app/db#DATABASE_URL");
    expect(resolveBinding(seed(), v, "DATABASE_URL")).toEqual({
      status: "ok",
      value: "pg://a",
      ref: "app/db#DATABASE_URL",
      type: "env",
    });
  });
  it("resolves a bound file-type field, carrying its type for materialization", () => {
    const s = upsertField(seed(), {
      slug: "gcp/sa",
      schema: "gcp",
      key: "SA_JSON",
      type: "file",
      value: "{json}",
    });
    const v = bindKey(emptyVault(), "GOOGLE_APPLICATION_CREDENTIALS", "gcp/sa#SA_JSON");
    expect(resolveBinding(s, v, "GOOGLE_APPLICATION_CREDENTIALS")).toEqual({
      status: "ok",
      value: "{json}",
      ref: "gcp/sa#SA_JSON",
      type: "file",
    });
  });
  it("reports an unbound name (no global guess)", () => {
    expect(resolveBinding(seed(), emptyVault(), "OPENAI_API_KEY")).toEqual({ status: "unbound" });
  });
  it("reports a bound name whose secret is gone as missing", () => {
    const v = bindKey(emptyVault(), "GHOST", "gone/x#GHOST");
    expect(resolveBinding(seed(), v, "GHOST")).toEqual({ status: "missing", ref: "gone/x#GHOST" });
  });
});

describe("resolveVaultEnv", () => {
  it("returns the env map for resolvable bindings and lists missing ones", () => {
    let v = bindKey(emptyVault(), "DATABASE_URL", "app/db#DATABASE_URL");
    v = bindKey(v, "GHOST", "gone/x#GHOST");
    const { env, missing } = resolveVaultEnv(seed(), v);
    expect(env).toEqual({ DATABASE_URL: "pg://a" });
    expect(missing).toEqual(["GHOST"]);
  });

  it("separates file-type bindings into `files` (contents), keyed by env-var name", () => {
    const s = upsertField(seed(), {
      slug: "gcp/sa",
      schema: "gcp",
      key: "SA_JSON",
      type: "file",
      value: "{json}",
    });
    let v = bindKey(emptyVault(), "DATABASE_URL", "app/db#DATABASE_URL");
    v = bindKey(v, "GOOGLE_APPLICATION_CREDENTIALS", "gcp/sa#SA_JSON");
    const { env, files, missing } = resolveVaultEnv(s, v);
    expect(env).toEqual({ DATABASE_URL: "pg://a" });
    expect(files).toEqual({ GOOGLE_APPLICATION_CREDENTIALS: "{json}" });
    expect(missing).toEqual([]);
  });
});

describe("resolveAdmit", () => {
  it("resolves a slug with one field", () => {
    expect(resolveAdmit(seed(), "app/db")).toEqual({
      status: "ok",
      slug: "app/db",
      field: "DATABASE_URL",
    });
  });
  it("resolves an explicit slug#field", () => {
    expect(resolveAdmit(seed(), "openai/personal#OPENAI_API_KEY")).toEqual({
      status: "ok",
      slug: "openai/personal",
      field: "OPENAI_API_KEY",
    });
  });
  it("returns none for an unknown secret", () => {
    expect(resolveAdmit(seed(), "nope/x")).toEqual({ status: "none" });
  });
  it("returns multi-field (value-free) when a slug has several fields", () => {
    let s = upsertField(seed(), {
      slug: "multi/svc",
      schema: "multi",
      key: "A",
      type: "env",
      value: "1",
    });
    s = upsertField(s, { slug: "multi/svc", schema: "multi", key: "B", type: "env", value: "2" });
    expect(resolveAdmit(s, "multi/svc")).toEqual({
      status: "multi-field",
      slug: "multi/svc",
      fields: ["A", "B"],
    });
  });
});
