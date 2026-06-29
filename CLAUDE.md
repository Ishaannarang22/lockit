# CLAUDE.md

Claude-Code-specific notes for the `key_manager` repo. **Read [AGENTS.md](AGENTS.md) and the `docs/` directory before changing anything** — this file is only a quick summary.

## Build and test

```sh
pnpm install            # install workspace dependencies
pnpm -r build           # build all packages (dependency order)
pnpm -r typecheck       # TypeScript strict typecheck
pnpm -r lint            # eslint + prettier
pnpm -r test            # vitest across the workspace
```

Scope to one package with `pnpm --filter <pkg> <cmd>`. CI runs typecheck, lint, test, and build; all four must pass.

## Read first

- [AGENTS.md](AGENTS.md) — the full agent guide, invariants, and workflow.
- [docs/glossary.md](docs/glossary.md), [docs/architecture.md](docs/architecture.md), [docs/data-model.md](docs/data-model.md), [docs/threat-model.md](docs/threat-model.md), [docs/security-crypto.md](docs/security-crypto.md).

## Locked decisions (summary)

- **Product:** `lockit`, an open-source, local-first, AI-agent-safe developer secrets manager. CLI plus an optional self-hosted team sync/sharing server. No account or third-party service needed locally. Apache-2.0, TypeScript/Node, pnpm monorepo.
- **Packages:** `crypto` (pure, no-I/O trust root) → `core` (vault + store + admission) → `cli` (`lockit` binary); `server` (ciphertext-only relay) and `plugin/` (Claude Code skill + hooks) at the edges. Dependencies flow upward; never invert.
- **MCP:** dropped from v1. Security lives in the CLI; the CLI is universal. Add MCP only to reach non-shell hosts, and only as a thin optional adapter over `core`.
- **Data model — Sets + Slots:** the global store holds **secrets** (typed bags of **fields**, keyed by **slug** + **schema**). Project vaults are **value-free** lists of **slots** (`pinned` or `open`) with an `inject` map. References, not copies. Per-environment and file-type fields are in v1.
- **Resolver:** strict 0/1/N, never guesses. More than one match is a hard `AMBIGUOUS` error with a value-free chooser.
- **Sandbox + admission:** a project can only use **admitted** secrets. The agent can only **request** admission; it can never pull from the global store. Every admission needs human confirmation **plus** local auth (Touch ID / OS password / biometric). Batch admit = one box, one auth. No re-auth on later `lockit run` by default.
- **Injection (`lockit run`):** decrypt in memory only, spawn the child with env set, mask values in child stdout/stderr, write nothing to disk, shred on exit. File-type fields materialize to tmpfs at `0600` and are shredded. `--dry-run` prints env-var names (values masked) and flags duplicate inject names, unfilled open slots, and ambiguity.

## Invariants you must never violate

1. The agent never emits a secret value (only slugs, schemas, field-names, tags, `hasValue`).
2. The project-world sandbox is real; the agent can only request admission.
3. Admission requires human confirmation plus local auth.
4. References, not copies — single source of truth.
5. Injected env-var names are unique per vault; a duplicate is a hard error at link time and `--dry-run`.
6. `crypto` stays pure and auditable — no I/O.
7. The resolver never guesses (strict 0/1/N).
8. The server holds only ciphertext; all crypto is client-side; no operator master key.

## Honest limits (document, never hide)

- A child process holds the real value while using it, so a rogue agent could still exfiltrate via a command it runs. Containment is not omnipotence.
- Node cannot guarantee zeroing memory (garbage collection); we minimize plaintext lifetime but cannot promise a wipe.
- No account recovery in this version: lose your passphrase and all devices, and the data is unrecoverable. This is an inherent property of zero-knowledge encryption, stated plainly.

## Workflow

TDD in very small, independently testable increments: failing test first, minimum implementation, verify in isolation. This is a security product — never trade security for speed. Conventional commits, semantic versioning, changesets.

**Publishing:** always `pnpm publish` (never `npm publish`) — see [docs/mistakes-to-consider.md](docs/mistakes-to-consider.md). `npm publish` ships `workspace:*` unresolved and breaks every install.
