# Architecture Decision Records

This directory records the significant architecture decisions for **kv**, an
open-source, local-first, AI-agent-safe developer secrets manager.

Each ADR captures a single decision: the context that forced it, the decision
itself, the consequences (both positive and the honest tradeoffs), and the
alternatives that were considered and rejected. ADRs are immutable once
accepted; if a decision is later changed, a new ADR supersedes the old one
rather than editing history in place.

For the wider picture, see the project [README](../../README.md) and the
documentation set under [`docs/`](../).

## Format

Every ADR follows the same structure:

- **Title** — a short descriptive name.
- **Status** — `Accepted` for all current records.
- **Context** — the forces and constraints in play.
- **Decision** — what we chose to do.
- **Consequences** — positive outcomes and honest negatives/tradeoffs.
- **Alternatives considered** — what else was on the table and why it lost.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-language-typescript.md) | Language: TypeScript on Node | Accepted |
| [0002](0002-monorepo-package-layout.md) | Monorepo and package layout | Accepted |
| [0003](0003-sets-and-slots-data-model.md) | The "Sets + Slots" data model | Accepted |
| [0004](0004-orgmesh-zero-knowledge-crypto.md) | OrgMesh zero-knowledge crypto | Accepted |
| [0005](0005-drop-mcp-cli-and-plugin.md) | Drop MCP; CLI and plugin instead | Accepted |
| [0006](0006-references-not-copies.md) | References, not copies | Accepted |
| [0007](0007-project-world-sandbox-human-gated-admission.md) | Project-world sandbox + human-gated admission | Accepted |
| [0008](0008-no-account-recovery-in-v1.md) | No account recovery in v1 | Accepted |
