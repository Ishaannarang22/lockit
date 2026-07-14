import { describe, it, expect, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { lockitHome, storePath } from "./paths.js";

const prev = process.env.LOCKIT_HOME;

afterEach(() => {
  if (prev === undefined) delete process.env.LOCKIT_HOME;
  else process.env.LOCKIT_HOME = prev;
});

describe("lockitHome", () => {
  it("returns $LOCKIT_HOME when set", () => {
    process.env.LOCKIT_HOME = "/tmp/lockit-test-home";
    expect(lockitHome()).toBe("/tmp/lockit-test-home");
  });

  it("returns ~/.lockit when $LOCKIT_HOME is not set", () => {
    delete process.env.LOCKIT_HOME;
    expect(lockitHome()).toBe(join(homedir(), ".lockit"));
  });

  it("treats an empty $LOCKIT_HOME as a set (defined) value per `??` semantics", () => {
    // Document the actual behavior of `??`: an empty string is defined, so it is
    // returned verbatim rather than falling back to ~/.lockit.
    process.env.LOCKIT_HOME = "";
    expect(lockitHome()).toBe("");
  });

  it("honors an absolute override path verbatim", () => {
    process.env.LOCKIT_HOME = "/opt/secrets/lockit";
    expect(lockitHome()).toBe("/opt/secrets/lockit");
  });
});

describe("storePath", () => {
  it("joins store.json onto $LOCKIT_HOME when set", () => {
    process.env.LOCKIT_HOME = "/tmp/lockit-test-home";
    expect(storePath()).toBe(join("/tmp/lockit-test-home", "store.json"));
  });

  it("is ~/.lockit/store.json when $LOCKIT_HOME is not set", () => {
    delete process.env.LOCKIT_HOME;
    expect(storePath()).toBe(join(homedir(), ".lockit", "store.json"));
  });

  it("always equals join(lockitHome(), 'store.json')", () => {
    process.env.LOCKIT_HOME = "/var/data/lockithome";
    expect(storePath()).toBe(join(lockitHome(), "store.json"));
  });

  it("re-reads the environment on each call (override is dynamic)", () => {
    process.env.LOCKIT_HOME = "/first";
    expect(storePath()).toBe(join("/first", "store.json"));
    process.env.LOCKIT_HOME = "/second";
    expect(storePath()).toBe(join("/second", "store.json"));
  });
});
