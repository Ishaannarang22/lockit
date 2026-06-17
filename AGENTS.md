# AGENTS.md

A guide for AI coding agents (and humans) working inside the `key_manager` repository. Read this file before making any change. It defines what the project is, where each concern lives, the invariants you must never violate, and the workflow you must follow.

## What this project is

`kv` is an open-source, local-first, AI-agent-safe developer secrets manager. It solves two pains: developers waste enormous time hunting and copy-pasting API keys across projects and prototypes, and secrets leak into AI-agent context and transcripts, shell history, `.env` files, and casual channels. The core ideas are: set a secret **once** and reuse it across every project with zero copy-paste; let AI agents **use** secrets without ever **seeing** them; and share secrets end-to-end encrypted to your other devices and teammates. It is a CLI (`kv`) with an optional self-hosted sync/sharing server for a team, and it needs no account and no third-party service to use locally.

> Account recovery is **not** part of this version. This is a deliberate, documented limitation of true zero-knowledge encryption: if you lose your passphrase and all of your devices, your data cannot be recovered. State this honestly in any docs or messages you write; never paper over it.

## Repository layout (pnpm monorepo)

Dependencies flow upward: `crypto` depends on nothing, `core` depends on `crypto`, `cli` depends on `core`, and `server` and `plugin` sit at the edges. Never invert this direction.

| Path | Concern |
| --- | --- |
| `packages/crypto` | The cryptographic trust root: envelope encryption, the key hierarchy, HPKE, signatures, and zero-knowledge primitives. Tiny, pure, **no I/O**, independently auditable. Includes a generic wrap-a-seed-to-any-public-key primitive that future features can build on. |
| `packages/core` | The application logic: `vault` (the Sets+Slots data model and the project-world sandbox), `store` (encrypted at-rest persistence — the global store plus per-project vaults), and `auth`/admission gating (local presence auth). |
| `packages/cli` | The `kv` binary — the universal human **and** agent interface. |
| `packages/server` | The optional self-hosted end-to-end sync/sharing server for a team: members, devices, sharing, a shared team vault, Key Transparency, and OPAQUE login. A relay that only ever holds **ciphertext**. |
| `plugin/` | The Claude Code plugin — skill(s) plus hooks. Teaches agent-safe `kv` usage; hooks add guardrails (for example, warn if a raw secret is about to be written into a file or command). Depends on the `kv` CLI. |
| `docs/` | Documentation. See the pointers at the bottom of this file. |

**MCP is dropped from v1.** Security lives in the CLI, not in MCP; the CLI is universal (any shell-capable agent can use it), and a skill is Claude-Code sugar over the CLI. The only reason to add MCP later would be to reach AI hosts that cannot run a shell, and if added it would be an optional thin adapter over `core`, never a `core` dependency. Do not introduce MCP without that justification.

## Canonical invariants — NEVER violate these

These are the load-bearing guarantees of the product. A change that breaks any of them is wrong, even if tests pass.

1. **The agent never emits a secret value.** All agent-facing output (`list`, `status`, `--dry-run`, the chooser) emits only slugs, schemas, field-names, tags, and `hasValue` booleans — never a value, not even masked. Values flow from the vault to the child process in memory and never enter the model context or the transcript.
2. **The project-world sandbox is real.** A project can only use secrets that have been **admitted** to its project world. The global store is the protected source; the project world is a sandbox. The agent can never pull from the global store directly — it can only **request** admission.
3. **Admission requires human auth.** Every admission requires human confirmation **plus** local auth (Touch ID / OS password / biometric) — proof of human presence that an agent cannot satisfy. Auth happens once at admission; a batch admit shows all keys in one confirmation box and a single auth admits the whole batch. Re-auth-per-use is an optional policy dial, never the default. Do not add a code path that admits without that gate.
4. **References, not copies.** A project vault stores requirements (slots), not values — a single source of truth. Rotate once and all consumers update. Do not introduce silent value duplication.
5. **The unique-inject-name invariant.** The union of injected env-var names within a single vault must be unique. A duplicate is a **hard error** at link time and at `run --dry-run`. Never resolve a duplicate by guessing or by last-write-wins.
6. **`crypto` stays pure and auditable.** No I/O, no filesystem, no network, no environment access in `packages/crypto`. It must remain tiny and independently auditable. Push all I/O up into `core` or above.
7. **The resolver never guesses.** Resolution is strict 0/1/N: an exact slug is used; exactly one match resolves; more than one match is a hard structured `AMBIGUOUS` error with a value-free numbered chooser; zero is missing or open-unfilled. No label heuristics that could silently pick a wrong value.
8. **The server only holds ciphertext.** The optional server stores ciphertext, public keys, never-unwrapped wrapped key material, salts, the OPAQUE record, the Key Transparency log, sigchains, and access-control metadata — never a passphrase, private key, seed, DEK, or plaintext. There is no operator master key. All encryption and decryption is client-side.

