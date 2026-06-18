import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { kvHome, storePath } from "./paths.js";

const prev = process.env.KV_HOME;

afterEach(() => {
  if (prev === undefined) delete process.env.KV_HOME;
  else process.env.KV_HOME = prev;
});

describe("paths", () => {
  it("honors KV_HOME for the store path", () => {
    process.env.KV_HOME = "/tmp/kv-test-home";
    expect(kvHome()).toBe("/tmp/kv-test-home");
    expect(storePath()).toBe(join("/tmp/kv-test-home", "store.json"));
  });
});
