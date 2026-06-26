# lockit

> **Local-first secrets manager for developers and AI agents.** Keep your API
> keys in one encrypted store, use them without pasting them everywhere, and let
> agents _use_ secrets without ever _seeing_ them.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40lockit%2Fcli-cb3837)](https://www.npmjs.com/package/@lockit/cli)

---

## The problem

1. **Copy-paste sprawl.** The same API key gets duplicated across projects,
   prototypes, and `.env` files. Rotating it means hunting down every copy.
2. **Secrets leak everywhere.** Keys end up in AI-agent transcripts, shell
   history, committed `.env` files, and chat messages. Once a value is seen, it's
   hard to un-see.

lockit stores each secret once, injects it into the commands that need it (so it
never hits your history or a committed file), and keeps agent-facing output
**value-free** — names and structure only, never a value.

## Install & use

```sh
npm i -g @lockit/cli                              # provides the `lockit` command

# global store
printf 'sk-live-abc123' | lockit set stripe/prod STRIPE_KEY   # value via stdin only
lockit ls --vars                                  # see what you have, value-free

# per-project keys (same name can differ per project)
lockit init                                       # mark this dir a project
printf 'postgres://a' | lockit set DATABASE_URL   # project-local key
lockit admit stripe/prod#STRIPE_KEY               # admit a shared secret (prompts to confirm)
lockit run -- npm start                           # inject THIS project's admitted keys, masked

lockit install                                    # tab-completion + global Claude skill
lockit help                                        # full reference (agents: read this)
```

**No setup.** The first command creates an encrypted store at `~/.lockit` with a
machine-local key — nothing to export. Full usage, configuration, and honest
security limits are in **[packages/cli/README.md](./packages/cli/README.md)** (also
shown on the [npm page](https://www.npmjs.com/package/@lockit/cli)).

## Concepts

- **Secret** — a typed bag of **fields**, identified by a **slug** (e.g.
  `stripe/prod`) plus a **schema**. One Stripe key is a field; a Supabase backend
  is three fields under one slug.
- **Global store** — where secrets live, keyed by slug, encrypted at rest in
  `~/.lockit`.
- **Project** — a directory with a `.lockit/`. It tracks its own keys (so the same
  name can hold different values per project) and can only use keys **admitted** to
  it. The binding map (`.lockit/vault.json`) is value-free and committable.
- **Admission** — binding an existing/shared secret into a project, gated by a human
  presence confirmation. On macOS this is a **Touch ID / account-password dialog**
  (LocalAuthentication); on other platforms, or when no GUI/biometric is available,
  it falls back to a terminal prompt. An agent can _request_ admission but can't
  satisfy the gate itself.

## Status

Early (`0.x`), under active development.

**Works today (`0.4.x`):** encrypted local store; **per-project keys + admission +
sandbox** (`init` / `set` / `admit` / `status` / `run`); `import` / `pull`; shell
tab-completion (`install` / `completion`); `help`; a Claude Code plugin in
[`plugin/`](./plugin); zero-setup keyfile so no passphrase needs exporting.
Admission is gated by a real **macOS Touch ID / account-password dialog** (`0.4.5`).

**Next milestone (`0.5.0`) — cryptographic teeth:** move the store key behind
**Touch ID / Secure Enclave** so the admission gate isn't just CLI-enforced (see
[ADR-0007](./docs/adr/0007-project-world-sandbox-human-gated-admission.md) and
[ADR-0009](./docs/adr/0009-local-unlock-model.md)). Until then the auto keyfile sits
on disk, so a process running as you can read `~/.lockit` or hand-edit a project
vault and bypass the gate — documented, not hidden.

## Packages

This is a [pnpm](https://pnpm.io/) workspace monorepo (TypeScript / Node).

| Path                                   | What it is                              |
| -------------------------------------- | --------------------------------------- |
| [`packages/cli`](./packages/cli)       | the `lockit` binary — what you install  |
| [`packages/core`](./packages/core)     | vault, encrypted store, admission layer |
| [`packages/crypto`](./packages/crypto) | pure, no-I/O cryptographic trust root   |

Dependencies flow upward: `crypto` → `core` → `cli`.

## Security model

Client-side encryption with modern primitives (XChaCha20-Poly1305, Argon2id; the
crypto package also ships X25519/Ed25519/HPKE for future sharing). Store and key
files are `0600`. Honest limits — including "the child process holds the real value
while using it" and "no recovery if you lose a passphrase you set" — are documented
in [packages/cli/README.md](./packages/cli/README.md) and
[docs/threat-model.md](./docs/threat-model.md), not hidden.

## Development

```sh
pnpm install
pnpm -r build        # build all packages in dependency order
pnpm -r typecheck
pnpm lint
pnpm test            # unit tests
pnpm test:e2e        # black-box tests against the built binary
```

See [AGENTS.md](./AGENTS.md) and [docs/](./docs) for architecture, data model,
threat model, and the design ADRs.

## License

[Apache-2.0](./LICENSE).
