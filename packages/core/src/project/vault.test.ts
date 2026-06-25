import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyVault,
  bindKey,
  unbindKey,
  vaultRef,
  findProjectRoot,
  vaultPath,
  readVault,
  writeVault,
  initProject,
} from "./vault.js";

describe("vault (pure)", () => {
  it("binds, reads back, and unbinds env-var -> ref without values", () => {
    let v = emptyVault();
    v = bindKey(v, "DATABASE_URL", "app/db#DATABASE_URL");
    v = bindKey(v, "OPENAI_API_KEY", "openai/personal#OPENAI_API_KEY");
    expect(vaultRef(v, "DATABASE_URL")).toBe("app/db#DATABASE_URL");
    expect(vaultRef(v, "MISSING")).toBeUndefined();

    const u = unbindKey(v, "DATABASE_URL");
    expect(vaultRef(u, "DATABASE_URL")).toBeUndefined();
    expect(vaultRef(u, "OPENAI_API_KEY")).toBe("openai/personal#OPENAI_API_KEY");
    // immutability: original untouched
    expect(vaultRef(v, "DATABASE_URL")).toBe("app/db#DATABASE_URL");
  });
});

describe("vault (filesystem)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lockit-proj-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("initProject creates .lockit/vault.json and is idempotent", () => {
    initProject(root);
    expect(readVault(root).bindings).toEqual({});
    // write a binding, re-init must not clobber it
    writeVault(root, bindKey(emptyVault(), "K", "s/dev#K"));
    initProject(root);
    expect(vaultRef(readVault(root), "K")).toBe("s/dev#K");
  });

  it("writeVault then readVault round-trips, value-free JSON on disk", () => {
    writeVault(root, bindKey(emptyVault(), "API_KEY", "app/dev#API_KEY"));
    expect(vaultRef(readVault(root), "API_KEY")).toBe("app/dev#API_KEY");
    const onDisk = readFileSync(vaultPath(root), "utf8");
    expect(onDisk).toContain("API_KEY");
    expect(onDisk).toContain("app/dev#API_KEY");
    expect(onDisk).not.toMatch(/secret|value/i);
  });

  it("readVault returns an empty vault when none exists", () => {
    expect(readVault(root)).toEqual({ version: 1, bindings: {} });
  });

  it("findProjectRoot finds the nearest ancestor with .lockit/", () => {
    initProject(root);
    const nested = join(root, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(root);
  });

  it("findProjectRoot returns undefined when no .lockit/ ancestor exists", () => {
    const nested = join(root, "x", "y");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBeUndefined();
  });
});