Honest limits you must document rather than hide: a child process inevitably holds the real value while it uses it, so a rogue or confused agent could still exfiltrate via a command it runs — containment is not omnipotence. And Node cannot guarantee zeroing secrets from memory because of garbage collection; we minimize plaintext lifetime but cannot promise a wipe. See [docs/threat-model.md](docs/threat-model.md).

## Data model in one screen — "Sets + Slots"

- The **global store** holds **secrets**. A secret is a typed bag of one or more **fields**, identified by a portable human **slug** (for example `openai/dev`, `supabase/acme`) plus a **schema** (for example `openai`, `supabase`). A singleton is a Set with one field; a Supabase backend is a Set with three fields.
- The store is keyed by **slug**, not by env-var name, so `supabase/acme` and `supabase/blog` can both contain a field named `SUPABASE_URL` with zero collision. This is the central problem the model solves, structurally. Renames are safe via an `aka` alias list. A `localId` is machine-local and is never committed.
- A **project vault** (committed, e.g. `./.kv/vault.json`) is **value-free**: a list of **slots** (requirements). A slot is `{ schema, bind: pinned|open, to: slug-or-null, inject: { fieldKey -> EXACT_ENV_VAR_NAME } }`. `pinned` means exactly that slug (genuinely shared infrastructure); `open` means any secret of this schema that the developer supplies locally.
- One-value-many-names: the `inject` map can map a field to many env-var names (e.g. `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_URL`). Remember invariant #5 above.
- Per-environment (dev/staging/prod) and file-type fields (`type=file`, materialized to tmpfs at `0600`, env var points at the path, shredded on exit) are in scope for v1.
- A gitignored local resolution cache (e.g. `./.kv/local.json`) records how `open` slots are filled on this machine.

Full detail: [docs/data-model.md](docs/data-model.md).

## Build and test

This is a pnpm monorepo on TypeScript strict mode. From the repo root:

```sh
pnpm install            # install workspace dependencies
pnpm -r build           # build all packages (respects dependency order)
pnpm -r typecheck       # TypeScript strict typecheck
pnpm -r lint            # eslint + prettier
pnpm -r test            # vitest across the workspace
```

To work in a single package, scope with a filter, e.g. `pnpm --filter @kv/crypto test`. CI runs typecheck, lint, test, and build on every change; all four must pass.

`crypto` and `core` are security-critical and carry the heaviest coverage: crypto round-trips, injection isolation, output masking, tamper detection, the sandbox-cannot-be-bypassed property, and the agent-never-sees-a-value property. When you touch these packages, add or extend tests for the relevant invariant above.

## Workflow: TDD in very small increments

This is a security product. Never trade security for speed, and make every step verifiable.

1. Write a **failing test first** that pins down the next tiny behavior.
2. Implement the **minimum** to make it pass.
3. Verify the step in **isolation** before moving on.
4. Keep increments small and independently testable; do not batch unrelated changes.

Use TypeScript strict mode, conventional commits, semantic versioning, and changesets for versioning. Prefer many small, reviewable commits over one large one. The detailed step-by-step implementation plan is produced separately, after this documentation set.

## Documentation pointers

- [docs/glossary.md](docs/glossary.md) — canonical terms (secret, field, slug, schema, slot, admission, etc.). Use exactly this terminology.
- [docs/architecture.md](docs/architecture.md) — component layout, dependency direction, data flow, and the MCP decision.
- [docs/data-model.md](docs/data-model.md) — Sets + Slots in full, the resolver, environments, and injection.
- [docs/threat-model.md](docs/threat-model.md) — the project-world sandbox, agent safety, and the honest limits.
- [docs/security-crypto.md](docs/security-crypto.md) — the "OrgMesh" envelope-encryption design, the key ladder, and the enroll/share/rotate/revoke flows.
