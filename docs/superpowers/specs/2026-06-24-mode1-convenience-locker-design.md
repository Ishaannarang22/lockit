# Design — Mode 1: the convenience locker (`import` + `pull`)

Date: 2026-06-24
Status: approved design, ready for implementation plan
Scope: `@lockit/cli` (`import`, `pull`, `ls --vars`) with pure helpers in `@lockit/core`

## Problem

`.env` files win on cost: drop a file, the app reads it, done. Lockit's secure path (encrypted store + `lockit run`) costs something on every run, and people resist that. The underlying constraint is a trilemma — you cannot have all three of:

1. No plaintext secrets on disk.
2. The app reads a stock `.env` unchanged.
3. The app gets real values at runtime.

Something must inject the values between disk and app, and that something is friction. Rather than force the secure path on everyone, lockit offers a **gradient**: one encrypted store, two exits.

- **Mode 1 — Locker (this design):** convenience. Keep secrets in one encrypted place; write real values into any project's `.env` on demand. No runtime security — plaintext lands on disk because that is what was asked for. The win is one reusable home for keys instead of scattered copies.
- **Mode 2 — Vault (later):** security. `lockit init` rewrites values to references; `lockit run` resolves them at runtime; nothing plaintext on disk.

Mode 1 ships first: lower risk, immediately useful, no new reference format.

## The invariant Mode 1 must preserve

Lockit's first invariant: *the agent never obtains a plaintext secret value.* `pull` writes plaintext, so a naive `pull` hands any agent a one-command secret dump. We do not ban agents (unenforceable, and agents are wanted). We use lockit's admission principle: **the agent may request; only a human may authorize.**

`pull` requires a human authorization on the controlling terminal (`/dev/tty`), never stdin. When an agent runs `lockit pull …`, the prompt surfaces in the human's terminal; the agent — which drives stdin/stdout — cannot answer a `/dev/tty` prompt. The human types the passphrase; the write proceeds. The agent caused a *request*; a human performed the *release*. (Biometric/Touch ID deferred to the auth increment; v1 gate is a `/dev/tty` passphrase prompt.)

## Addressing

Storage stays `slug → fields` bundles. The locker is *used* per variable, since that is how people think ("I want `OPENAI_API_KEY` here").

- **Discovery** is value-free: `lockit ls --vars` shows `VAR_NAME [bundle] hasValue`, one per line, never a value.
- **`pull` addresses a bare variable name.** Unambiguous → resolved. Same name in two bundles → strict `AMBIGUOUS` error listing bundles, asking to qualify as `bundle#VAR`. Never guesses.

## Commands

### `lockit import [path] [--as <slug>]`
Read a `.env`-format file; store each variable as an `env`-type field. Additive and store-only: never writes plaintext, never modifies the source file (that is Mode 2's `init`).
- Default path `./.env`; default slug = current directory name; override with `--as`.
- Parser: `KEY=VALUE`, quotes, `export ` prefix, `#` comments, blanks, CRLF. Malformed line → hard error naming the line number; no partial import.
- Re-import upserts.

### `lockit pull <VAR...> | <bundle#VAR> | --all <bundle> [--out <file>] [--force]`
Resolve requested variables and write real values into the project's env file, after the auth gate.
- Several variables per invocation; one human authorization covers the batch.
- Target precedence: `--out`; else first existing of `.env.local`, `.env`; else create `.env` (mode `0600`).
- Merge: existing keys untouched unless `--force`; new keys appended. Value-free summary: `wrote N, skipped M (...)`.
- Auth gate runs before any write. Denied/unavailable → write nothing, exit non-zero.
- Headless (no tty): refuse by default; documented `LOCKIT_PULL_YES=1` escape hatch labeled as turning the gate off.

## Behavior and errors
- Strict resolver: 0 → `not found`; N → `AMBIGUOUS` with bundles. Exit 1, nothing written.
- Any unresolved name fails the `pull` before writing (no silent drop).
- `import` parse error → exit 1, nothing stored.
- lockit's own stdout/stderr stay value-free; values appear only inside the file `pull` writes.

## Out of scope (deferred)
- `lockit init` + reference-aware `run` (Mode 2).
- Biometric / OS-keychain auth.
- Rotation UX beyond plain re-`set`/`import`.
- Per-environment and file-type fields in `pull` (env-type only for now).

## Success criteria
1. `import .env` then `ls --vars` shows every variable, value-free, under the right bundle.
2. `pull OPENAI_API_KEY STRIPE_KEY` writes both real values to the detected file after one `/dev/tty` passphrase prompt.
3. Agent-driven `pull` cannot self-authorize: prompt lands on `/dev/tty`; denied/absent response writes nothing.
4. Existing keys never clobbered without `--force`; summary accurate.
5. Ambiguous/not-found names fail loudly and write nothing.
