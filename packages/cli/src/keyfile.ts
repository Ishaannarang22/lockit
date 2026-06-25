import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { lockitHome } from "@lockit/core";

/** Path to the machine-local store key: `$LOCKIT_HOME/key` (default ~/.lockit/key). */
export function keyPath(): string {
  return join(lockitHome(), "key");
}

/** The machine-local store key. Auto-created (32 random bytes, base64, mode 0600)
 *  on first use, so no passphrase is ever required. It is fed to the same
 *  passphrase-based seal as before — only its source changed: a local keyfile
 *  instead of a human-typed secret. */
export function loadOrCreateKey(): string {
  const path = keyPath();
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length > 0) return existing;
  } catch {
    // missing/unreadable → create below
  }
  const key = randomBytes(32).toString("base64");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  return key;
}
