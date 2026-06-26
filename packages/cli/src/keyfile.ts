import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { lockitHome } from "@lockit/core";

/** Path to the machine-local store key: `$LOCKIT_HOME/key` (default ~/.lockit/key). */
export function keyPath(): string {
  return join(lockitHome(), "key");
}

/** A parsed keyfile: either a plaintext key sitting on disk, or a marker that
 *  says "the real key lives in the macOS keychain under this service/account". */
export type ParsedKeyfile =
  | { kind: "plaintext"; key: string }
  | { kind: "keychain"; service: string; account: string };

const KEYCHAIN_PROTECTION = "keychain";

/** Classify keyfile contents. A keychain-protected keyfile is a small JSON marker;
 *  anything else is treated as a plaintext key (base64 never starts with `{`, and a
 *  malformed marker falls back to plaintext so a real key is never lost). */
export function parseKeyfile(content: string): ParsedKeyfile {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        j.protection === KEYCHAIN_PROTECTION &&
        typeof j.service === "string" &&
        typeof j.account === "string"
      ) {
        return { kind: "keychain", service: j.service, account: j.account };
      }
    } catch {
      // not JSON → treat the raw bytes as a plaintext key
    }
  }
  return { kind: "plaintext", key: trimmed };
}

/** The on-disk marker written when the key is moved into the keychain. */
export function keychainMarker(service: string, account: string): string {
  return `${JSON.stringify({ v: 1, protection: KEYCHAIN_PROTECTION, service, account })}\n`;
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
