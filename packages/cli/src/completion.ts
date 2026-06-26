import { listSecrets, loadStore, storePath, type StoreData } from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

/** Value-free completion candidates: every bare variable name, its qualified
 *  `bundle#KEY` form, and each bundle slug (for `--all`). Sorted + de-duplicated.
 *  Derived from the value-free `listSecrets` projection — never a secret value. */
export function completionCandidates(store: StoreData): string[] {
  const set = new Set<string>();
  for (const secret of listSecrets(store)) {
    set.add(secret.slug);
    for (const f of secret.fields) {
      set.add(f.key);
      set.add(`${secret.slug}#${f.key}`);
    }
  }
  return [...set].sort();
}

/** Hidden `lockit __complete-list` — print the value-free candidate list, one
 *  per line, for the shell completion function to cache and filter. Silent (no
 *  output, exit 0) on any read error, so Tab never errors into the prompt. */
export async function cmdCompleteList(io: Io): Promise<number> {
  let store: StoreData;
  try {
    store = await loadStore(await resolveKey(io), storePath());
  } catch {
    return 0;
  }
  for (const candidate of completionCandidates(store)) io.out(`${candidate}\n`);
  return 0;
}

// Single-quoted lines so the shell's own `${...}` / `$(...)` are literal (a
// template literal would try to interpolate them as JS). The completion
// function caches the value-free name list in a shell variable for 60s, so
// `lockit` is invoked at most once per minute per shell and the shell's native
// matcher does the per-keystroke filtering.
// Dual-mode: starts with `#compdef lockit` so it works as an autoloaded file
// dropped into $fpath (what `lockit install` and Homebrew do), and the
// funcstack guard makes the same text also work when sourced via
// `eval "$(lockit completion zsh)"` — sourced, it just registers with compdef.
const ZSH_SCRIPT = [
  "#compdef lockit",
  "_lockit() {",
  "  local -a subcmds; subcmds=(set ls run import pull completion install)",
  "  if (( CURRENT == 2 )); then compadd -- $subcmds; return; fi",
  "  case ${words[2]} in",
  "    pull)",
  "      local ttl=60",
  "      if [[ -z $_LOCKIT_COMP_TS || $(( SECONDS - _LOCKIT_COMP_TS )) -ge $ttl ]]; then",
  '        typeset -g _LOCKIT_COMP_CACHE="$(command lockit __complete-list 2>/dev/null)"',
  "        typeset -g _LOCKIT_COMP_TS=$SECONDS",
  "      fi",
  "      compadd -- ${(f)_LOCKIT_COMP_CACHE}",
  "      ;;",
  "  esac",
  "}",
  'if [ "$funcstack[1]" = "_lockit" ]; then',
  '  _lockit "$@"',
  "else",
  "  compdef _lockit lockit",
  "fi",
  "",
].join("\n");

const BASH_SCRIPT = [
  '# lockit bash completion. eval "$(lockit completion bash)" or drop in bash_completion.d',
  "_lockit() {",
  "  local cur=${COMP_WORDS[COMP_CWORD]}",
  "  if [[ $COMP_CWORD -eq 1 ]]; then",
  '    COMPREPLY=( $(compgen -W "set ls run import pull completion install" -- "$cur") )',
  "    return",
  "  fi",
  "  if [[ ${COMP_WORDS[1]} == pull ]]; then",
  "    local ttl=60 now=$SECONDS",
  "    if [[ -z $_LOCKIT_COMP_TS || $(( now - _LOCKIT_COMP_TS )) -ge $ttl ]]; then",
  '      _LOCKIT_COMP_CACHE="$(command lockit __complete-list 2>/dev/null)"',
  "      _LOCKIT_COMP_TS=$now",
  "    fi",
  '    COMPREPLY=( $(compgen -W "$_LOCKIT_COMP_CACHE" -- "$cur") )',
  "  fi",
  "}",
  "complete -F _lockit lockit",
  "",
].join("\n");

/** The zsh completion script (dual-mode: autoloadable file or `eval`-able). */
export function zshCompletionScript(): string {
  return ZSH_SCRIPT;
}

/** The bash completion script (works sourced or in bash_completion.d). */
export function bashCompletionScript(): string {
  return BASH_SCRIPT;
}

/** `lockit completion <zsh|bash>` — print the shell completion script to stdout.
 *  Used by `eval "$(lockit completion zsh)"` and Homebrew's completion install. */
export async function cmdCompletion(io: Io): Promise<number> {
  const shell = io.argv[0];
  if (shell === "zsh") {
    io.out(ZSH_SCRIPT);
    return 0;
  }
  if (shell === "bash") {
    io.out(BASH_SCRIPT);
    return 0;
  }
  io.err("usage: lockit completion <zsh|bash>\n");
  return 1;
}
