import { randomBytes } from "node:crypto";
import { readKeyfile, keyPath, keychainMarker, writeKeyfileContent, parseKeyfile } from "./keyfile.js";
import { protectKeyOn } from "./storekey.js";
import {
  keychainWrap,
  keychainUnwrap,
  keychainDelete,
  keychainAvailable,
  HELPER_ID,
} from "./keychainkey.js";
import { resolveKey, type Io } from "./commands.js";

/** `lockit protect [status|on]` — the store key is protected by default (kept in the
 *  macOS keychain behind Touch ID, never a plaintext file). This command reports
 *  status and can force a legacy plaintext key to migrate now instead of on next use.
 *  Protection cannot be turned off; use `LOCKIT_PASSPHRASE` to manage your own key. */
export async function cmdProtect(io: Io): Promise<number> {
  const sub = io.argv[0] ?? "status";
  const content = readKeyfile();
  const parsed = content === undefined ? undefined : parseKeyfile(content);

  if (sub === "status") {
    if (io.env.LOCKIT_PASSPHRASE !== undefined && io.env.LOCKIT_PASSPHRASE.length > 0) {
      io.out("using LOCKIT_PASSPHRASE — you manage this key; lockit stores no keyfile\n");
    } else if (parsed?.kind === "keychain") {
      io.out("protected: store key is in the macOS keychain; Touch ID / password unlocks it\n");
    } else if (parsed === undefined) {
      io.out("no store key yet — it is created in the keychain on first use\n");
    } else {
      io.out("legacy plaintext key present; it migrates into the keychain on next use\n");
    }
    return 0;
  }

  if (sub === "off") {
    io.err(
      "lockit always protects the store key; it can't be turned off. " +
        "Set LOCKIT_PASSPHRASE if you want to manage your own key instead.\n",
    );
    return 1;
  }

  if (sub === "on") {
    if (parsed?.kind === "keychain") {
      io.out("already protected\n");
      return 0;
    }
    if (io.env.LOCKIT_PASSPHRASE !== undefined && io.env.LOCKIT_PASSPHRASE.length > 0) {
      io.err("LOCKIT_PASSPHRASE is set, so lockit stores no keyfile to protect. Unset it first.\n");
      return 1;
    }
    if (!keychainAvailable()) {
      io.err("protect requires macOS with Xcode Command Line Tools (swiftc)\n");
      return 1;
    }
    try {
      if (parsed === undefined) {
        await resolveKey(io); // first use → creates the key directly in the keychain
      } else {
        await protectKeyOn(parsed.key, {
          wrap: keychainWrap,
          unwrap: keychainUnwrap,
          del: keychainDelete,
          writeMarker: (service, account) =>
            writeKeyfileContent(keychainMarker(service, account, HELPER_ID)),
          newAccount: () => randomBytes(8).toString("hex"),
        });
      }
    } catch (e) {
      io.err(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    io.out(`protected: store key is in the keychain (${keyPath()} now holds only a marker)\n`);
    return 0;
  }

  io.err("usage: lockit protect [status|on]\n");
  return 1;
}
