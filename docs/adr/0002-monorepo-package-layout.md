# 2. Monorepo and package layout

## Status

Accepted

## Context

The product is several cooperating pieces: a cryptographic core, application
logic, a CLI, an optional self-hosted server, and an editor-agent plugin. These
share types and code, but they have very different trust and audit
requirements. The cryptographic primitives in particular must be small, pure,
and independently auditable, free of any I/O that would complicate review.

We need a layout that keeps the security-critical code isolated and reviewable
while letting the higher layers reuse it without duplication.

## Decision

Use a **pnpm workspace monorepo** with the following packages:

- **`packages/crypto`** — the cryptographic trust root: envelope encryption,
  key hierarchy, HPKE, signatures, and zero-knowledge primitives. Tiny, pure,
  **no I/O**, independently auditable. It includes a generic
  wrap-a-seed-to-any-public-key primitive that future features can build on.
- **`packages/core`** — the application logic: the vault (the Sets+Slots data
  model and the project-world sandbox), the store (encrypted at-rest
  persistence — the global store plus per-project vaults), and auth/admission
  gating (local presence auth).
- **`packages/cli`** — the `lockit` binary, the universal human **and** agent
  interface.
- **`packages/server`** — an optional self-hosted end-to-end sync/sharing
  server: members, devices, sharing, a shared team vault, Key Transparency, and
  OPAQUE login. It is a relay that only ever holds ciphertext.
- **`plugin/`** — the Claude Code plugin: skill(s) plus hooks. It teaches
  agent-safe `lockit` usage and adds guardrails (for example, warning if a raw
  secret is about to be written into a file or command). It depends on the
  `lockit` CLI.
- **`docs/`** — documentation.

## Consequences

**Positive**

- `packages/crypto` stays small, pure, and I/O-free, which makes independent
  audit tractable — the property we care about most.
- Clear dependency direction: `crypto` ← `core` ← `cli`/`server`, with the
  plugin depending on the CLI surface rather than internals.
- Shared TypeScript types across packages eliminate drift between the CLI,
  server, and plugin.
- pnpm workspaces give fast, content-addressed installs and strict dependency
  boundaries.

**Negative / honest tradeoffs**

- A monorepo adds coordination overhead: versioning, release, and CI must span
  multiple packages (we use changesets and a unified CI pipeline).
- Enforcing the "no I/O in `crypto`" boundary requires discipline and review;
  the structure encourages it but does not mechanically prevent every
  violation.

## Alternatives considered

- **Separate repositories per component** — maximal isolation, but it makes
  shared types painful, fragments versioning, and complicates the plugin's
  dependency on the CLI. Rejected.
- **A single flat package** — simplest to start, but it would entangle the
  auditable crypto core with I/O-heavy application and server code, defeating
  the central goal of an independently auditable trust root. Rejected.
