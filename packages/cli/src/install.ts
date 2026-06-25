import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { accessSync, constants as FS } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Io } from "./commands.js";
import { zshCompletionScript, bashCompletionScript } from "./completion.js";

// Standard, already-in-$fpath / sourced completion dirs, most-preferred first.
const ZSH_DIRS = ["/opt/homebrew/share/zsh/site-functions", "/usr/local/share/zsh/site-functions"];
const BASH_DIRS = [
  "/opt/homebrew/etc/bash_completion.d",
  "/usr/local/etc/bash_completion.d",
  "/etc/bash_completion.d",
];

function writableDir(dir: string): boolean {
  try {
    accessSync(dir, FS.W_OK);
    return true;
  } catch {
    return false;
  }
}

export interface InstallTarget {
  path: string;
  /** When the chosen dir isn't already wired into the shell, the line to add. */
  rcLine?: string;
  rcFile?: string;
}

/** Where to write `_lockit` for zsh: an explicit `LOCKIT_COMPLETION_DIR`
 *  override, else the first writable standard $fpath dir (no rc edit), else
 *  ~/.zsh/completions (which must be added to $fpath via .zshrc). */
export function chooseZshTarget(
  env: NodeJS.ProcessEnv,
  home: string,
  dirs: string[] = ZSH_DIRS,
  isWritable: (d: string) => boolean = writableDir,
): InstallTarget {
  const override = env.LOCKIT_COMPLETION_DIR;
  if (override !== undefined && override.length > 0) return { path: join(override, "_lockit") };
  for (const dir of dirs) if (isWritable(dir)) return { path: join(dir, "_lockit") };
  const fallback = join(home, ".zsh", "completions");
  return {
    path: join(fallback, "_lockit"),
    rcFile: join(home, ".zshrc"),
    rcLine: `fpath=(${fallback} $fpath); autoload -Uz compinit && compinit`,
  };
}

/** Where to write the bash completion: `LOCKIT_BASH_COMPLETION_DIR` override,
 *  else the first writable standard dir, else ~/.bash_completion.d (sourced
 *  from .bashrc). */
export function chooseBashTarget(
  env: NodeJS.ProcessEnv,
  home: string,
  dirs: string[] = BASH_DIRS,
  isWritable: (d: string) => boolean = writableDir,
): InstallTarget {
  const override = env.LOCKIT_BASH_COMPLETION_DIR;
  if (override !== undefined && override.length > 0) return { path: join(override, "lockit") };
  for (const dir of dirs) if (isWritable(dir)) return { path: join(dir, "lockit") };
  const fallback = join(home, ".bash_completion.d");
  return {
    path: join(fallback, "lockit"),
    rcFile: join(home, ".bashrc"),
    rcLine: `for f in ${fallback}/*; do [ -r "$f" ] && . "$f"; done`,
  };
}

/** Append `rcLine` to `rcFile` if not already present. Returns whether it added. */
async function ensureRcLine(rcFile: string, rcLine: string): Promise<boolean> {
  let current = "";
  try {
    current = await readFile(rcFile, "utf8");
  } catch {
    current = "";
  }
  if (current.includes(rcLine)) return false;
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await appendFile(rcFile, `${prefix}# lockit shell completion\n${rcLine}\n`);
  return true;
}

function detectShell(io: Io): "zsh" | "bash" {
  const arg = io.argv[0];
  if (arg === "zsh" || arg === "bash") return arg;
  const sh = io.env.SHELL ?? "";
  if (sh.endsWith("/bash") || sh === "bash") return "bash";
  return "zsh";
}

/** `lockit install [zsh|bash]` — install shell completion into your completion
 *  path so Tab works in new shells with no further setup. */
export async function cmdInstall(io: Io): Promise<number> {
  const home = io.env.HOME ?? homedir();
  const shell = detectShell(io);
  const target = shell === "bash" ? chooseBashTarget(io.env, home) : chooseZshTarget(io.env, home);
  const script = shell === "bash" ? bashCompletionScript() : zshCompletionScript();

  try {
    await mkdir(dirname(target.path), { recursive: true });
    await writeFile(target.path, script, { mode: 0o644 });
  } catch (e) {
    io.err(
      `could not write completion to ${target.path}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

  io.out(`installed ${shell} completion -> ${target.path}\n`);
  if (target.rcLine !== undefined && target.rcFile !== undefined) {
    const added = await ensureRcLine(target.rcFile, target.rcLine);
    if (added) io.out(`added completion path to ${target.rcFile}\n`);
  }
  io.out(`restart your shell (or run: exec ${shell}) to enable tab-completion\n`);
  return 0;
}
