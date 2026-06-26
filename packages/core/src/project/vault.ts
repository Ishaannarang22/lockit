import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { lockitHome } from "../paths.js";

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

/** Nearest ancestor directory (including `startDir`) that is a lockit project —
 *  i.e. has a `.lockit/vault.json`. We key on the vault file, NOT just the
 *  `.lockit/` directory, so the global store home (`~/.lockit/`, which holds
 *  store.json + key but no vault.json) is never mistaken for a project root. */
export function findProjectRoot(startDir: string): string | undefined {
  const storeHome = resolve(lockitHome());
  let dir = startDir;
  for (;;) {
    // Never treat the global store home as a project, even if a stray vault.json
    // lands in it — the store dir and a project dir share the name `.lockit`.
    if (
      resolve(join(dir, PROJECT_DIR)) !== storeHome &&
      existsSync(join(dir, PROJECT_DIR, "vault.json"))
    ) {
      return dir;
    }
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

/** The slug under which a project's own ("local") secrets are stored in the
 *  global store — the directory basename plus a hash of its absolute path, so
 *  two same-named projects never collide. Valid slug: lowercase alnum + hyphen. */
export function projectLocalSlug(projectRoot: string): string {
  const base =
    basename(projectRoot)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "proj";
  const h = createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
  return `${base}-${h}`;
}

/** `lockit init`: create `.lockit/` + an empty vault at `dir` (idempotent).
 *  Returns the project's `.lockit` directory path. */
export function initProject(dir: string): string {
  if (!existsSync(vaultPath(dir))) writeVault(dir, emptyVault());
  return join(dir, PROJECT_DIR);
}
