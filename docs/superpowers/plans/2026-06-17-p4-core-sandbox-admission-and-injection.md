# Project-World Sandbox, Human-Gated Admission, and the `kv run` Injection Engine Implementation Plan (Intended)

> Status: INTENDED — scope-level. Expand into bite-sized failing-test-first TDD steps just-in-time, aligned with the repo state at that time. Plan #1 (docs/superpowers/plans/2026-06-17-p0-scaffold-and-crypto-foundations.md) is the worked example of the target granularity.

**Goal:** Build, in `packages/core`, the project-world sandbox (the admitted set of a project), the human-gated admission flow with pluggable local-auth providers, the `kv run` in-memory injection engine (env + file secrets, output masking, dry-run preview), the audit log, and the agent-safe listing surface — so a project can only use secrets a human has explicitly admitted, and values never reach an agent.

**Depends on:** Plan #3 (core: encrypted store + Sets/Slots vault model + strict 0/1/N resolver) and Plan #1 (the `@kv/crypto` at-rest seal/open primitives). Builds directly on the store, the Secret/Slot types, and the resolver delivered by Plan #3.

**Packages touched:** `packages/core` (all new modules here). No `packages/cli` work — the CLI wiring of these surfaces is a later plan; this plan exposes the programmatic core API and proves its security properties with tests.

---

## Scope — what this subsystem builds

