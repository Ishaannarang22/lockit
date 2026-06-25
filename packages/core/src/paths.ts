import { homedir } from "node:os";
import { join } from "node:path";

/** The lockit home directory: `$LOCKIT_HOME` if set, else `~/.lockit`. */
export function lockitHome(): string {
  return process.env.LOCKIT_HOME ?? join(homedir(), ".lockit");
}

/** The path to the sealed global store file. */
export function storePath(): string {
  return join(lockitHome(), "store.json");
}
