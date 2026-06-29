import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadStore,
  mergeDotenv,
  parseReferences,
  resolveRef,
  storePath,
  type DotenvEntry,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";
import { readKeyfile } from "./keyfile.js";
import { isKeychainProtected } from "./storekey.js";

interface ResolveArgs {
  refPath: string;
  out?: string;
  force: boolean;
  yes: boolean;
}

function parseResolveArgs(argv: string[]): ResolveArgs {
  const args: ResolveArgs = { refPath: "./.env.ref", force: false, yes: false };
  let sawPositional = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--force") args.force = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--out") {
      const v = argv[i + 1];
      if (v !== undefined) args.out = v;
      i++;
    } else if (!sawPositional) {
      args.refPath = a;
      sawPositional = true;
    }
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

/** `lockit resolve [<ref-file>] [--out <file>] [--force] [--yes]`
 *  Read a value-free reference file (`ENV=@ref` lines), resolve each `@ref`
 *  against the LOCAL store strictly 0/1/N, and — behind one admission auth —
 *  fill the resolved values into `.env`. Never partially fills; never prints a value. */
export async function cmdResolve(io: Io): Promise<number> {
  const args = parseResolveArgs(io.argv);

  // Read the value-free reference file first (leaks nothing) so the prompt can
  // name what is about to be filled. Nothing is WRITTEN before authorization.
  let text: string;
  try {
    text = await readFile(args.refPath, "utf8");
  } catch {
    io.err(`could not read reference file: ${args.refPath}\n`);
    return 1;
  }

  let refs;
  try {
    refs = parseReferences(text);
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  if (refs.length === 0) {
    io.err(`no references found in ${args.refPath}; nothing written\n`);
    return 1;
  }

  const target = targetFile(args.out);
  const providers = refs.map((r) => `@${r.ref}`);
  const promptText = `admit ${refs.length} reference(s): ${providers.join(", ")} — fill ${target.path}?`;

  // Human gate FIRST — nothing is written until a human authorizes. --yes (or a
  // keychain-protected store, whose unlock is itself a Touch ID gate) skips the prompt.
  const authorized =
    args.yes ||
    isKeychainProtected(io.env, readKeyfile) ||
    (io.authorize ? await io.authorize(promptText) : false);
  if (!authorized) {
    io.err("authorization denied or unavailable; nothing written\n");
    return 1;
  }

  let store;
  try {
    store = await loadStore(await resolveKey(io), storePath());
  } catch {
    io.err("could not open the store; nothing written\n");
    return 1;
  }

  const entries: DotenvEntry[] = [];
  const chosen: { envName: string; slug: string }[] = [];
  const problems: string[] = [];
  for (const ref of refs) {
    const result = resolveRef(store, ref.ref);
    if (result.status === "found") {
      entries.push({ key: ref.envName, value: result.field.value });
      chosen.push({ envName: ref.envName, slug: result.bundle });
    } else if (result.status === "none") {
      problems.push(`${ref.envName} -> @${ref.ref} (no matching secret)`);
    } else {
      problems.push(`${ref.envName} -> @${ref.ref} AMBIGUOUS: ${result.bundles.join(", ")}`);
    }
  }

  // STRICT: any unresolved or ambiguous reference aborts the whole fill.
  if (problems.length > 0) {
    for (const line of problems) io.err(`${line}\n`);
    io.err(`unresolved references; nothing written\n`);
    return 1;
  }

  const existingText = target.isNew ? "" : await readFile(target.path, "utf8");
  const merged = mergeDotenv(existingText, entries, { force: args.force });
  await writeFile(target.path, merged.text, target.isNew ? { mode: 0o600 } : {});
  await chmod(target.path, 0o600);

  // Auto-fill but tell me: name the chosen slug behind each filled var.
  for (const c of chosen) io.out(`${c.envName} <- ${c.slug}\n`);
  const skipNote = merged.skipped.length > 0 ? " (already present; --force to overwrite)" : "";
  io.out(`filled ${merged.wrote.length}, skipped ${merged.skipped.length}${skipNote}\n`);
  return 0;
}
