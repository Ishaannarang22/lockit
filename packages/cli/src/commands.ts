import { spawn } from "node:child_process";
import {
  getSecret,
  listSecrets,
  loadStore,
  saveStore,
  secretEnv,
  storePath,
  upsertField,
} from "@kv/core";
import type { FieldType } from "@kv/core";

/** The injected IO surface every handler talks to — no direct `process.std*`,
 *  so handlers stay pure-ish and unit-testable with a fake IO. */
export interface Io {
  argv: string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Pull the passphrase from the environment, or signal a value-free failure.
 *  Returns `undefined` after writing the error, so callers `return 1`. */
function passphraseOrError(io: Io): string | undefined {
  const passphrase = io.env.KV_PASSPHRASE;
  if (passphrase === undefined || passphrase.length === 0) {
    io.err("KV_PASSPHRASE is not set\n");
    return undefined;
  }
  return passphrase;
}

/** Strip exactly one trailing newline ("\n" or "\r\n") so a piped value isn't
 *  silently corrupted by the shell's trailing newline, but inner bytes survive. */
function trimOneTrailingNewline(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

/** `kv set <slug> <KEY> [--schema <s>] [--file]`
 *  The VALUE is read from stdin only — never from argv — so it never lands in
 *  process listings, shell history, or the args of a spawned process. */
export async function cmdSet(io: Io): Promise<number> {
  const passphrase = passphraseOrError(io);
  if (passphrase === undefined) return 1;

  const positional: string[] = [];
  let schema: string | undefined;
  let type: FieldType = "env";

  for (let i = 0; i < io.argv.length; i++) {
    const arg = io.argv[i] ?? "";
    if (arg === "--file") {
      type = "file";
    } else if (arg === "--schema") {
      const next = io.argv[i + 1];
      if (next === undefined) {
        io.err("--schema requires a value\n");
        return 1;
      }
      schema = next;
      i++;
    } else {
      positional.push(arg);
    }
  }

  const slug = positional[0];
  const key = positional[1];
  if (slug === undefined || key === undefined) {
    io.err("usage: kv set <slug> <KEY> [--schema <s>] [--file]\n");
    return 1;
  }

  const resolvedSchema = schema ?? slug.split("/")[0] ?? "";
  const value = trimOneTrailingNewline(io.stdin);

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

/** `kv ls` — one value-free line per secret: `<slug>  [<schema>]  <KEY1>,<KEY2>`.
 *  Prints structure (slug/schema/field keys) only, never a value. */
export async function cmdLs(io: Io): Promise<number> {
  const passphrase = passphraseOrError(io);
  if (passphrase === undefined) return 1;

  const store = await loadStore(passphrase, storePath());
  for (const secret of listSecrets(store)) {
    const keys = secret.fields.map((f) => f.key).join(",");
    io.out(`${secret.slug}  [${secret.schema}]  ${keys}\n`);
  }
  return 0;
}

/** Replace every occurrence of each secret value in `text` with `***`.
 *  Longest-first so a value that is a substring of another is still fully
 *  covered. Empty values are skipped (nothing to mask, and a global empty-string
 *  replace would corrupt output). */
function maskSecrets(text: string, values: string[]): string {
  let masked = text;
  for (const value of [...values].filter((v) => v.length > 0).sort((a, b) => b.length - a.length)) {
    masked = masked.split(value).join("***");
  }
  return masked;
}

/** `kv run <slug> [--] <cmd> [args...]`
 *  Decrypts in memory, injects `env`-type fields into the child's environment,
 *  spawns the command, and masks every injected value in the child's stdout /
 *  stderr before forwarding. kv's own output never carries a secret value. */
export async function cmdRun(io: Io): Promise<number> {
  const passphrase = passphraseOrError(io);
  if (passphrase === undefined) return 1;

  const [slug, ...rest] = io.argv;
  if (slug === undefined) {
    io.err("usage: kv run <slug> [--] <cmd> [args...]\n");
    return 1;
  }

  const cmd = rest[0] === "--" ? rest.slice(1) : rest;
  const command = cmd[0];
  if (command === undefined) {
    io.err("usage: kv run <slug> [--] <cmd> [args...]\n");
    return 1;
  }

  const store = await loadStore(passphrase, storePath());
  const secret = getSecret(store, slug);
  if (secret === undefined) {
    io.err(`no secret: ${slug}\n`);
    return 1;
  }

  const injected = secretEnv(secret);
  const values = Object.values(injected);
  const env: NodeJS.ProcessEnv = { ...io.env, ...injected };

  return await new Promise<number>((resolve) => {
    const child = spawn(command, cmd.slice(1), { env, stdio: ["inherit", "pipe", "pipe"] });

    child.stdout?.on("data", (chunk: Buffer) => {
      io.out(maskSecrets(chunk.toString("utf8"), values));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      io.err(maskSecrets(chunk.toString("utf8"), values));
    });

    child.on("error", (e) => {
      io.err(`failed to run ${command}: ${e instanceof Error ? e.message : String(e)}\n`);
      resolve(1);
    });
    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}
