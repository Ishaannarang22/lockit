import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { constants as osConstants } from "node:os";
import {
  bindKey,
  findProjectRoot,
  getSecret,
  isValidFieldKey,
  listSecrets,
  loadStore,
  projectLocalSlug,
  readVault,
  resolveVaultEnv,
  saveStore,
  secretEnv,
  storePath,
  upsertField,
  writeVault,
} from "@lockit/core";
import type { FieldType } from "@lockit/core";
import { loadOrCreateKey } from "./keyfile.js";

/** The injected IO surface every handler talks to — no direct `process.std*`,
 *  so handlers stay pure-ish and unit-testable with a fake IO. */
export interface Io {
  argv: string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
  out: (s: string) => void;
  err: (s: string) => void;
  /** Working directory used to locate the current project (default process.cwd()). */
  cwd?: string;
  /** Human presence gate for admission / pull: true to proceed. The real
   *  implementation prompts y/N on /dev/tty (with `prompt`), so an agent driving
   *  stdin cannot self-authorize. */
  authorize?: (prompt?: string) => Promise<boolean>;
}

/** The store key: `LOCKIT_PASSPHRASE` if explicitly set (override), otherwise
 *  the auto-managed machine-local keyfile. Never prompts; never fails. */
export function resolveKey(io: Io): string {
  const env = io.env.LOCKIT_PASSPHRASE;
  if (env !== undefined && env.length > 0) return env;
  return loadOrCreateKey();
}

/** Strip exactly one trailing newline ("\n" or "\r\n") so a piped value isn't
 *  silently corrupted by the shell's trailing newline, but inner bytes survive. */
function trimOneTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

/** `lockit set <slug> <KEY> [--schema <s>] [--file]`
 *  The VALUE is read from stdin only — never from argv — so it never lands in
 *  process listings, shell history, or the args of a spawned process. */
export async function cmdSet(io: Io): Promise<number> {
  const passphrase = resolveKey(io);

  const positional: string[] = [];
  let schema: string | undefined;
  let type: FieldType = "env";

  for (let i = 0; i < io.argv.length; i++) {
    const arg = io.argv[i] ?? "";
    if (arg === "--file") {
      type = "file";
    } else if (arg === "--schema") {
      const next = io.argv[i + 1];
      if (next === undefined || next.length === 0) {
        io.err("--schema requires a non-empty value\n");
        return 1;
      }
      schema = next;
      i++;
    } else {
      positional.push(arg);
    }
  }

  const value = trimOneTrailingNewline(io.stdin);

  // One positional inside a project → create a PROJECT-LOCAL secret and bind it,
  // so `set DATABASE_URL` means "this project's DATABASE_URL".
  if (positional.length === 1 && positional[0] !== undefined) {
    const name = positional[0];
    const root = findProjectRoot(io.cwd ?? process.cwd());
    if (root === undefined) {
      io.err(
        "not in a lockit project. Use 'lockit set <slug> <KEY>' for the global store, or run 'lockit init'.\n",
      );
      return 1;
    }
    if (!isValidFieldKey(name)) {
      io.err(`invalid key: ${JSON.stringify(name)}\n`);
      return 1;
    }
    const slug = projectLocalSlug(root);
    let store = await loadStore(passphrase, storePath());
    store = upsertField(store, { slug, schema: slug, key: name, type, value });
    await saveStore(store, passphrase, storePath());
    writeVault(root, bindKey(readVault(root), name, `${slug}#${name}`));
    io.out(`set ${name} (project)\n`);
    return 0;
  }

  const slug = positional[0];
  const key = positional[1];
  if (slug === undefined || key === undefined) {
    io.err("usage: lockit set <slug> <KEY> [--schema <s>] [--file]\n");
    return 1;
  }

  const resolvedSchema = schema ?? slug.split("/")[0] ?? "";

  let store = await loadStore(passphrase, storePath());
  try {
    store = upsertField(store, { slug, schema: resolvedSchema, key, type, value });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  await saveStore(store, passphrase, storePath());

  io.out(`set ${slug} ${key} (${type})\n`);
  return 0;
}

/** `lockit ls` — one value-free line per secret: `<slug>  [<schema>]  <KEY1>,<KEY2>`.
 *  Prints structure (slug/schema/field keys) only, never a value. */
export async function cmdLs(io: Io): Promise<number> {
  const passphrase = resolveKey(io);

  const store = await loadStore(passphrase, storePath());

  if (io.argv.includes("--vars")) {
    const rows: { key: string; slug: string; hasValue: boolean }[] = [];
    for (const secret of listSecrets(store)) {
      for (const f of secret.fields)
        rows.push({ key: f.key, slug: secret.slug, hasValue: f.hasValue });
    }
    rows.sort((a, b) => a.key.localeCompare(b.key) || a.slug.localeCompare(b.slug));
    for (const r of rows) io.out(`${r.key}  [${r.slug}]  ${r.hasValue ? "hasValue" : "empty"}\n`);
    return 0;
  }

  for (const secret of listSecrets(store)) {
    const keys = secret.fields.map((f) => f.key).join(",");
    io.out(`${secret.slug}  [${secret.schema}]  ${keys}\n`);
  }
  return 0;
}

/** Replace every occurrence of each secret value in `text` with `***`.
 *  Longest-first so a value that is a substring of another is still fully covered.
 *  Empty values are skipped (a global empty-string replace would corrupt output). */
function maskSecrets(text: string, values: string[]): string {
  let masked = text;
  for (const value of [...values].filter((v) => v.length > 0).sort((a, b) => b.length - a.length)) {
    masked = masked.split(value).join("***");
  }
  return masked;
}

/** A streaming masker that survives chunk boundaries. It decodes bytes with a
 *  StringDecoder (so a multibyte character is never split across events) and
 *  retains a tail of `maxLen-1` characters between writes, so a secret value
 *  straddling two chunks is masked before any of it is forwarded. */
function makeMaskingForwarder(values: string[], emit: (s: string) => void) {
  const decoder = new StringDecoder("utf8");
  const maxLen = values.reduce((m, v) => Math.max(m, v.length), 0);
  let pending = "";
  let done = false;
  return {
    onData(chunk: Buffer): void {
      pending = maskSecrets(pending + decoder.write(chunk), values);
      const keep = maxLen > 0 ? maxLen - 1 : 0;
      if (pending.length > keep) {
        emit(pending.slice(0, pending.length - keep));
        pending = pending.slice(pending.length - keep);
      }
    },
    flush(): void {
      if (done) return;
      done = true;
      pending = maskSecrets(pending + decoder.end(), values);
      if (pending.length > 0) emit(pending);
      pending = "";
    },
  };
}

/** Mirror the shell convention: a signal-terminated child yields 128 + signum. */
function exitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal !== null) return 128 + ((osConstants.signals as Record<string, number>)[signal] ?? 0);
  return 0;
}

