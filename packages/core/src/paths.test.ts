import { describe, it, expect, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { kvHome, storePath } from "./paths.js";

const prev = process.env.KV_HOME;

afterEach(() => {
  if (prev === undefined) delete process.env.KV_HOME;
  else process.env.KV_HOME = prev;
});

describe("kvHome", () => {
  it("returns $KV_HOME when set", () => {
    process.env.KV_HOME = "/tmp/kv-test-home";
    expect(kvHome()).toBe("/tmp/kv-test-home");
  });

  it("returns ~/.kv when $KV_HOME is not set", () => {
    delete process.env.KV_HOME;
    expect(kvHome()).toBe(join(homedir(), ".kv"));
  });

  it("treats an empty $KV_HOME as a set (defined) value per `??` semantics", () => {
    // Document the actual behavior of `??`: an empty string is defined, so it is
    // returned verbatim rather than falling back to ~/.kv.
    process.env.KV_HOME = "";
    expect(kvHome()).toBe("");
  });

  it("honors an absolute override path verbatim", () => {
    process.env.KV_HOME = "/opt/secrets/kv";
    expect(kvHome()).toBe("/opt/secrets/kv");
  });
});

describe("storePath", () => {
  it("joins store.json onto $KV_HOME when set", () => {
    process.env.KV_HOME = "/tmp/kv-test-home";
    expect(storePath()).toBe(join("/tmp/kv-test-home", "store.json"));
  });

  it("is ~/.kv/store.json when $KV_HOME is not set", () => {
    delete process.env.KV_HOME;
    expect(storePath()).toBe(join(homedir(), ".kv", "store.json"));
  });

  it("always equals join(kvHome(), 'store.json')", () => {
    process.env.KV_HOME = "/var/data/kvhome";
    expect(storePath()).toBe(join(kvHome(), "store.json"));
  });

  it("re-reads the environment on each call (override is dynamic)", () => {
    process.env.KV_HOME = "/first";
    expect(storePath()).toBe(join("/first", "store.json"));
    process.env.KV_HOME = "/second";
    expect(storePath()).toBe(join("/second", "store.json"));
  });
});
