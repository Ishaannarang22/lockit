# lockit

**Local-first secrets manager for developers and AI agents.**

Keep your API keys and `.env` values in one encrypted store on your machine — no
account, no server, no passphrase to export. Use them by injecting them into a
command (so they never touch your shell history or get committed), or pull them
back into a `.env` when you need to. Agents and humans use the same commands, and
agent-facing output is **value-free** — it shows names and structure, never a
secret value.

> Status: early (`0.x`). It's a usable encrypted local locker **with per-project
> keys and human-gated admission** (`0.4.0`): a project can only use keys you've
> admitted to it, and admitting a stored secret requires a confirmation an agent
> can't satisfy. The presence gate is a terminal prompt today; **Touch ID** lands
> next (`0.5.0`). Honest limits are documented below, not hidden.

## Install

```sh
npm i -g @lockit/cli      # provides the `lockit` command
```

## Setup

**None.** On first use, lockit creates an encrypted store at `~/.lockit/store.json`
and a machine-local key at `~/.lockit/key` (both `0600`). Nothing to export, no
prompt. (Want to bring your own key instead of the auto-generated one? Set
`LOCKIT_PASSPHRASE`.)

## Quick start

```sh
# Store a secret. The VALUE comes from stdin only — never argv — so it never
# lands in your shell history or a process listing.
printf 'sk-live-abc123' | lockit set stripe/prod STRIPE_KEY
printf 'whsec-xyz'      | lockit set stripe/prod WEBHOOK_SECRET

# See what you have — value-free (names + structure, never values).
lockit ls
#   stripe/prod  [stripe]  STRIPE_KEY,WEBHOOK_SECRET
lockit ls --vars
#   STRIPE_KEY       [stripe/prod]  hasValue
#   WEBHOOK_SECRET   [stripe/prod]  hasValue

# Run a command with the secret injected as env vars. Values are decrypted in
# memory, set in the child's environment, and MASKED in its output.
lockit run stripe/prod -- node server.js
lockit run stripe/prod -- sh -c 'echo "key is $STRIPE_KEY"'
#   key is ***          ← the child saw the real value; your terminal didn't
```

## Per-project keys + admission

A **project** is a directory with a `.lockit/` (run `lockit init`). Each project
tracks its own keys, so **the same name can hold different values in different
projects**, and a project can only use keys **admitted** to it.

```sh
cd ~/code/app-a && lockit init
printf 'postgres://a' | lockit set DATABASE_URL    # a PROJECT-LOCAL key, auto-bound

cd ~/code/app-b && lockit init
printf 'postgres://b' | lockit set DATABASE_URL    # same name, DIFFERENT value

lockit status                 # this project's keys, value-free
lockit run -- npm start       # injects THIS project's DATABASE_URL
```

**Admitting a shared secret** (reuse one stored secret across projects) is the
gated action — it prompts on the terminal, which an agent driving stdin can't
answer:

```sh
printf 'sk-live-abc' | lockit set openai/personal OPENAI_API_KEY   # once, globally
cd ~/code/app-a
lockit admit openai/personal           # prompts: Allow ... for this project? [y/N]
lockit run -- npm start                # OPENAI_API_KEY now injected here
```

Inside a project the sandbox is strict: `run -- <cmd>` and `pull <NAME>` only use
**admitted** keys; the global `run <slug>` / `pull --all` are refused — admit
first. The `name` lives per-project (in committable `.lockit/vault.json`,
value-free); the value lives once in the global store.

## Migrate an existing `.env`

```sh
lockit import .env --as myapp/dev      # store every var; the file is left untouched
lockit run myapp/dev -- npm start      # run with all of them injected (global secret)
# or write specific values back into a .env:
lockit pull STRIPE_KEY DATABASE_URL    # asks to confirm first; --yes to skip
```

## Commands

