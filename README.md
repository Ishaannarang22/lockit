# kv

> A local-first, AI-agent-safe secrets manager for developers. Set a key once, reuse it everywhere, and let agents *use* your secrets without ever *seeing* them.

> **Note:** `kv` is a working placeholder name and may be renamed.

<!-- Status badges (placeholders) -->
[![CI](https://img.shields.io/badge/CI-pending-lightgrey)](#)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)
[![Status: pre-release](https://img.shields.io/badge/status-pre--release-orange)](#status)

---

## The problem

Working with API keys today involves two recurring pains:

1. **Copy-paste sprawl.** Developers waste a lot of time hunting down the same API keys and pasting them across projects, prototypes, and `.env` files. The same OpenAI key ends up duplicated in a dozen places, and rotating it means finding every copy.
2. **Secrets leak everywhere.** Keys end up in AI-agent context and transcripts, shell history, `.env` files, and casual chat messages. Once a value has been seen, it is hard to un-see.

`kv` is built to remove both. It stores each secret **once** and lets every project **reference** it. It is designed so that AI coding agents can run commands that *use* your secrets without those values ever entering the agent's context or your terminal transcript.

## What makes it different

- **Local-first.** No account and no third-party service are required to use `kv` on your own machine. An optional self-hosted server lets a team sync and share, but it is never required.
- **Agent-safe.** All agent-facing output (`list`, `status`, `--dry-run`, the ambiguity chooser) emits only slugs, schemas, field names, tags, and `hasValue` booleans — never a value, not even masked. The agent orchestrates; values flow from the vault into the child process in memory and never enter the model's context or the transcript.
- **Set once, reuse everywhere.** Projects hold *references*, not copies. There is a single source of truth: rotate a secret once and every consumer picks up the change.
- **Zero-knowledge.** Encryption and decryption happen entirely on the client. When you use the optional server, it is a dumb, append-only, encrypted relay that only ever holds ciphertext — the operator can never decrypt your data.
- **Human-gated.** A project can only use a secret that a human has explicitly *admitted* into that project, confirmed with local presence auth (Touch ID / OS password). An agent can request admission but can never satisfy that gate on its own.

## Concepts in one minute

- **Secret** — a typed bag of one or more **fields**, identified by a portable human **slug** (for example `openai/dev`, `supabase/acme`) plus a **schema** (for example `openai`, `supabase`). A single OpenAI key is one field; a Supabase backend is three fields (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- **Global store** — where your secrets live, keyed by **slug** (not by env-var name). Because of this, `supabase/acme` and `supabase/blog` can both have a `SUPABASE_URL` field with zero collision.
- **Project vault** (`./.kv/vault.json`, committed) — a **value-free** list of **slots** (requirements). A slot says "this project needs a secret of schema `X`, injected into env var `Y`." Slots are `pinned` (must be exactly this slug) or `open` (any local secret of this schema that you supply).
- **Admission** — bringing a secret from the global store into a project's sandboxed world, gated by human confirmation plus local auth.

Because the vault is value-free and references the global store, you can commit it safely and share project structure without sharing any secret.

## Quickstart (aspirational, early)

> The commands below illustrate the intended workflow. The project is **pre-release** and these interfaces are still taking shape — treat this as a sketch, not a stable CLI contract.

```sh
# Install (placeholder)
pnpm add -g kv

# 1. Add a secret to your global store, once.
kv secret add openai/dev --schema openai
kv secret add supabase/acme --schema supabase

# 2. In a project, declare a slot and bind it to a secret.
#    This writes a value-free entry into ./.kv/vault.json.
kv link --schema openai --inject OPENAI_API_KEY     # open slot
kv link --slug supabase/acme --bind pinned          # pinned slot

# 3. See what a project needs and how it resolves — no values shown.
kv status

# 4. Run a command with the resolved secrets injected as env vars.
#    Values live in memory only, are masked in child output, and
#    are shredded on exit. Nothing is written to disk.
kv run -- pnpm dev

# Preview what would be set, without running anything.
kv run --dry-run -- pnpm dev

# 5. (Optional, with a self-hosted server) share a secret,
#    end-to-end encrypted, to a teammate's device.
kv share openai/dev --to alice@example.com
```

When an `open` slot has exactly one matching secret, `kv` auto-resolves it and tells you which secret it chose. If more than one matches, you get a clear, value-free numbered chooser rather than a silent guess.

## Security model

`kv` is a zero-knowledge, client-side encrypted system. Secrets are sealed with per-item keys using modern primitives (X25519, Ed25519, XChaCha20-Poly1305, HPKE per RFC 9180, Argon2id, and OPAQUE for server login). The optional server stores only ciphertext, public keys, wrapped key material, and access-control metadata — never a passphrase, private key, or plaintext, and there is no operator master key.

For the full picture, see:

- [`docs/threat-model.md`](./docs/threat-model.md) — what `kv` defends against, and the honest limits (for example, a child process inevitably holds the real value while it uses it, so containment is not omnipotence).
- [`docs/security-crypto.md`](./docs/security-crypto.md) — the key hierarchy, envelope format, sharing and revocation flows, and Key Transparency.

### A limitation we state plainly

**There is no account recovery in this version.** This is a direct, intentional consequence of true zero-knowledge encryption: because no one but you can decrypt your data, no one — including us — can recover it for you. **If you lose your passphrase and all of your devices, your data cannot be recovered.** Account recovery is simply not part of this version; it is future work, and we would rather document the limitation honestly than pretend otherwise.

We also do not claim more than the design delivers: there is no forward secrecy at rest for durable storage, and an optional server operator can see metadata (names, sizes, who shares with whom) even though it can never see values. These tradeoffs are explained in the docs above.

## Repository layout

This is a [pnpm](https://pnpm.io/) workspace monorepo (TypeScript / Node).

| Path | What it is |
| --- | --- |
| [`packages/crypto`](./packages/crypto) | The cryptographic trust root: envelope encryption, key hierarchy, HPKE, signatures, zero-knowledge primitives. Tiny, pure, no I/O, independently auditable. |
| [`packages/core`](./packages/core) | Application logic: the vault (Sets + Slots, project-world sandbox), the encrypted at-rest store, and human-gated admission with local presence auth. |
| [`packages/cli`](./packages/cli) | The `kv` binary — the universal interface for both humans and agents. |
| [`packages/server`](./packages/server) | An optional, self-hosted, end-to-end sync and sharing relay for a team. It only ever holds ciphertext. |
| [`plugin/`](./plugin) | The Claude Code plugin: a skill plus hooks that teach agent-safe `kv` usage and add guardrails (for example, warning before a raw secret is written into a file or command). Depends on the `kv` CLI. |
| [`docs/`](./docs) | Documentation. |

> **A note on MCP:** MCP is not part of v1. Security lives in the CLI, and the CLI is universal — any shell-capable agent can use it, and the Claude Code skill is simply sugar over the CLI. If MCP is added later, it would be an optional thin adapter over `core`, never a core dependency.

## Contributing

Contributions are very welcome. This is a security product built in small, independently testable, test-first increments — please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development workflow, coding standards (TypeScript strict mode, vitest, eslint + prettier, conventional commits), and how the `crypto` and `core` packages are held to the heaviest test coverage.

If you are reporting a security issue, please follow the disclosure process described in the contributing guide rather than opening a public issue.

## Status

`kv` is **pre-release** and under active development. Interfaces, command names, and on-disk formats may change. Feedback and early testing are appreciated.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
