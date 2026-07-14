import { describe, it, expect } from "vitest";
import {
  builtinRegistry,
  mergeRegistries,
  entryFor,
  providerForEnv,
} from "./registry.js";

describe("builtinRegistry", () => {
  it("contains openai, supabase, pulse entries", () => {
    const providers = builtinRegistry.map((e) => e.provider);
    expect(providers).toContain("openai");
    expect(providers).toContain("supabase");
    expect(providers).toContain("pulse");
  });

  it("openai entry has correct shape", () => {
    const entry = entryFor(builtinRegistry, "openai");
    expect(entry).toBeDefined();
    expect(entry!.fields).toEqual(["OPENAI_API_KEY"]);
    expect(entry!.env).toEqual({ OPENAI_API_KEY: ["OPENAI_API_KEY"] });
    expect(entry!.match).toEqual(["OPENAI_API_KEY"]);
  });

  it("supabase entry has correct shape", () => {
    const entry = entryFor(builtinRegistry, "supabase");
    expect(entry).toBeDefined();
    expect(entry!.fields).toEqual([
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(entry!.env).toEqual({
      SUPABASE_URL: ["SUPABASE_URL"],
      SUPABASE_ANON_KEY: ["SUPABASE_ANON_KEY"],
      SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SERVICE_ROLE_KEY"],
    });
    expect(entry!.match).toEqual([
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("pulse entry has correct shape", () => {
    const entry = entryFor(builtinRegistry, "pulse");
    expect(entry).toBeDefined();
    expect(entry!.fields).toEqual(["API_KEY"]);
    expect(entry!.env).toEqual({ API_KEY: ["PULSE_API_KEY"] });
    expect(entry!.match).toContain("PULSE_API_KEY");
    expect(entry!.match).toContain("PULSE_KEY");
  });
});

describe("providerForEnv", () => {
  it("maps PULSE_API_KEY -> pulse", () => {
    expect(providerForEnv(builtinRegistry, "PULSE_API_KEY")).toBe("pulse");
  });

  it("maps OPENAI_API_KEY -> openai", () => {
    expect(providerForEnv(builtinRegistry, "OPENAI_API_KEY")).toBe("openai");
  });

  it("returns undefined for unknown env var", () => {
    expect(providerForEnv(builtinRegistry, "WHATEVER_TOKEN")).toBeUndefined();
  });

  it("maps PULSE_KEY -> pulse", () => {
    expect(providerForEnv(builtinRegistry, "PULSE_KEY")).toBe("pulse");
  });

  it("maps SUPABASE_ANON_KEY -> supabase", () => {
    expect(providerForEnv(builtinRegistry, "SUPABASE_ANON_KEY")).toBe("supabase");
  });
});

describe("mergeRegistries", () => {
  it("later list overrides earlier entry by provider", () => {
    const custom = [
      {
        provider: "pulse",
        fields: ["KEY"],
        env: { KEY: ["PULSE_API_KEY"] },
        match: ["X"],
      },
    ];
    const merged = mergeRegistries(builtinRegistry, custom);
    const entry = entryFor(merged, "pulse");
    expect(entry).toBeDefined();
    expect(entry!.fields).toEqual(["KEY"]);
    expect(providerForEnv(merged, "X")).toBe("pulse");
  });

  it("builtin providers not in override remain intact", () => {
    const custom = [
      {
        provider: "myprovider",
        fields: ["TOKEN"],
        env: { TOKEN: ["MY_TOKEN"] },
        match: ["MY_TOKEN"],
      },
    ];
    const merged = mergeRegistries(builtinRegistry, custom);
    // openai still present
    expect(entryFor(merged, "openai")).toBeDefined();
    // new provider added
    expect(entryFor(merged, "myprovider")).toBeDefined();
    expect(providerForEnv(merged, "MY_TOKEN")).toBe("myprovider");
  });

  it("returns empty array when called with no args", () => {
    expect(mergeRegistries()).toEqual([]);
  });

  it("merging with empty list preserves builtins", () => {
    const merged = mergeRegistries(builtinRegistry, []);
    expect(merged.length).toBe(builtinRegistry.length);
  });
});

describe("entryFor", () => {
  it("returns undefined for unknown provider", () => {
    expect(entryFor(builtinRegistry, "nonexistent")).toBeUndefined();
  });
});
