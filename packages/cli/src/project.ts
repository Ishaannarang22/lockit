import {
  bindKey,
  findProjectRoot,
  initProject,
  loadStore,
  readVault,
  resolveAdmit,
  resolveBinding,
  storePath,
  writeVault,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

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

  let query: string | undefined;
  let asName: string | undefined;
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
    } else if (query === undefined) {
      query = a;
    }
  }
  if (query === undefined) {
    io.err("usage: lockit admit <slug|slug#field> [--as NAME]\n");
    return 1;
  }

  const store = await loadStore(resolveKey(io), storePath());
  const res = resolveAdmit(store, query);
  if (res.status === "none") {
    io.err(`not found: ${query}\n`);
    return 1;
  }
  if (res.status === "multi-field") {
    io.err(
      `${query} has multiple fields (${res.fields.join(", ")}); admit one as ${query}#<field>\n`,
    );
    return 1;
  }

  const name = asName ?? res.field;
  const ref = `${res.slug}#${res.field}`;
  const ok = io.authorize
    ? await io.authorize(`Allow "${name}" -> ${ref} for this project?`)
    : false;
  if (!ok) {
    io.err("admission denied or unavailable; nothing changed\n");
    return 1;
  }

  writeVault(root, bindKey(readVault(root), name, ref));
  io.out(`admitted ${name} -> ${ref}\n`);
  return 0;
}
