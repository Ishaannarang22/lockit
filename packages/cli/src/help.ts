import type { Io } from "./commands.js";

export const HELP = `lockit — local-first secrets manager for developers and AI agents

Secrets live in one encrypted store on your machine. No account, no server, no
passphrase to export. Agents and humans use the same commands; agent-facing
output is value-free (names and structure only, never a secret value).

USAGE
  lockit <command> [args]

PROJECTS (per-project keys + admission)
  A project is a directory with a .lockit/ (run 'lockit init'). Each project
  tracks its own keys, so the same name can hold different values in different
  projects. A project may only use keys admitted to it; admitting an existing
  shared secret requires a human confirmation an agent cannot satisfy.

  init                              Mark the current directory as a project.
  set <NAME>                        Create a PROJECT-LOCAL key (value via stdin) + bind it.
  admit <NAME...>                   Admit one or more stored keys (by name, in succession)
                                    into this project: one Touch ID / password confirmation
                                    (terminal prompt where unavailable), then writes them
                                    into ./.env (and adds .env to .gitignore).
  status                            This project's admitted keys, value-free.
  secure [on|off]                   View or set this project's mode. Default (off): admit
                                    writes real values to .env. Secure (on): admit writes
                                    references resolved at runtime by 'lockit run' — no
                                    plaintext on disk. Project-wide, saved in .lockit.
  run -- <cmd> [args...]            Run a command with this project's admitted keys injected
                                    (in memory, masked — no .env file needed).

COMMANDS (machine)
  protect [status|on]               The store key is protected by default — kept in the
                                    macOS keychain behind Touch ID, never a plaintext file.
                                    'status' reports; 'on' migrates a legacy plaintext key
                                    now instead of on next use. Protection can't be disabled
                                    (use LOCKIT_PASSPHRASE to manage your own key).
  lock                              Clear the unlock session now, so the next command
                                    re-prompts for Touch ID. One Touch ID otherwise unlocks
                                    for LOCKIT_UNLOCK_TTL seconds (default 90).

COMMANDS (global store)
  set <slug> <KEY> [--schema <s>] [--file]
        Store a secret field in the global store. The VALUE is read from STDIN
        only (never argv), so it never lands in your shell history.
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
  install [zsh|bash] [--no-skill]
        Set up lockit: shell tab-completion AND the agent-safe Claude skill
        (installed globally to ~/.claude/skills, so Claude knows lockit in every
        repo). --no-skill installs completion only.
  completion <zsh|bash>
        Print the completion script (for eval or a Homebrew formula).
  help, --help, -h
        Show this help.

SETUP
  None. On first use lockit creates an encrypted store at ~/.lockit/store.json.
  The decryption key is created in the macOS keychain behind Touch ID (never a
  plaintext file); ~/.lockit/key holds only a value-free marker. Set LOCKIT_PASSPHRASE
  to manage your own key instead. (macOS + Xcode Command Line Tools required for the
  keychain; otherwise set LOCKIT_PASSPHRASE.)

CONFIG (environment variables)
  LOCKIT_HOME        Store + key directory (default: ~/.lockit)
  LOCKIT_PASSPHRASE  Optional override key instead of the keychain-protected key
  LOCKIT_UNLOCK_TTL  Seconds one Touch ID unlock lasts before re-prompting (default 90;
                     0 = prompt every command). Clear early with 'lockit lock'.
  LOCKIT_PULL_YES=1  Skip the pull confirmation (non-interactive)

EXAMPLES
  # global store
  printf 'sk-live-123' | lockit set stripe/prod STRIPE_KEY
  lockit ls --vars
  lockit run stripe/prod -- node server.js
  # per-project
  lockit init
  printf 'postgres://a' | lockit set DATABASE_URL              # project-local key
  lockit admit CARTESIA_API_KEY DEEPGRAM_API_KEY               # pick keys -> prompts -> writes ./.env
  lockit status
  lockit run -- npm start                                      # or inject in memory, no .env

Docs: https://www.npmjs.com/package/@lockit/cli
`;

/** `lockit help` / `--help` / `-h` (and bare `lockit`) — print usage to stdout. */
export async function cmdHelp(io: Io): Promise<number> {
  io.out(HELP);
  return 0;
}
