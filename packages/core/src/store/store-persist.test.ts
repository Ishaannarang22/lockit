import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("writes mode 0600 even when replacing a loose-perm file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kv-persist-"));
    try {
      const path = join(dir, "store.json");
      await writeFile(path, "stale", { mode: 0o644 });
      await saveStore(emptyStore(), "pw", path);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces a friendly error on a wrong passphrase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kv-persist-"));
    try {
      const path = join(dir, "store.json");
      await saveStore(emptyStore(), "right", path);
      await expect(loadStore("wrong", path)).rejects.toThrow(/wrong passphrase|corrupted/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
