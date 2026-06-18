import { describe, it, expect } from "vitest";
import { emptyStore, upsertField } from "./store.js";
import { encodeStore, decodeStore } from "./store-codec.js";

describe("store codec", () => {
  it("round-trips a store through bytes", () => {
    const s = upsertField(emptyStore(), {
      slug: "openai/dev",
      schema: "openai",
      key: "OPENAI_API_KEY",
      type: "env",
      value: "sk-123",
    });
    expect(decodeStore(encodeStore(s))).toEqual(s);
  });

  it("rejects an unsupported version", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 2, secrets: [] }));
    expect(() => decodeStore(bytes)).toThrow(/unsupported store version: 2/);
  });

  it("rejects a malformed store (non-array secrets)", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, secrets: {} }));
    expect(() => decodeStore(bytes)).toThrow(/malformed store/);
  });

  it("rejects a structurally malformed secret", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ version: 1, secrets: [{ slug: "a/b" }] }),
    );
    expect(() => decodeStore(bytes)).toThrow(/malformed store/);
  });
});
