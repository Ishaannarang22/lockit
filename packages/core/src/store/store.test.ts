import { describe, it, expect } from "vitest";
import {
  emptyStore,
  upsertField,
  getSecret,
  listSecrets,
  removeSecret,
  secretEnv,
} from "./store.js";

describe("global store", () => {
  it("upserts a secret + field; the value lives in the store record", () => {
    let s = emptyStore();
    s = upsertField(s, {
      slug: "openai/dev",
      schema: "openai",
      key: "OPENAI_API_KEY",
      type: "env",
      value: "sk-123",
    });
    expect(getSecret(s, "openai/dev")?.fields[0]?.value).toBe("sk-123");
  });

  it("updates an existing field value in place (no duplicate)", () => {
    let s = emptyStore();
    s = upsertField(s, { slug: "openai/dev", schema: "openai", key: "K", type: "env", value: "old" });
    s = upsertField(s, { slug: "openai/dev", schema: "openai", key: "K", type: "env", value: "new" });
    expect(getSecret(s, "openai/dev")?.fields).toHaveLength(1);
    expect(getSecret(s, "openai/dev")?.fields[0]?.value).toBe("new");
  });

  it("listSecrets is value-free (hasValue, never the value)", () => {
    let s = emptyStore();
    s = upsertField(s, {
      slug: "openai/dev",
      schema: "openai",
      key: "OPENAI_API_KEY",
      type: "env",
      value: "sk-123",
    });
    const listed = listSecrets(s);
    expect(listed[0]?.fields[0]).toEqual({ key: "OPENAI_API_KEY", type: "env", hasValue: true });
    expect(JSON.stringify(listed)).not.toContain("sk-123");
  });

  it("secretEnv maps env fields to an env record", () => {
    let s = emptyStore();
    s = upsertField(s, { slug: "openai/dev", schema: "openai", key: "A", type: "env", value: "1" });
    s = upsertField(s, { slug: "openai/dev", schema: "openai", key: "B", type: "env", value: "2" });
    expect(secretEnv(getSecret(s, "openai/dev")!)).toEqual({ A: "1", B: "2" });
  });

  it("rejects an invalid slug", () => {
    expect(() =>
      upsertField(emptyStore(), { slug: "Bad Slug", schema: "x", key: "K", type: "env", value: "v" }),
    ).toThrow(/invalid slug/);
  });

  it("removes a secret", () => {
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
});
