import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  findProjectRoot,
  getSecret,
  loadStore,
  mergeDotenv,
  readVault,
  resolveBinding,
  resolveVar,
  storePath,
  type DotenvEntry,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

interface PullArgs {
  names: string[];
  allBundle?: string;
  out?: string;
  force: boolean;
  yes: boolean;
}

function parsePullArgs(argv: string[]): PullArgs {
  const args: PullArgs = { names: [], force: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--force") args.force = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--all") {
      const v = argv[i + 1];
      if (v !== undefined) args.allBundle = v;
      i++;
    } else if (a === "--out") {
      const v = argv[i + 1];
      if (v !== undefined) args.out = v;
      i++;
    } else args.names.push(a);
  }
  return args;
}

/** Resolve the target env file by fixed precedence: --out, else first existing
 *  of .env.local / .env, else a new .env in the cwd. */
function targetFile(out: string | undefined): { path: string; isNew: boolean } {
  if (out !== undefined) return { path: out, isNew: !existsSync(out) };
  for (const name of [".env.local", ".env"]) {
    const p = join(process.cwd(), name);
    if (existsSync(p)) return { path: p, isNew: false };
  }
  return { path: join(process.cwd(), ".env"), isNew: true };
}

/** `lockit pull <VAR...> | bundle#VAR | --all <bundle> [--out <file>] [--force]` */
export async function cmdPull(io: Io): Promise<number> {
  const args = parsePullArgs(io.argv);
  if (args.names.length === 0 && args.allBundle === undefined) {
    io.err(
      "usage: lockit pull <VAR...> | <bundle#VAR> | --all <bundle> [--out <file>] [--force] [--yes]\n",
    );
    return 1;
  }

  // Human gate FIRST — nothing is read or written until a human authorizes.
  // --yes (or no authorizer wired) skips the prompt for scripts/agents.
  const authorized = args.yes || (io.authorize ? await io.authorize() : false);
  if (!authorized) {
    io.err("authorization denied or unavailable; nothing written\n");
    return 1;
  }

  let store;
  try {
    store = await loadStore(resolveKey(io), storePath());
  } catch {
    io.err("could not open the store; nothing written\n");
    return 1;
  }

  const entries: DotenvEntry[] = [];
  if (args.allBundle !== undefined) {
    const sec = getSecret(store, args.allBundle);
    if (sec === undefined) {
      io.err(`not found: bundle ${args.allBundle}\n`);
      return 1;
    }
    for (const f of sec.fields) if (f.type === "env") entries.push({ key: f.key, value: f.value });
  }
  // In a project, names resolve through the vault (sandbox: only admitted keys).
  const projectRoot = findProjectRoot(io.cwd ?? process.cwd());
  const vault = projectRoot !== undefined ? readVault(projectRoot) : undefined;

  for (const name of args.names) {
    if (vault !== undefined) {
      const b = resolveBinding(store, vault, name);
      if (b.status === "unbound") {
        io.err(`not admitted to this project: ${name} (run: lockit admit ... --as ${name})\n`);
        return 1;
      }
      if (b.status === "missing") {
        io.err(`binding is broken: ${name} -> ${b.ref}\n`);
        return 1;
      }
      entries.push({ key: name, value: b.value });
      continue;
    }
    const r = resolveVar(store, name);
    if (r.status === "none") {
      io.err(`not found: ${name}\n`);
      return 1;
    }
    if (r.status === "ambiguous") {
      io.err(`AMBIGUOUS: ${name} is in ${r.bundles.join(", ")}; qualify as <bundle>#${name}\n`);
      return 1;
    }
    entries.push({ key: r.field.key, value: r.field.value });
  }

  const target = targetFile(args.out);
  const existingText = target.isNew ? "" : await readFile(target.path, "utf8");
  const merged = mergeDotenv(existingText, entries, { force: args.force });
  await writeFile(target.path, merged.text, target.isNew ? { mode: 0o600 } : {});
  await chmod(target.path, 0o600);

  const skipNote = merged.skipped.length > 0 ? " (already present; --force to overwrite)" : "";
  io.out(`wrote ${merged.wrote.length}, skipped ${merged.skipped.length}${skipNote}\n`);
  return 0;
}
