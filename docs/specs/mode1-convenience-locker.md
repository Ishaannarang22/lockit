# Spec — Mode 1: the convenience locker (`import` + `pull`)

Status: approved design, not yet implemented
Date: 2026-06-24
Scope: `@lockit/cli` (`import`, `pull`) and supporting helpers in `@lockit/core`

## Why this exists

`.env` files won because they cost nothing: drop a file, the app reads it, done. Lockit's secure path (encrypted store + `lockit run`) costs *something* on every run, and people are allergic to that. The honest truth is a trilemma — you cannot have all three of (1) no plaintext on disk, (2) the app reads a stock `.env` unchanged, and (3) the app gets real values at runtime. Something must inject the values, and that something is friction.

So instead of forcing everyone onto the secure path, lockit offers a **gradient**. The same encrypted store has two exits:

- **Mode 1 — Locker (this spec):** convenience. Keep your secrets in one encrypted place and squirt the real values into any project's `.env` on demand. No runtime security — the value lands in cleartext on disk, because that is what the user asked for. The win is a single reusable home for keys instead of copies scattered across repos, Slack, and laptops.
- **Mode 2 — Vault (later spec):** security. `lockit init` rewrites `.env` values into references; `lockit run` resolves them at runtime; nothing plaintext touches disk.

Mode 1 is built first: it is lower risk, immediately useful, and needs no new reference format.

## The core tension Mode 1 must not break

Lockit's first invariant is *the agent never obtains a plaintext secret value.* `pull` writes plaintext to disk, so a naive `pull` would hand any agent a one-command way to dump every secret. We do **not** solve this by banning agents — that is unenforceable and the product explicitly wants agents to participate. We solve it the same way admission works elsewhere in lockit: **the agent may request, only a human may authorize.**

Concretely, `pull` always requires a human authorization delivered on the controlling terminal (`/dev/tty`), never on stdin. When an agent runs `lockit pull …`, the prompt appears in the human's terminal; the agent — which drives the child's stdin/stdout — cannot answer a `/dev/tty` prompt. The human types the passphrase, the write proceeds. The invariant holds: the agent caused a *request*, a human performed the *release*.

(Biometric / Touch ID is deferred to the dedicated auth increment. The v1 human gate is a passphrase prompt on `/dev/tty`.)

## Addressing model

Storage is unchanged: secrets remain `slug → fields` bundles in the encrypted store. But the locker is *used* at the granularity of the individual variable, because that is how people think about it ("I want `OPENAI_API_KEY` here"). So:

- **Discovery** is value-free and lists variables with their bundle: `lockit ls` shows `VAR_NAME [bundle] hasValue`, one per line, never a value.
- **`pull` addresses a bare variable name.** Unambiguous name → resolved directly. Same name in two bundles → the strict 0/1/N resolver raises `AMBIGUOUS`, lists the bundles, and asks the user to qualify as `bundle#VAR`. Lockit never guesses.

## Commands

### `lockit import [path] [--as <slug>]`

Reads a `.env`-format file and stores each variable as an `env`-type field in the locker. It is **additive and store-only**: it never writes a secret anywhere in cleartext, and it does **not** modify the source file (rewriting `.env` is Mode 2's `init`).

- Default path: `./.env`.
- Default bundle slug: the current directory's name. Override with `--as <slug>`.
- Parser handles: `KEY=VALUE`, surrounding quotes (single/double), `export ` prefixes, `#` comment lines, blank lines, and CRLF endings. A malformed line is a hard error naming the line number, not a silent skip.
- Re-importing a variable updates its stored value (upsert).

### `lockit pull <VAR...> | <bundle#VAR> | --all <bundle> [--out <file>] [--force]`

Resolves the requested variables and writes their real values into the project's env file, after passing the auth gate.

- Accepts several variables in one invocation.
- Target file precedence: `--out <file>` if given; else the first existing of `.env.local`, `.env`; else create `.env`. Fixed and documented — no heuristic magic.
- Merge: an existing key in the target is **left untouched** unless `--force`; new keys are appended. Pull reports a value-free summary, e.g. `wrote 2, skipped 1 (already present; --force to overwrite)`.
- Auth gate (above) runs before any byte is written. A denied or unavailable authorization writes nothing and exits non-zero.
- No tty available (headless/CI): refuse by default with a clear message. A documented escape hatch (`LOCKIT_PULL_YES=1`) bypasses the prompt and is labeled as turning the gate off.

## Behavior and errors

- Strict resolver everywhere: 0 matches → `not found: <VAR>`; N matches → `AMBIGUOUS` with the qualifying bundles. Exit 1 in both cases, nothing written.
- `pull` is all-or-nothing per run with respect to authorization: one human authorization covers the batch requested in that invocation. It does not silently drop unresolved names — any unresolved name fails the run before writing.
- `import` exits 1 on a parse error and stores nothing from that file (no partial import).
- Output is always value-free on lockit's own stdout/stderr. The only place a value appears is inside the target file written by `pull`.

## Out of scope (deferred)

- `lockit init` (reference rewriting) and reference-aware `lockit run` — Mode 2.
- Biometric / OS-keychain auth — auth increment.
- Cross-bundle rename/rotation UX beyond plain re-`set`/re-`import`.
- Per-environment and file-type handling in `pull` (env-type fields only for now).

## Success criteria

1. `lockit import .env` followed by `lockit ls` shows every variable, value-free, under the right bundle.
2. `lockit pull OPENAI_API_KEY STRIPE_KEY` writes both real values into the detected env file after a single `/dev/tty` passphrase prompt.
3. An agent-driven `pull` (stdin scripted) cannot self-authorize: the prompt lands on `/dev/tty` and a denied/absent human response writes nothing.
4. Existing keys are never clobbered without `--force`; the summary is accurate.
5. Ambiguous and not-found names fail loudly and write nothing.
