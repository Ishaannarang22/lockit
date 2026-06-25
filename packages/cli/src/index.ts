#!/usr/bin/env node
import { cmdLs, cmdRun, cmdSet, type Io } from "./commands.js";
import { cmdImport } from "./import.js";
import { cmdPull } from "./pull.js";
import { ttyAuthorize } from "./authorize.js";
import { cmdCompleteList, cmdCompletion } from "./completion.js";
import { cmdInstall } from "./install.js";

const USAGE = "usage: lockit <set|ls|run|import|pull|install|completion> [args...]\n";

/** Read all of stdin to a string. Only `set` needs the value, so we read lazily. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const [command, ...argv] = process.argv.slice(2);

  const out = (s: string): void => {
    process.stdout.write(s);
  };
  const err = (s: string): void => {
    process.stderr.write(s);
  };

  if (command === "set") {
    const io: Io = { argv, stdin: await readStdin(), env: process.env, out, err };
    return await cmdSet(io);
  }
  if (command === "ls") {
    const io: Io = { argv, stdin: "", env: process.env, out, err };
    return await cmdLs(io);
  }
  if (command === "run") {
    const io: Io = { argv, stdin: "", env: process.env, out, err };
    return await cmdRun(io);
  }
  if (command === "import") {
    const io: Io = { argv, stdin: "", env: process.env, out, err };
    return await cmdImport(io);
  }
  if (command === "pull") {
    const io: Io = { argv, stdin: "", env: process.env, out, err, authorize: ttyAuthorize };
    return await cmdPull(io);
  }
  if (command === "install") {
    const io: Io = { argv, stdin: "", env: process.env, out, err };
    return await cmdInstall(io);
  }
  if (command === "completion") {
    const io: Io = { argv, stdin: "", env: process.env, out, err };
    return await cmdCompletion(io);
  }
  if (command === "__complete-list") {
    const io: Io = { argv, stdin: "", env: process.env, out, err };
    return await cmdCompleteList(io);
  }

  err(USAGE);
  return 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
