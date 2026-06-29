# Contributing to lockit

Thanks for your interest in contributing to **lockit** (`key_manager`), an open-source, local-first, AI-agent-safe developer secrets manager. This guide explains how to get a development environment running, how the monorepo is laid out, and the engineering standards we expect from every change.

> **lockit** is a security product. The bar for changes to the cryptographic and core packages is intentionally high. Please read the [Security-critical packages](#security-critical-packages) and [Testing and TDD](#testing-and-tdd) sections before sending code that touches them.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Common commands](#common-commands)
- [Repository layout](#repository-layout)
- [Security-critical packages](#security-critical-packages)
- [Testing and TDD](#testing-and-tdd)
- [Commit conventions](#commit-conventions)
- [Changesets and versioning](#changesets-and-versioning)
- [Pull request process](#pull-request-process)
- [Reporting security issues](#reporting-security-issues)
- [AI-assisted contributions](#ai-assisted-contributions)
- [License](#license)

## Code of conduct

Please be respectful and constructive in all project spaces. By participating you agree to uphold a welcoming, harassment-free environment for everyone.

## Prerequisites

You will need:

- **Node.js** — the current active LTS (Node 20 or newer). We recommend managing versions with a tool such as `nvm`, `fnm`, or `volta`.
- **pnpm** — this is a [pnpm](https://pnpm.io) workspaces monorepo. Install pnpm 9 or newer. The easiest path is via Corepack, which ships with Node:

  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```

- **Git** — for cloning and contributing.

No account, server, or third-party service is required to develop or use lockit locally. The optional self-hosted sync server is a separate, opt-in component.

## Getting started

Clone the repository and install dependencies from the repo root. pnpm will install and link all workspace packages:

```bash
git clone <your-fork-url> key_manager
cd key_manager
pnpm install
```

Build everything once to make sure your toolchain is healthy:

```bash
pnpm build
```

You should now be able to run the CLI from the workspace. A typical loop is to run the package you are working on in watch mode and exercise the `lockit` binary against it.

## Common commands

All commands are run from the repository root unless noted. pnpm fans them out across the workspace.

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install` |
| Build all packages | `pnpm build` |
| Run the test suite | `pnpm test` |
| Run tests in watch mode | `pnpm test --watch` |
| Type-check (TypeScript, no emit) | `pnpm typecheck` |
| Lint (ESLint) | `pnpm lint` |
| Auto-fix lint + format (Prettier) | `pnpm lint --fix` and `pnpm format` |

To target a single package, use pnpm's filter flag, for example:

```bash
pnpm --filter @lockit/crypto test
pnpm --filter @lockit/core typecheck
```

Before opening a pull request, make sure the full quality gate is green locally — this is the same gate CI runs:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Repository layout

This is a pnpm-workspaces monorepo written in TypeScript (strict mode). Code lives under `packages/`, the Claude Code plugin under `plugin/`, and documentation under `docs/`.

```
packages/
  crypto/    Cryptographic trust root: envelope encryption, key hierarchy,
             HPKE, signatures, and zero-knowledge primitives. Tiny, pure,
             NO I/O, independently auditable. Includes a generic
             wrap-a-seed-to-any-public-key primitive.
  core/      Application logic: the vault (the Sets + Slots data model and the
             project-world sandbox), the store (encrypted at-rest persistence —
             the global store plus per-project vaults), and auth/admission
             gating (local presence auth).
  cli/       The `lockit` binary — the universal human AND agent interface.
  server/    Optional self-hosted end-to-end sync/sharing server for a team:
             members, devices, sharing, a shared team vault, Key Transparency,
             and OPAQUE login. A relay that only ever holds ciphertext.
plugin/      The Claude Code plugin — skill(s) + hooks. Teaches agent-safe `lockit`
             usage; hooks add guardrails (for example, warn if a raw secret is
             about to be written into a file or command). Depends on the `lockit` CLI.
docs/        Documentation, including architecture decision records (docs/adr).
```

Where to put a change:

- **Pure cryptography** (no I/O, no filesystem, no network) → `packages/crypto`. This package must stay auditable in isolation.
- **Data model, persistence, admission, resolution logic** → `packages/core`.
- **Command surface, flags, human/agent output** → `packages/cli`.
- **Team sync, sharing relay, transparency log, server endpoints** → `packages/server`.
- **Claude Code skill or hook behavior** → `plugin/`.

A note on dependency direction: `crypto` depends on nothing in the workspace. `core` builds on `crypto`. `cli` and `server` build on `core`. Keep this layering intact — do not introduce I/O into `crypto` or pull `cli`/`server` concerns down into `core`.

## Security-critical packages

`packages/crypto` and `packages/core` are **security-critical**. They are the trust root and the application logic that enforces the project-world sandbox and human-gated admission. Changes to these packages receive **extra review** and **must ship with tests**.

When you touch these packages, your change is expected to preserve and, where relevant, add tests for the following properties:

- **Crypto round-trips** — encrypt/decrypt, wrap/unwrap, sign/verify all reverse correctly.
- **Injection isolation** — `lockit run` decrypts in memory only, sets env vars for the child's lifetime, writes nothing to disk, and shreds file-type secrets on exit.
- **Output masking** — secret values are masked in child `stdout`/`stderr`.
- **Tamper detection** — recipient-set and payload tampering is detected (signature + header HMAC).
- **The sandbox-cannot-be-bypassed property** — a project can only use keys that have been admitted to its project world; the agent can never pull from the global store directly.
- **The agent-never-sees-a-value property** — agent-facing output emits only slugs, schemas, field names, tags, and `hasValue` booleans, never a value (not even masked).

Some honest limits are inherent and should be respected rather than "fixed" with false guarantees — for example, Node cannot guarantee zeroing secrets from memory due to garbage collection, and a child process necessarily holds the real value while it uses it. Document trade-offs honestly; do not paper over them. See [`SECURITY.md`](./SECURITY.md) and the architecture decision records in [`docs/adr/`](./docs/adr/) for the reasoning behind these decisions.

## Testing and TDD

We use **vitest**. The expectation for this project is **test-driven development in very small, independently testable increments**:

1. Write a failing test first.
2. Implement the minimum needed to make it pass.
3. Verify the step in isolation before moving on.

This is a security product, so **never trade security for speed**, and **every step must be verifiable**. Small, reviewable increments are strongly preferred over large drops of code. A pull request that adds behavior without tests will be asked to add them; for `crypto` and `core`, tests are non-negotiable.

Run the suite with `pnpm test`, or scope it to the package you are working on with `pnpm --filter <pkg> test`.

## Commit conventions

We use [**Conventional Commits**](https://www.conventionalcommits.org/). Each commit message starts with a type and an optional scope:

```
feat(core): add open-slot auto-resolve with audit print
fix(cli): mask file-type secret path in dry-run output
test(crypto): cover HPKE recipient-set tamper detection
docs: clarify per-environment opt-in
chore(server): bump @hpke/core
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, `ci`. Use a scope that matches the package (`crypto`, `core`, `cli`, `server`, `plugin`) where it helps. Conventional commits feed our release tooling and changelog.

## Changesets and versioning

We use [**Changesets**](https://github.com/changesets/changesets) with **semantic versioning** to manage releases across the monorepo.

If your change affects a published package's behavior or API, add a changeset:

```bash
pnpm changeset
```

This prompts you for the affected packages and the bump level (patch / minor / major) and writes a small markdown file under `.changeset/`. Commit that file alongside your code. Maintainers aggregate changesets at release time to version and publish packages and to generate the changelog. Pure internal changes (tests, refactors with no observable behavior change, docs) usually do not need a changeset.

## Pull request process

1. **Fork and branch.** Create a topic branch off the default branch (`main`) with a descriptive name.
2. **Keep it small.** Small, focused PRs that follow the TDD increment model are reviewed faster and more thoroughly.
3. **Run the gate locally.** Ensure `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
4. **Add tests.** Required for `crypto` and `core`; expected everywhere behavior changes.
5. **Add a changeset** if a published package changes.
6. **Write a clear description.** Explain what changed and why, and note any security-relevant implications or honest trade-offs.
7. **Open the PR** against `main`. CI runs typecheck, lint, test, and build; all checks must be green.
8. **Review.** A maintainer will review. Changes to security-critical packages require extra scrutiny and may take additional review rounds. Please respond to feedback in the same small-increment spirit.

Once approved and green, a maintainer will merge.

## Reporting security issues

**Do not report security vulnerabilities through public issues or pull requests.** Please follow the responsible-disclosure process described in [`SECURITY.md`](./SECURITY.md). That document explains how to reach the maintainers privately and what to expect after you report.

## AI-assisted contributions

lockit is designed to be safe for AI agents to use, and we welcome AI-assisted contributions. If you use an AI coding assistant (including the Claude Code plugin in [`plugin/`](./plugin/)), please read [`AGENTS.md`](./AGENTS.md) first. It describes how agents should work in this repository, the agent-safety invariants to uphold, and the conventions that keep automated changes reviewable. You remain responsible for any code you submit — review it, test it, and make sure it meets the standards in this guide.

## License

By contributing, you agree that your contributions will be licensed under the project's [Apache-2.0](./LICENSE) license.
