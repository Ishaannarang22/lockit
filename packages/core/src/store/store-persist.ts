import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { sealWithPassphrase, openWithPassphrase } from "@kv/crypto";
import { emptyStore, type StoreData } from "./store.js";
import { encodeStore, decodeStore } from "./store-codec.js";

// MVP seals the whole store under the passphrase; the DEK-indirection envelope (ADR-0009) lands with the P4 keychain cache.

/** Seal the store to a passphrase-encrypted blob on disk (parents created, mode 0600). */
export async function saveStore(store: StoreData, passphrase: string, path: string): Promise<void> {
  const blob = await sealWithPassphrase(encodeStore(store), passphrase);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, blob, { mode: 0o600 });
}

/** Load and decrypt the store; a missing file yields a fresh empty store. */
export async function loadStore(passphrase: string, path: string): Promise<StoreData> {
  let blob: string;
  try {
    blob = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
  return decodeStore(await openWithPassphrase(blob, passphrase));
}