| Command                                                                         | What it does                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `init`                                                                          | Mark the current directory a project (creates `.lockit/`).                       |
| `set <NAME>`                                                                    | In a project: create a **project-local** key (value via stdin) + bind it.        |
| `set <slug> <KEY> [--schema <s>] [--file]`                                      | Store a field in the **global** store. VALUE is read from **stdin only**.        |
| `admit <slug\|slug#field> [--as NAME]`                                          | Bind an existing/shared secret into this project. **Prompts to confirm.**        |
| `status`                                                                        | This project's admitted keys, value-free.                                        |
| `ls [--vars]`                                                                   | List global secrets, value-free. `--vars` lists individual variables.            |
| `run -- <cmd> [args...]`                                                        | In a project: run `<cmd>` with the project's admitted keys injected, masked.     |
| `run <slug> [--] <cmd> [args...]`                                               | Global (outside a project): inject one secret's fields.                          |
| `import [path] [--as <slug>]`                                                   | Import a `.env` into the global store (default `./.env`). Doesn't touch file.    |
| `pull <VAR...> \| <bundle#VAR> \| --all <bundle> [--out <f>] [--force] [--yes]` | Write real values into a `.env`. Confirms first. Sandboxed inside a project.     |
| `install [zsh\|bash] [--no-skill]`                                              | Set up tab-completion + the global Claude skill. `--no-skill` = completion only. |
| `completion <zsh\|bash>`                                                        | Print the completion script (for `eval` or Homebrew).                            |
| `help`, `--help`, `-h`                                                          | Show help.                                                                       |

Run `lockit help` for the full reference.

## Set up: `lockit install`

One command after install wires up everything:

```sh
npm i -g @lockit/cli
lockit install          # shell tab-completion + the agent-safe Claude skill
exec zsh                # or open a new terminal
```

`lockit install` does two things:

- **Shell tab-completion** — drops a completion file into your `$fpath` (no rc
  edit on Homebrew zsh). Then `lockit pull nvi⇥` → `NVIDIA_API_KEY`.
- **The Claude skill** — writes the agent-safe skill to `~/.claude/skills/` so
  **Claude knows how to use lockit in every repo** (drive it by names, use `run`,
  request admission, never print a value). Use `--no-skill` to skip it.

## For AI agents

**`lockit install` drops an agent-safe skill into `~/.claude/skills/`**, so Claude
picks up these rules automatically in every repo. (A fuller Claude Code **plugin**
— the same skill plus a `pull`-egress hook — lives in `plugin/` in the repo.) The
rules:

- `lockit help` (or `--help`) prints the full command reference — read it first.
- `lockit status` (project) and `lockit ls` / `ls --vars` (global) are
  **value-free**: which keys exist, never a value.
- Use `lockit run -- <cmd>` to _use_ a secret without seeing it — injected into the
  child process, masked, never printed.
- You can **request** admission (`lockit admit ...`), but only a human can approve
  it on the terminal. Inside a project, only admitted keys work.
- Avoid `lockit pull` — it writes plaintext to disk. Prefer `run`.

## Configuration

| Env var             | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `LOCKIT_HOME`       | Store + key directory (default `~/.lockit`).            |
| `LOCKIT_PASSPHRASE` | Optional: use your own key instead of the auto keyfile. |
| `LOCKIT_PULL_YES=1` | Skip the `pull` confirmation (non-interactive).         |

## Security & honest limits

- Secrets are encrypted at rest (XChaCha20-Poly1305; key from Argon2id or the
  machine keyfile). The store and key files are `0600`.
- `set` reads the value from **stdin**, never argv, so it isn't in `ps` or shell
  history. `run` masks injected values in the child's output.
- **The admission gate is enforced by the CLI**, not yet by crypto: in `0.4.0` the
  store key still lives on disk (the auto keyfile), so a process running as you
  could read `~/.lockit` directly or hand-edit a project's `.lockit/vault.json` and
  bypass the gate. The terminal prompt is real against an agent that can't answer
  `/dev/tty`; the **cryptographic teeth** — moving the key behind **Touch ID /
  Secure Enclave** so an agent literally can't decrypt an unadmitted key — land in
  `0.5.0`.
- A child process holds the real value while using it, so a command you run can
  still leak it. Containment is not omnipotence.
- **No recovery.** If you set `LOCKIT_PASSPHRASE` and lose it, the store is
  unrecoverable. That's inherent to zero-knowledge encryption.

## Roadmap

- **Now (`0.4.0`):** encrypted local store; **per-project keys + admission +
  sandbox**; `init` / `set` / `admit` / `status` / `run` / `import` / `pull` / shell
  completion; the Claude Code plugin. Zero-setup keyfile.
- **Next (`0.5.0`):** **Touch ID / Secure Enclave** — move the store key behind OS
  auth so the admission gate is cryptographic, not just enforced by the CLI.
- **Later:** end-to-end sharing across your devices and team; optional self-hosted
  ciphertext-only sync server.

Apache-2.0.
