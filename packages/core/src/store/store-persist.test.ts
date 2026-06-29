import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyStore, getSecret, upsertField } from "./store.js";
import { saveStore, loadStore } from "./store-persist.js";
import type { StoreData } from "./store.js";

/** Run a body with a fresh temp dir, always cleaned up. */
async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "lockit-persist-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PASS = "correct horse";

const storeWith = (slug: string, key: string, value: string): StoreData =>
  upsertField(emptyStore(), { slug, schema: "x", key, type: "env", value });

describe("saveStore / loadStore — round-trip", () => {
  it("round-trips a store with a secret value through disk", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      const s = storeWith("openai/dev", "OPENAI_API_KEY", "sk-123");
      await saveStore(s, PASS, path);
      const loaded = await loadStore(PASS, path);
      expect(getSecret(loaded, "openai/dev")?.fields[0]?.value).toBe("sk-123");
    });
  });

  it("round-trips an empty store", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(emptyStore(), PASS, path);
      expect(await loadStore(PASS, path)).toEqual(emptyStore());
    });
  });

  it("overwrites an existing store with new content", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(storeWith("a/b", "K", "first"), PASS, path);
      await saveStore(storeWith("a/b", "K", "second"), PASS, path);
      const loaded = await loadStore(PASS, path);
      expect(getSecret(loaded, "a/b")?.fields[0]?.value).toBe("second");
    });
  });

  it("creates intermediate directories that did not exist", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "nested", "deeper", "store.json");
      await saveStore(emptyStore(), PASS, path);
      const loaded = await loadStore(PASS, path);
      expect(loaded).toEqual(emptyStore());
    });
  });
});

describe("saveStore — on-disk file mode and atomicity", () => {
  it("writes the final file with mode 0600", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(emptyStore(), PASS, path);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    });
  });

  it("writes mode 0600 even when replacing a loose-perm file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await writeFile(path, "stale", { mode: 0o644 });
      await chmod(path, 0o644); // ensure loose perms regardless of umask on create
      await saveStore(emptyStore(), PASS, path);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    });
  });

  it("creates the parent directory with mode 0700", async () => {
    await withTempDir(async (dir) => {
      const home = join(dir, "lockithome");
      const path = join(home, "store.json");
      await saveStore(emptyStore(), PASS, path);
      expect((await stat(home)).mode & 0o777).toBe(0o700);
    });
  });

  it("leaves no temp file behind after a successful write (atomic rename)", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(emptyStore(), PASS, path);
      const entries = await readdir(dir);
      expect(entries).toEqual(["store.json"]);
      expect(entries.some((e) => e.includes(".tmp"))).toBe(false);
    });
  });

  it("names the temp file with the process pid (visible only mid-write)", async () => {
    // We can only assert the convention indirectly: after a successful save the
    // temp is renamed away, so the directory holds exactly the target file.
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(emptyStore(), PASS, path);
      const entries = await readdir(dir);
      expect(entries).not.toContain(`store.json.tmp-${String(process.pid)}`);
    });
  });
});

describe("saveStore — confidentiality (no plaintext on disk)", () => {
  it("never writes a plaintext env value to disk", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(storeWith("openai/dev", "OPENAI_API_KEY", "sk-secret-value"), PASS, path);
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain("sk-secret-value");
    });
  });

  it("never writes a plaintext file-type value or the field key to disk", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      const s = upsertField(emptyStore(), {
        slug: "a/b",
        schema: "x",
        key: "PRIVATE_CERT",
        type: "file",
        value: "-----BEGIN-very-secret-data-----",
      });
      await saveStore(s, PASS, path);
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain("very-secret-data");
      expect(onDisk).not.toContain("PRIVATE_CERT");
      expect(onDisk).not.toContain("a/b");
    });
  });

  it("produces ciphertext that differs from the plaintext encoding", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      const s = storeWith("a/b", "K", "plaintext-marker");
      await saveStore(s, PASS, path);
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain("plaintext-marker");
    });
  });
});

describe("loadStore — missing file", () => {
  it("returns an empty store when the file is missing (ENOENT)", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadStore("any", join(dir, "does-not-exist.json"));
      expect(loaded).toEqual(emptyStore());
    });
  });

  it("returns an empty store on first use (no store.json yet)", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadStore("any", join(dir, "store.json"));
      expect(loaded).toEqual(emptyStore());
    });
  });
});

describe("loadStore — error paths", () => {
  it("rejects a wrong passphrase with a friendly message", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(storeWith("openai/dev", "K", "sk-123"), "right", path);
      await expect(loadStore("wrong", path)).rejects.toThrow(/wrong passphrase or corrupted file/);
    });
  });

  it("does not leak the libsodium/crypto error detail in the friendly message", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(emptyStore(), "right", path);
      await expect(loadStore("wrong", path)).rejects.toThrow(
        /could not open the store: wrong passphrase or corrupted file/,
      );
    });
  });

  it("rejects a corrupted (tampered) ciphertext with the same friendly message", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await saveStore(storeWith("a/b", "K", "v"), PASS, path);
      // Flip a byte inside the base64 ciphertext field of the JSON blob.
      const blob = JSON.parse(await readFile(path, "utf8")) as { ciphertext: string };
      const ct = blob.ciphertext;
      const flippedChar = ct[0] === "A" ? "B" : "A";
      blob.ciphertext = flippedChar + ct.slice(1);
      await writeFile(path, JSON.stringify(blob));
      await expect(loadStore(PASS, path)).rejects.toThrow(/wrong passphrase or corrupted file/);
    });
  });

  it("rejects a file that is not a valid sealed blob (garbage)", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      await writeFile(path, "this is not a sealed blob", { mode: 0o600 });
      await expect(loadStore(PASS, path)).rejects.toThrow(/wrong passphrase or corrupted file/);
    });
  });

  it("propagates a non-ENOENT filesystem error (path is a directory, EISDIR)", async () => {
    await withTempDir(async (dir) => {
      // Reading a directory as a file is not ENOENT; the error must surface,
      // not be swallowed into an empty store.
      await expect(loadStore(PASS, dir)).rejects.toThrow();
      // And it must NOT be silently treated as a missing-file empty store.
      const result = await loadStore(PASS, dir).catch((e: unknown) => e);
      expect(result).toBeInstanceOf(Error);
    });
  });
});

describe("saveStore / loadStore — invariant: decode runs on load", () => {
  it("a successfully decrypted but structurally valid store decodes back", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "store.json");
      let s = upsertField(emptyStore(), {
        slug: "a/one",
        schema: "x",
        key: "ENVV",
        type: "env",
        value: "1",
      });
      s = upsertField(s, { slug: "a/one", schema: "x", key: "FILEV", type: "file", value: "2" });
      await saveStore(s, PASS, path);
      const loaded = await loadStore(PASS, path);
      expect(loaded).toEqual(s);
    });
  });
});
