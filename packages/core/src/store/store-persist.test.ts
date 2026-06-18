import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyStore, getSecret, upsertField } from "./store.js";
import { saveStore, loadStore } from "./store-persist.js";

describe("store persistence", () => {
  it("round-trips a store with a secret value through disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kv-persist-"));
    try {
      const path = join(dir, "store.json");
      const s = upsertField(emptyStore(), {
        slug: "openai/dev",
        schema: "openai",
        key: "OPENAI_API_KEY",
        type: "env",
        value: "sk-123",
      });
      await saveStore(s, "correct horse", path);
      const loaded = await loadStore("correct horse", path);
      expect(getSecret(loaded, "openai/dev")?.fields[0]?.value).toBe("sk-123");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a wrong passphrase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kv-persist-"));
    try {
      const path = join(dir, "store.json");
      const s = upsertField(emptyStore(), {
        slug: "openai/dev",
        schema: "openai",
        key: "OPENAI_API_KEY",
        type: "env",
        value: "sk-123",
      });
      await saveStore(s, "right", path);
      await expect(loadStore("wrong", path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty store when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kv-persist-"));
    try {
      const loaded = await loadStore("any", join(dir, "does-not-exist.json"));
      expect(loaded).toEqual(emptyStore());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never writes a plaintext value to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kv-persist-"));
    try {
      const path = join(dir, "store.json");
      const s = upsertField(emptyStore(), {
        slug: "openai/dev",
        schema: "openai",
        key: "OPENAI_API_KEY",
        type: "env",
        value: "sk-secret-value",
      });
      await saveStore(s, "pp", path);
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain("sk-secret-value");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
