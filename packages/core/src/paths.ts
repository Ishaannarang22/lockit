import { homedir } from "node:os";
import { join } from "node:path";

/** The kv home directory: `$KV_HOME` if set, else `~/.kv`. */
export function kvHome(): string {
  return process.env.KV_HOME ?? join(homedir(), ".kv");
}

/** The path to the sealed global store file. */
export function storePath(): string {
  return join(kvHome(), "store.json");
}
