# Implementation plan — Mode 1: `import` + `pull`

Companion to [`docs/specs/mode1-convenience-locker.md`](../specs/mode1-convenience-locker.md).
Method: TDD in tiny, independently testable increments — failing test first, minimum code, verify in isolation. Each increment below is a commit-sized unit.

## Where code lands

Pure, no-I/O logic goes in `@lockit/core` (parsing, merging, resolving); all filesystem and terminal I/O stays in `@lockit/cli` behind the existing `Io` seam. `@lockit/crypto` is untouched.

New core modules:
- `packages/core/src/env/dotenv.ts` — pure `.env` parse + merge.
- `packages/core/src/store/resolve.ts` — pure variable-name resolver (0/1/N).

New / changed CLI:
- `packages/cli/src/commands.ts` — add `cmdImport`, `cmdPull`; extend `Io` with an `authorize` port; add a value-free variable view to `cmdLs`.
- `packages/cli/src/index.ts` — dispatch `import` / `pull`; wire the real `/dev/tty` authorizer.

Each core module is re-exported from `packages/core/src/index.ts`.

## Ports (so everything is unit-testable)

The one new seam is human authorization. Extend `Io`:

```ts
export interface Io {
  // ...existing: argv, stdin, env, out, err
  /** Human authorization for plaintext egress. Resolves to the passphrase the
   *  human typed on /dev/tty, or null if denied / unavailable. */
  authorize?: () => Promise<string | null>;
}
```

- Production (`index.ts`): an implementation that opens `/dev/tty` read/write, prints a prompt, reads a line with echo disabled, returns it; returns `null` if `/dev/tty` cannot be opened (headless) unless `LOCKIT_PULL_YES=1`, in which case it returns the value of `LOCKIT_PASSPHRASE` to satisfy the batch.
- Tests: a fake `authorize` returning a fixed passphrase (allow) or `null` (deny). No real tty needed in unit tests.

Filesystem for the target env file uses real `fs` against a temp dir in tests (same pattern as the current `cmdSet` tests, which use a temp `LOCKIT_HOME`).

## Increments

### 1. `parseDotenv(text): Array<{ key: string; value: string }>` — core, pure
Tests: plain `KEY=VALUE`; `export KEY=VALUE`; single- and double-quoted values; `#` comment lines and inline trailing comments left as value bytes unless quoted-stripped (decide and pin in tests); blank lines ignored; CRLF endings; duplicate key → last wins; **malformed line → throws naming the 1-based line number**. Reuses/aligns with `isValidFieldKey` for key validation.

### 2. `mergeDotenv(existingText, entries, { force }): { text, wrote: string[], skipped: string[] }` — core, pure
Parses `existingText` for present keys. Appends entries whose key is absent; skips present keys unless `force` (then overwrites in place). Returns the new file text plus value-free `wrote`/`skipped` key lists for the summary. Tests: append into empty/non-empty; skip existing; force overwrite preserves surrounding lines; counts correct; never reorders untouched lines.

### 3. `resolveVar(store, name): { status: 'found'; bundle; field } | { status: 'none' } | { status: 'ambiguous'; bundles: string[] }` — core, pure
Scans all bundles for a field whose key === `name`. Also accepts a qualified `bundle#VAR` form (exact bundle + key). Tests: 0 matches → `none`; exactly 1 → `found`; 2+ across bundles → `ambiguous` with sorted bundle slugs; qualified form resolves directly and bypasses ambiguity.

### 4. `cmdImport(io)` — cli
Resolve path (`argv[0]` or `./.env`), read file, `parseDotenv`, derive slug (`--as` or basename of cwd), `loadStore` → `upsertField` per entry → `saveStore`. Store-only; never writes plaintext; never touches the source file. Tests (temp `LOCKIT_HOME` + temp file): imports all vars; `ls` shows them; `--as` groups under the given slug; parse error → exit 1, store unchanged (no partial import); missing file → clear error, exit 1.

### 5. `cmdLs` variable view — cli
Add a value-free per-variable listing for discovery: `VAR_NAME  [bundle]  hasValue`, one per line, sorted. Introduce it as `lockit ls --vars` so the existing `ls` output and its tests stay intact. Tests: lists every variable with bundle, never a value; stable sort.

### 6. `cmdPull(io)` — cli (the security-critical command)
Flow, in order, writing nothing until the last step:
1. Parse argv: variable names, `--all <bundle>`, `--out <file>`, `--force`.
2. `loadStore`; `resolveVar` each requested name. Any `none`/`ambiguous` → print value-free error, exit 1, **write nothing**.
3. Call `io.authorize()`. `null` → "authorization denied", exit 1, write nothing. A returned passphrase that fails to decrypt → exit 1.
4. Determine target file by precedence (`--out`; else first existing of `.env.local`, `.env`; else create `.env` at mode `0600`).
5. Read existing target text (empty if new), `mergeDotenv`, write back (new files created `0600`).
6. Print value-free summary: `wrote N, skipped M (...)`.

Tests (fake `authorize`): happy path writes real values; denied authorize writes nothing and exits 1; skip-existing vs `--force`; target precedence (`--out`, `.env.local` over `.env`, create `.env`); ambiguous/not-found abort before auth; created file is `0600`.

### 7. Real authorizer + dispatch — cli
Implement the `/dev/tty` authorizer in `index.ts` (open `/dev/tty`, prompt, read line, echo off). Wire `import` and `pull` into `main`'s command switch. Honor `LOCKIT_PULL_YES` headless escape hatch with the documented warning to stderr.

### 8. e2e (real binary, sandbox HOME)
- `import` → `ls --vars` → `pull` happy path through the real binary, asserting the written file contains the real value and lockit's own stdout never does.
- Pseudo-tty test: the prompt is delivered on `/dev/tty`; a denied response writes nothing and exits non-zero — proving an agent driving stdin cannot self-authorize.
- Headless (no tty) refuses by default; `LOCKIT_PULL_YES=1` permits with the warning.

## Security checks to assert (not just happy paths)
- `pull` writes plaintext **only** to the resolved target file, and only after `authorize()` resolves non-null.
- Newly created target files are `0600`.
- lockit's own stdout/stderr remain value-free across every command (extend the existing "no value on stdout" e2e assertions to `import`/`pull`).
- `import` produces no partial state on parse error.

## Order of work
1 → 2 → 3 (core, pure, fast) → 4 → 5 → 6 (cli with fakes) → 7 (wiring) → 8 (e2e). Run `pnpm -r typecheck && pnpm test` after each increment; `pnpm test:e2e` after 7–8. Conventional commits per increment.
