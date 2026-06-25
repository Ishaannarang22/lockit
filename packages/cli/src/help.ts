import type { Io } from "./commands.js";

export const HELP = `lockit — local-first secrets manager for developers and AI agents

Secrets live in one encrypted store on your machine. No account, no server, no
passphrase to export. Agents and humans use the same commands; agent-facing
output is value-free (names and structure only, never a secret value).

USAGE
  lockit <command> [args]

COMMANDS
  set <slug> <KEY> [--schema <s>] [--file]
        Store a secret field. The VALUE is read from STDIN only (never argv),
        so it never lands in your shell history or a process listing.
  ls [--vars]
        List what you have, value-free. Default groups by secret; --vars lists
        every variable with its bundle. Never prints a value.
  run <slug> [--] <cmd> [args...]
        Run a command with the secret's env vars injected. Values are decrypted
        in memory, set in the child's environment, and masked in its output.
        The agent-safe way to USE a secret without seeing it.
  import [path] [--as <slug>]
        Import a .env file into the encrypted store (default: ./.env). Does not
        modify the source file.
  pull <VAR...> | <bundle#VAR> | --all <bundle> [--out <file>] [--force] [--yes]
        Write real secret values into a .env file. Asks for confirmation on the
        terminal first; --yes (or LOCKIT_PULL_YES=1) skips it for scripts/agents.
  install [zsh|bash]
        Install shell tab-completion (no rc edit on Homebrew zsh setups).
  completion <zsh|bash>
        Print the completion script (for eval or a Homebrew formula).
  help, --help, -h
        Show this help.

SETUP
  None. On first use lockit creates an encrypted store at ~/.lockit/store.json
  and a machine-local key at ~/.lockit/key (both mode 0600). Set LOCKIT_PASSPHRASE
  to use your own key instead of the auto-generated one.

CONFIG (environment variables)
  LOCKIT_HOME        Store + key directory (default: ~/.lockit)
  LOCKIT_PASSPHRASE  Optional override key instead of the auto keyfile
  LOCKIT_PULL_YES=1  Skip the pull confirmation (non-interactive)

EXAMPLES
  printf 'sk-live-123' | lockit set stripe/prod STRIPE_KEY
  lockit ls --vars
  lockit run stripe/prod -- node server.js
  lockit import .env --as myapp/dev
  lockit pull STRIPE_KEY --yes

Docs: https://www.npmjs.com/package/@lockit/cli
`;

/** `lockit help` / `--help` / `-h` (and bare `lockit`) — print usage to stdout. */
export async function cmdHelp(io: Io): Promise<number> {
  io.out(HELP);
  return 0;
}
