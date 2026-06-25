import { open, mkdir, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { sealWithPassphrase, openWithPassphrase } from "@lockit/crypto";
import { emptyStore, type StoreData } from "./store.js";
import { encodeStore, decodeStore } from "./store-codec.js";

// MVP seals the whole store under the passphrase; the DEK-indirection envelope (ADR-0009) lands with the P4 keychain cache.

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Seal the store and write it atomically: a fresh 0600 temp file, fsync'd, then
 *  renamed over the target. A crash mid-write can never truncate or corrupt the
 *  only copy of all secrets, and the result is always mode 0600 (even if an old
 *  file had looser perms). */
export async function saveStore(store: StoreData, passphrase: string, path: string): Promise<void> {
  const blob = await sealWithPassphrase(encodeStore(store), passphrase);
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = `${path}.tmp-${String(process.pid)}`;
  const handle = await open(tmp, "w", FILE_MODE);
  try {
    await handle.writeFile(blob);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

/** Load and decrypt the store; a missing file yields a fresh empty store. A
 *  decryption failure surfaces as a clear message rather than a raw libsodium one. */
export async function loadStore(passphrase: string, path: string): Promise<StoreData> {
  let blob: string;
  try {
    blob = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
  let bytes: Uint8Array;
  try {
    bytes = await openWithPassphrase(blob, passphrase);
  } catch {
    throw new Error("could not open the store: wrong passphrase or corrupted file");
  }
  return decodeStore(bytes);
}