/** Spawn `cmd` with `injected` env vars set, masking every injected value in the
 *  child's stdout/stderr. Shared by global `run <slug>` and project `run -- cmd`. */
function spawnMasked(io: Io, cmd: string[], injected: Record<string, string>): Promise<number> {
  const command = cmd[0]!;
  const values = Object.values(injected);
  const env: NodeJS.ProcessEnv = { ...io.env, ...injected };
  return new Promise<number>((resolve) => {
    const child = spawn(command, cmd.slice(1), { env, stdio: ["inherit", "pipe", "pipe"] });
    const outFwd = makeMaskingForwarder(values, io.out);
    const errFwd = makeMaskingForwarder(values, io.err);
    child.stdout?.on("data", (chunk: Buffer) => outFwd.onData(chunk));
    child.stderr?.on("data", (chunk: Buffer) => errFwd.onData(chunk));
    child.on("error", (e) => {
      io.err(`failed to run ${command}: ${e instanceof Error ? e.message : String(e)}\n`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      outFwd.flush();
      errFwd.flush();
      resolve(exitCode(code, signal));
    });
  });
}

/** `lockit run -- <cmd>` (project: inject this project's admitted keys) or
 *  `lockit run <slug> [--] <cmd>` (global: inject one secret's fields). Both
 *  decrypt in memory and mask injected values in the child's output. */
export async function cmdRun(io: Io): Promise<number> {
  const passphrase = resolveKey(io);

  // Project mode: `run -- cmd ...` — inject the current project's vault bindings.
  if (io.argv[0] === "--") {
    const cmd = io.argv.slice(1);
    if (cmd[0] === undefined) {
      io.err("usage: lockit run -- <cmd> [args...]\n");
      return 1;
    }
    const root = findProjectRoot(io.cwd ?? process.cwd());
    if (root === undefined) {
      io.err("not in a lockit project (run: lockit init)\n");
      return 1;
    }
    const store = await loadStore(passphrase, storePath());
    const { env: injected, missing } = resolveVaultEnv(store, readVault(root));
    if (missing.length > 0) io.err(`warning: unresolved bindings: ${missing.sort().join(", ")}\n`);
    return await spawnMasked(io, cmd, injected);
  }

  const [slug, ...rest] = io.argv;
  if (slug === undefined) {
    io.err("usage: lockit run <slug> [--] <cmd> [args...]  |  lockit run -- <cmd>\n");
    return 1;
  }
  const cmd = rest[0] === "--" ? rest.slice(1) : rest;
  if (cmd[0] === undefined) {
    io.err("usage: lockit run <slug> [--] <cmd> [args...]  |  lockit run -- <cmd>\n");
    return 1;
  }

  const store = await loadStore(passphrase, storePath());
  const secret = getSecret(store, slug);
  if (secret === undefined) {
    io.err(`no secret: ${slug}\n`);
    return 1;
  }
  return await spawnMasked(io, cmd, secretEnv(secret));
}
