import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The real compiled binary the e2e suite drives as a black box. */
export const LOCKIT_BIN = resolve(HERE, "../packages/cli/dist/index.js");

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOpts {
  stdin?: string;
  passphrase?: string;
  env?: Record<string, string>;
}

/** Spawn the real `lockit` binary in a sandbox HOME and capture stdout/stderr/exit.
 *  Black box: we only feed argv + stdin + env and observe outputs. */
export function runVeyl(home: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolveP, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, LOCKIT_HOME: home, ...opts.env };
    if (opts.passphrase !== undefined) env.LOCKIT_PASSPHRASE = opts.passphrase;
    const child = spawn(process.execPath, [LOCKIT_BIN, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolveP({ stdout, stderr, code: code ?? 0 }));
    child.stdin.end(opts.stdin ?? "");
  });
}

/** Create a disposable LOCKIT_HOME, run `fn`, then remove it — even on failure.
 *  Each call is isolated, so e2e tests are safe to run in parallel. */
export async function withSandbox<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "kv-e2e-"));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
