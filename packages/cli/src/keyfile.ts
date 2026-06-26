import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
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
  | { kind: "keychain"; service: string; account: string; helper?: string };

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
        const base = { kind: "keychain" as const, service: j.service, account: j.account };
        return typeof j.helper === "string" ? { ...base, helper: j.helper } : base;
      }
    } catch {
      // not JSON → treat the raw bytes as a plaintext key
    }
  }
  return { kind: "plaintext", key: trimmed };
}

/** The on-disk marker written when the key is moved into the keychain. `helper`
 *  records which helper build created the item, so a later build can detect a
 *  mismatch and re-key into a fresh, current-bound item (no keychain re-trust). */
export function keychainMarker(service: string, account: string, helper?: string): string {
  return `${JSON.stringify({ v: 1, protection: KEYCHAIN_PROTECTION, service, account, helper })}\n`;
}

/** Read the keyfile if it exists. Returns its trimmed contents (a plaintext key, or
 *  a keychain marker), or undefined when there is no key yet. NEVER creates a key —
 *  the store key is bootstrapped (into the keychain) by the key resolver, so a
 *  plaintext key is never written to disk by default. */
export function readKeyfile(): string | undefined {
  try {
    const existing = readFileSync(keyPath(), "utf8").trim();
    return existing.length > 0 ? existing : undefined;
  } catch {
    return undefined;
  }
}

/** Write the keyfile contents (the keychain marker) at mode 0600. */
export function writeKeyfileContent(content: string): void {
  const path = keyPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}
