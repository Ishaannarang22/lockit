import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  bindKey,
  findProjectRoot,
  getSecret,
  initProject,
  loadStore,
  mergeDotenv,
  readVault,
  resolveAdmit,
  resolveBinding,
  resolveVar,
  storePath,
  writeVault,
  type StoreData,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

interface AdmitItem {
  env: string;
  slug: string;
  field: string;
  value: string;
}

/** Resolve one admit argument (bare field name, slug, or slug#field) to a
 *  concrete field, value-free errors. */
function resolveAdmitArg(
  store: StoreData,
  name: string,
): { ok: true; slug: string; field: string } | { ok: false; error: string } {
  if (name.includes("#")) {
    const r = resolveAdmit(store, name);
    return r.status === "ok"
      ? { ok: true, slug: r.slug, field: r.field }
      : { ok: false, error: `not found: ${name}` };
  }
  // Prefer treating it as an env-var (field) name — that's what people type.
  const byField = resolveVar(store, name);
  if (byField.status === "found")
    return { ok: true, slug: byField.bundle, field: byField.field.key };
  if (byField.status === "ambiguous") {
    return {
      ok: false,
      error: `AMBIGUOUS: ${name} is in ${byField.bundles.join(", ")}; admit as <slug>#${name}`,
    };
  }
  // Otherwise try it as a slug.
  const bySlug = resolveAdmit(store, name);
  if (bySlug.status === "ok") return { ok: true, slug: bySlug.slug, field: bySlug.field };
  if (bySlug.status === "multi-field") {
    return {
      ok: false,
      error: `${name} has multiple fields (${bySlug.fields.join(", ")}); admit one as ${name}#<field>`,
    };
  }
  return { ok: false, error: `not found: ${name}` };
}

/** Append `.env` to the project's `.gitignore` if not already ignored. */
function ensureGitignore(root: string): void {
  const path = join(root, ".gitignore");
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  if (/^\s*\.env\s*$/m.test(current)) return;
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(path, `${current}${prefix}.env\n`);
}

function cwdOf(io: Io): string {
  return io.cwd ?? process.cwd();
}

function requireProject(io: Io): string | undefined {
  const root = findProjectRoot(cwdOf(io));
  if (root === undefined) {
    io.err("not in a lockit project (run: lockit init)\n");
    return undefined;
  }
  return root;
}

/** `lockit init` — create `.lockit/` + an empty vault in the current directory. */
export async function cmdInit(io: Io): Promise<number> {
  const dir = initProject(cwdOf(io));
  io.out(`initialized lockit project (${dir})\n`);
  return 0;
}

/** `lockit status` — the current project's bound keys, value-free. */
export async function cmdStatus(io: Io): Promise<number> {
  const root = requireProject(io);
  if (root === undefined) return 1;

  const vault = readVault(root);
  const names = Object.keys(vault.bindings).sort();
  if (names.length === 0) {
    io.out("no keys admitted to this project\n");
    return 0;
  }
  const store = await loadStore(resolveKey(io), storePath());
  for (const name of names) {
    const r = resolveBinding(store, vault, name);
    io.out(`${name}  ->  ${vault.bindings[name]}  [${r.status}]\n`);
  }
  return 0;
}

/** `lockit admit <slug|slug#field> [--as NAME]` — bind an existing stored secret
 *  into this project, gated by a human presence confirmation. */
export async function cmdAdmit(io: Io): Promise<number> {
  const root = requireProject(io);
  if (root === undefined) return 1;

  // Parse: one or more key names (in succession), optional --as (single only), --force.
  const names: string[] = [];
  let asName: string | undefined;
  let force = false;
  for (let i = 0; i < io.argv.length; i++) {
    const a = io.argv[i] ?? "";
    if (a === "--as") {
      const next = io.argv[i + 1];
      if (next === undefined || next.length === 0) {
        io.err("--as requires a non-empty name\n");
        return 1;
      }
      asName = next;
      i++;
    } else if (a === "--force") {
      force = true;
    } else {
      names.push(a);
    }
  }
  if (names.length === 0) {
    io.err("usage: lockit admit <NAME...> | <slug#field> [--as NAME] [--force]\n");
    return 1;
  }
  if (asName !== undefined && names.length !== 1) {
    io.err("--as can only be used with a single key\n");
    return 1;
  }

  const store = await loadStore(resolveKey(io), storePath());

  // Resolve every requested key BEFORE prompting; any failure aborts, nothing changes.
  const items: AdmitItem[] = [];
  for (const name of names) {
    const r = resolveAdmitArg(store, name);
    if (!r.ok) {
      io.err(`${r.error}\n`);
      return 1;
    }
    const field = getSecret(store, r.slug)?.fields.find((f) => f.key === r.field);
    if (field === undefined || field.type !== "env") {
      io.err(`not found: ${r.slug}#${r.field}\n`);
      return 1;
    }
    items.push({ env: asName ?? r.field, slug: r.slug, field: r.field, value: field.value });
  }

  // ONE human confirmation for the whole batch (value-free).
  const list = items.map((it) => `${it.env} -> ${it.slug}#${it.field}`).join(", ");
  const ok = io.authorize
    ? await io.authorize(
        `Admit ${items.length} key(s) into this project and write them to .env? (${list})`,
      )
    : false;
  if (!ok) {
    io.err("admission denied or unavailable; nothing changed\n");
    return 1;
  }

  // Record the value-free bindings...
  let vault = readVault(root);
  for (const it of items) vault = bindKey(vault, it.env, `${it.slug}#${it.field}`);
  writeVault(root, vault);

  // ...and materialize the values into the project's .env (0600), gitignored.
  const envPath = join(root, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const merged = mergeDotenv(
    existing,
    items.map((it) => ({ key: it.env, value: it.value })),
    { force },
  );
  writeFileSync(envPath, merged.text, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  ensureGitignore(root);

  const skip =
    merged.skipped.length > 0 ? ` (skipped ${merged.skipped.length}; --force to overwrite)` : "";
  io.out(`admitted ${items.length} key(s) -> ${envPath}${skip}\n`);
  return 0;
}