- **The project world (admitted set).** A per-project record of exactly which secret slugs have been admitted into the project's sandbox. The global store is the protected source; the project world is the only set a project may decrypt and inject from. The agent can never read the global store directly — it can only _request_ admission.
- **The admission flow.** Request a set of secrets → build a confirmation box that lists **all** requested keys (slug, schema, field names, `hasValue`) → call `AuthProvider.authenticate()` (proof of human presence) → on success, admit the whole set into the project world. Batch semantics: one auth admits the entire batch in a single confirmation.
- **The `AuthProvider` interface and implementations.** A pluggable proof-of-presence gate: macOS Touch ID / biometric via LocalAuthentication, OS-password fallback, and a passphrase-prompt demo fallback. Plus a deterministic mock provider for tests that the agent path can never satisfy.
- **The unlock cache + auto-lock** (see [ADR-0009](../../adr/0009-local-unlock-model.md) and the [unlock-model spec](../specs/2026-06-17-local-unlock-model-design.md)). After one passphrase unlock, store the **DEK** (from P3's wrapped-DEK envelope) in the OS keychain, OS-encrypted with a Secure-Enclave-held key, released under a Touch-ID access policy — so daily use is passphrase-once-then-fingerprint. Auto-lock evicts the cached DEK on system sleep, an idle timeout (default 15 min, configurable), and explicit `kv lock`.
- **The per-session vs per-use access-policy dial.** One mechanism, two policies on the keychain item: **per-session** for the user's own `kv run` (smooth), and **per-use** for **agent-initiated** access — a native fingerprint prompt _every single time_, showing which app + which keys, releasing the value into the child process only. The agent never sees the passphrase or value; a human fingerprint is structurally in the loop on every agent access.
- **Off-device passphrase fallback.** Where there is no Secure Enclave (SSH, CI), unlock falls back to the master passphrase: typed at a prompt over SSH, or supplied via `KV_PASSPHRASE` in CI (opt-in, documented as the deliberately-weaker mode). Wired through the CLI in P5.
- **The injection engine for `kv run`.** Resolve slots (via the Plan #3 resolver) for the selected environment, decrypt only the needed values **in memory**, spawn the child process with env vars set for its lifetime, **mask** every secret value in the child's stdout/stderr, materialize `type:"file"` secrets to a `0600` tmpfs temp file (set the path env var) and **shred** them on exit, write nothing to disk.
- **`kv run --dry-run`.** The agent-safe verification primitive: print the inject env-var **names** that will be set (values masked), and flag duplicate inject names, unfilled open slots, and ambiguous resolution — without running anything or revealing a value.
- **The audit log.** Append-only local record of admissions and uses (and refused/failed admissions), so exfiltration attempts and unexpected access leave a trail.
- **The agent-safe listing surface.** A value-free projection of secrets and project-world state (names / schema / field keys / tags / `hasValue` booleans only) that the CLI and plugin consume.

---

## Files / modules to create or modify — concrete paths + one-line responsibility

- `packages/core/src/project-world/project-world.ts` — the admitted-set record: load/save (gitignored local state), query membership, add admitted slugs.
- `packages/core/src/project-world/project-world.test.ts` — admitted-set persistence and membership tests.
- `packages/core/src/admission/auth-provider.ts` — the `AuthProvider` interface plus shared types (`AuthRequest`, `AuthResult`).
- `packages/core/src/admission/providers/macos-localauth.ts` — Touch ID / biometric provider via macOS LocalAuthentication.
- `packages/core/src/admission/providers/os-password.ts` — OS-password fallback provider.
- `packages/core/src/admission/providers/passphrase-demo.ts` — passphrase-prompt demo fallback provider.
- `packages/core/src/admission/providers/mock-auth.ts` — deterministic test/mock provider (configurable allow/deny, call-count assertions).
- `packages/core/src/admission/admission.ts` — the admission flow: build confirmation box from a request, call the provider once, admit the batch, write the audit entry.
- `packages/core/src/admission/admission.test.ts` — admission-flow tests (batch one-auth-admits-all; agent cannot bypass; refusal not admitted; audit recorded).
- `packages/core/src/run/inject.ts` — the injection engine: resolve → decrypt-in-memory → build env map → spawn child → mask → shred.
- `packages/core/src/run/mask.ts` — the output-masking stream transform for child stdout/stderr.
- `packages/core/src/run/file-materialize.ts` — write file-type secrets to a `0600` tmpfs temp file and shred on exit.
- `packages/core/src/run/dry-run.ts` — the value-free dry-run report (names + duplicate / unfilled / ambiguous flags).
- `packages/core/src/run/inject.test.ts`, `mask.test.ts`, `file-materialize.test.ts`, `dry-run.test.ts` — injection-isolation, masking, materialize-and-shred, and dry-run tests.
- `packages/core/src/audit/audit-log.ts` — append-only audit log (admission / use / refused), with a value-free entry shape.
- `packages/core/src/audit/audit-log.test.ts` — audit append/read and value-freeness tests.
- `packages/core/src/listing/agent-view.ts` — the value-free projection of secrets and project-world state for agent-facing output.
- `packages/core/src/listing/agent-view.test.ts` — proves the projection never carries a value.
- `packages/core/src/index.ts` — re-export the new public surface (admission, run, audit, listing, project-world).

---

## Key components & responsibilities

**Project world (admitted set).** A small, gitignored local record (alongside `./.kv/local.json` per the data model) of admitted slugs for a project. The injection engine refuses to decrypt any secret whose slug is not in this set, regardless of what a slot resolves to.

```ts
interface ProjectWorld {
  admitted: Set<string>; // slugs admitted into this project's sandbox
  has(slug: string): boolean;
  admit(slugs: string[]): void;
}
```

**`AuthProvider`.** The single choke point for proof-of-human-presence. The flow never admits without a successful `authenticate()`. Implementations wrap platform mechanisms; the mock is for tests.

```ts
interface AuthRequest {
  reason: string; // shown to the human, e.g. "Admit 3 secrets to acme-web"
  keys: ConfirmationItem[]; // value-free: slug, schema, fieldKeys, hasValue
}
interface AuthResult {
  ok: boolean;
  method: "touchid" | "os-password" | "passphrase" | "mock";
}
interface AuthProvider {
  authenticate(req: AuthRequest): Promise<AuthResult>;
}
```

**Admission flow.** Pure orchestration over the resolver, the confirmation-box builder, the `AuthProvider`, the project world, and the audit log. Batch: a request carrying N keys produces one `AuthRequest`, one `authenticate()` call, and (on `ok`) one atomic admit of all N. On `ok === false`, nothing is admitted and a `refused` audit entry is written. The agent path is structurally forced through this same function — there is no "admit without auth" code path.

**Injection engine (`kv run`).** Resolves each slot (Plan #3 strict 0/1/N) for the selected env, intersects against the project world, decrypts only needed values in memory via `@kv/crypto`, constructs the child env map (env-type → value; file-type → tmpfs path), spawns the child, pipes its stdout/stderr through the masking transform, and on exit shreds any materialized files. Plaintext is never written to disk; the parent process env is never mutated (values live only in the child's env).

**Masking.** A streaming transform that replaces any occurrence of an injected secret value (and file contents where feasible) with a fixed mask token in the child's stdout/stderr before it reaches the terminal/transcript.

**File materialize + shred.** Writes file-type secret contents to a `0600` file on tmpfs, returns the path for the env var, and registers a shredder that runs on child exit and on abnormal termination signals.

**Dry-run.** Produces a value-free report: the env-var names that _would_ be set, plus structured flags for duplicate inject names (the unique-inject-name invariant), open-unfilled slots, and ambiguous resolution. Never decrypts; never emits a value, not even masked.

**Audit log.** Append-only entries `{ ts, action: "admit"|"use"|"refused", project, slugs, method? }` — slugs and metadata only, never values.

**Agent-safe listing.** Projects Secrets and project-world state to `{ slug, schema, fieldKeys, tags, hasValue, admitted }` — the only shape any agent-facing caller receives.

---

## Tests that prove it — emphasizing the security properties

- **The agent cannot bypass admission.** With the mock `AuthProvider` configured to deny (the agent's situation: it cannot satisfy proof-of-presence), the admission flow admits nothing and the project world stays empty; there is no alternate code path that admits without a successful `authenticate()`.
- **Auth is mandatory and called exactly once per batch.** Admitting N keys triggers exactly one `authenticate()` call (asserted via the mock's call count) and, on success, admits all N atomically — proving batch one-auth-admits-all.
- **Refusal admits nothing.** When `authenticate()` returns `ok: false`, no slug enters the project world and a `refused` audit entry is recorded.
- **Injection isolation.** After `kv run`, the resolved value is present in the spawned child's environment but is **absent from the parent process's `process.env`** and from any on-disk artifact; the test inspects the child env (e.g. child echoes a marker proving it received the var) and asserts the parent never saw it.
- **Sandbox cannot be bypassed at run time.** A slot that resolves to a slug **not** in the project world causes `kv run` to refuse to decrypt/inject that secret (hard error), even though the secret exists in the global store.
- **Output masking.** A child that prints its injected secret value to stdout/stderr has that value replaced by the mask token before it reaches the captured output; the raw value never appears in what the parent/terminal sees.
- **File materialize-and-shred.** A file-type secret is materialized to a `0600` tmpfs path (permissions asserted), the path env var points at it, the child can read it during its lifetime, and after the child exits the temp file **no longer exists** (and is shredded, not merely unlinked-after-leak).
- **Dry-run contains NO values.** `--dry-run` output lists inject env-var **names** only; a test scans the entire output and asserts no secret value (and no masked-but-reconstructable value) appears, and asserts it correctly flags a duplicate inject name, an open-unfilled slot, and an ambiguous resolution.
- **Audit entries recorded.** Admissions, uses, and refusals each append a value-free audit entry; a test reads the log back and asserts the actions, slugs, and auth method are present and that no entry contains a secret value.
- **Agent-safe listing never leaks a value.** The agent-view projection of a fully-populated secret emits slug/schema/fieldKeys/tags/`hasValue`/`admitted` and a test asserts no field of the output equals any underlying secret value.
- **No-disk-write invariant.** Across a full `kv run`, a test asserts no plaintext value is written anywhere on disk except the explicitly-materialized `0600` tmpfs file, which is gone after exit.

---

## Out of scope / deferred

- **CLI command wiring** (`kv run`, `kv status`, the interactive chooser, `--dry-run` flag parsing, terminal rendering) — a later plan; this plan delivers the programmatic core surface only.
- **The Claude Code plugin** (skill + egress-warning hooks) — later plan.
- **End-to-end sharing, identity, devices, and the optional server** — later plans; admission and injection here are purely local.
- **The optional re-auth-per-use policy dial** (e.g. for service-role/prod keys) — noted as a future dial; default is no re-auth on `kv run`. This plan implements the default; the dial is deferred.
- **Optional `cd`/direnv-style hooks and eager resolution** — explicitly rejected for v1 (no daemon, no filesystem watcher); resolution stays lazy at run/status.
- **The Sets/Slots model, the store, and the strict 0/1/N resolver themselves** — delivered by Plan #3; consumed here.

## Open questions

- **Masking robustness.** How aggressively should masking handle values that the child transforms (base64/url-encodes/chunks across stream boundaries) before printing? A naive substring match misses encoded forms; we should decide the v1 guarantee (likely: exact-substring + cross-chunk buffering, with the honest documented limit that a transforming child can defeat masking).
- **tmpfs detection cross-platform.** macOS has no native tmpfs; what is the fallback for the `0600` materialized file on macOS (e.g. a `0700` dir under the OS temp dir) while keeping the shred-on-exit guarantee?
- **Shred semantics on a GC runtime / hard kill.** On `SIGKILL` the shredder cannot run; what is the documented residual and should we rely on OS tmpfs volatility as the backstop?
- **Audit log location and rotation.** Where does the audit log live (per-project vs per-user global), and what is its retention/rotation policy?
- **macOS LocalAuthentication binding.** Which mechanism invokes Touch ID from Node (native addon vs a bundled Swift helper vs `osascript`), and how do we keep it testable behind the `AuthProvider` seam?
