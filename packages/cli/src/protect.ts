import { randomBytes } from "node:crypto";
import { writeFileSync, chmodSync } from "node:fs";
import { loadOrCreateKey, keyPath, keychainMarker, parseKeyfile } from "./keyfile.js";
import { protectKeyOn, protectKeyOff } from "./storekey.js";
import { keychainWrap, keychainUnwrap, keychainDelete } from "./keychainkey.js";
import type { Io } from "./commands.js";

function writeKeyfile(content: string): void {
  const path = keyPath();
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** `lockit protect [on|off|status]` — move the store key between a plaintext file
 *  and the macOS keychain (Touch ID / account-password gated). Default sub: status. */
export async function cmdProtect(io: Io): Promise<number> {
  const sub = io.argv[0] ?? "status";
  const parsed = parseKeyfile(loadOrCreateKey());

  if (sub === "status") {
    io.out(
      parsed.kind === "keychain"
        ? "protected: store key is in the macOS keychain; lockit asks for Touch ID / password to use it\n"
        : `unprotected: store key is a plaintext file at ${keyPath()}\n`,
    );
    return 0;
  }

  if (sub === "on") {
    if (parsed.kind === "keychain") {
      io.out("already protected\n");
      return 0;
    }
    if (process.platform !== "darwin") {
      io.err("lockit protect requires macOS (Touch ID / keychain)\n");
      return 1;
    }
    if (io.env.LOCKIT_PASSPHRASE !== undefined && io.env.LOCKIT_PASSPHRASE.length > 0) {
      io.err("LOCKIT_PASSPHRASE is set, so the keyfile is not used as the key. Unset it first.\n");
      return 1;
    }
    try {
      await protectKeyOn(parsed.key, {
        wrap: keychainWrap,
        unwrap: keychainUnwrap,
        del: keychainDelete,
        writeMarker: (service, account) => writeKeyfile(keychainMarker(service, account)),
        newAccount: () => randomBytes(8).toString("hex"),
      });
    } catch (e) {
      io.err(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    io.out("protected: store key moved into the keychain. lockit now needs Touch ID to use it.\n");
    return 0;
  }

  if (sub === "off") {
    if (parsed.kind !== "keychain") {
      io.out("already unprotected\n");
      return 0;
    }
    try {
      await protectKeyOff(parsed.service, parsed.account, {
        unwrap: keychainUnwrap,
        del: keychainDelete,
        writePlaintext: (key) => writeKeyfile(`${key}\n`),
      });
    } catch (e) {
      io.err(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    io.out("unprotected: store key written back to the plaintext keyfile.\n");
    return 0;
  }

  io.err("usage: lockit protect [on|off|status]\n");
  return 1;
}
