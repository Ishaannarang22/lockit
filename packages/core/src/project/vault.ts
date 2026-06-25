import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A project's value-free binding map: ENV_VAR_NAME -> "slug#field". No values. */
export interface Vault {
  version: 1;
  bindings: Record<string, string>;
}

const PROJECT_DIR = ".lockit";

export function emptyVault(): Vault {
  return { version: 1, bindings: {} };
}

/** Bind an env-var name to a stored secret reference ("slug#field"). New vault. */
export function bindKey(vault: Vault, name: string, ref: string): Vault {
  return { version: 1, bindings: { ...vault.bindings, [name]: ref } };
}

/** Remove a binding. New vault. */
export function unbindKey(vault: Vault, name: string): Vault {
  const bindings = { ...vault.bindings };
  delete bindings[name];
  return { version: 1, bindings };
}

/** The reference ("slug#field") bound to `name`, or undefined. */
export function vaultRef(vault: Vault, name: string): string | undefined {
  return vault.bindings[name];
}

/** Nearest ancestor directory (including `startDir`) containing a `.lockit/`
 *  directory, or undefined if none up to the filesystem root. */
export function findProjectRoot(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, PROJECT_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function vaultPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_DIR, "vault.json");
}

/** Read the project's vault, or an empty vault if missing/unreadable. */
export function readVault(projectRoot: string): Vault {
  try {
    const parsed = JSON.parse(readFileSync(vaultPath(projectRoot), "utf8")) as Partial<Vault>;
    return { version: 1, bindings: parsed.bindings ?? {} };
  } catch {
    return emptyVault();
  }
}

/** Write the project's vault, creating `.lockit/` if needed. */
export function writeVault(projectRoot: string, vault: Vault): void {
  mkdirSync(join(projectRoot, PROJECT_DIR), { recursive: true });
  writeFileSync(vaultPath(projectRoot), `${JSON.stringify(vault, null, 2)}\n`);
}

/** `lockit init`: create `.lockit/` + an empty vault at `dir` (idempotent).
 *  Returns the project's `.lockit` directory path. */
export function initProject(dir: string): string {
  if (!existsSync(vaultPath(dir))) writeVault(dir, emptyVault());
  return join(dir, PROJECT_DIR);
}
