import { readKeyfile, parseKeyfile } from "./keyfile.js";
import { keychainDelete } from "./keychainkey.js";
import { sessionAccount } from "./session.js";
import type { Io } from "./commands.js";

/** `lockit lock` — clear the unlock session so the next command re-prompts for Touch ID. */
export async function cmdLock(io: Io): Promise<number> {
  const content = readKeyfile();
  const parsed = content === undefined ? undefined : parseKeyfile(content);
  if (parsed?.kind !== "keychain") {
    io.out("store key is not keychain-protected; nothing to lock\n");
    return 0;
  }
  try {
    await keychainDelete(parsed.service, sessionAccount(parsed.account));
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  io.out("locked: the next lockit command will ask for Touch ID\n");
  return 0;
}
