# lockit

**Local-first secrets manager for developers and AI agents.**

Keep your API keys and `.env` values in one encrypted store on your machine — no
account, no server, no passphrase to export. Use them by injecting them into a
command (so they never touch your shell history or get committed), or pull them
back into a `.env` when you need to. Agents and humans use the same commands, and
agent-facing output is **value-free** — it shows names and structure, never a
secret value.

> Status: early (`0.x`). Today it's a usable encrypted local locker. The
> human-gated **admission** model (an agent must get your approval before a new
> key can be used in a project, backed by Touch ID) is in progress — see
> [Roadmap](#roadmap). Honest limits are documented below, not hidden.

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

## Migrate an existing `.env`

```sh
lockit import .env --as myapp/dev      # store every var; the file is left untouched
lockit run myapp/dev -- npm start      # run with all of them injected
# or write specific values back into a .env:
lockit pull STRIPE_KEY DATABASE_URL    # asks to confirm first; --yes to skip
```

## Commands

| Command                                                                         | What it does                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `set <slug> <KEY> [--schema <s>] [--file]`                                      | Store a field. VALUE is read from **stdin only**.                           |
| `ls [--vars]`                                                                   | List secrets, value-free. `--vars` lists individual variables.              |
| `run <slug> [--] <cmd> [args...]`                                               | Run `<cmd>` with the secret's env vars injected, masked in output.          |
| `import [path] [--as <slug>]`                                                   | Import a `.env` into the store (default `./.env`). Doesn't modify the file. |
| `pull <VAR...> \| <bundle#VAR> \| --all <bundle> [--out <f>] [--force] [--yes]` | Write real values into a `.env`. Confirms first.                            |
| `install [zsh\|bash]`                                                           | Install shell tab-completion (no rc edit on Homebrew zsh).                  |
| `completion <zsh\|bash>`                                                        | Print the completion script (for `eval` or Homebrew).                       |
| `help`, `--help`, `-h`                                                          | Show help.                                                                  |

Run `lockit help` for the full reference.

## Tab-completion

```sh
lockit install          # detects your shell, drops a completion file into your $fpath
exec zsh                # or open a new terminal
lockit pull nvi⇥        # completes to NVIDIA_API_KEY, etc.
```

## For AI agents

- `lockit help` (or `--help`) prints the full command reference — read it first.
- `lockit ls` / `lockit ls --vars` is **value-free**: it tells you which secrets
  and variables exist without revealing any value.
- Use `lockit run <slug> -- <cmd>` to _use_ a secret without seeing it — the value
  is injected into the child process, never printed.
- `lockit pull --yes` writes real values into a `.env` non-interactively (this
  does put plaintext on disk; prefer `run` when you don't need a file).

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
- **The auto keyfile lives on disk**, so any process running as you (including an
  AI agent) can currently decrypt the store. The human-gated admission model that
  closes this — moving the key behind Touch ID / OS auth so an agent can't decrypt
  unapproved keys without your approval — is the next milestone.
- A child process holds the real value while using it, so a command you run can
  still leak it. Containment is not omnipotence.
- **No recovery.** If you set `LOCKIT_PASSPHRASE` and lose it, the store is
  unrecoverable. That's inherent to zero-knowledge encryption.

## Roadmap

- **Now:** encrypted local locker — `set` / `ls` / `run` / `import` / `pull` /
  shell completion, zero-setup keyfile.
- **Next:** per-project **admission** — an agent must get your approval (Touch ID /
  OS password) before a new key can be used in a project; approved keys are then
  agent-first. Key moves behind the OS auth so the gate has real teeth.

Apache-2.0.
