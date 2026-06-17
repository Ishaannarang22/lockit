# 7. Project-world sandbox + human-gated admission

## Status

Accepted

## Context

Secrets leak into AI-agent context and transcripts, shell history, `.env` files,
and casual channels. A core goal of **kv** is that **AI agents can use secrets
without ever seeing them**. That requires two things working together: a way to
scope which secrets a project may touch, and a gate that an agent cannot pass on
its own. We must also be honest about the limits of any such containment.

## Decision

Introduce a **project-world sandbox** with **human-gated admission**.

**Sandbox.** A project can only use keys that have been **admitted** to its
project world. The global store is the protected source; the project world is a
sandbox. The agent can **never** pull from the global store directly; it can
only **request** admission.

**Human-gated admission.** Every admission requires **human confirmation** plus
**local auth** (Touch ID / OS password / biometric) — proof of human presence
that the agent cannot satisfy. macOS uses LocalAuthentication / Touch ID; the
fallback is the OS keychain or password; the demo can use a passphrase prompt.

**Auth happens once at admission.** Batch: admitting several keys at once shows
**all** of them in one confirmation box, and a single auth admits the whole
batch. There is **no re-auth** on later `kv run` (re-auth-per-use is an optional
policy dial — for example for service-role or prod keys — not the default).

**Auto-resolve after admission.** When an open slot has exactly **one** matching
secret it is auto-resolved **and the chosen secret is printed** ("auto-fill but
tell me"). First admission still passes the confirm and auth gate. Resolution
triggers **lazily** at `kv run` / `kv status` — never on `git clone`. There is
**no daemon and no filesystem watcher** (an optional opt-in direnv-style `cd`
hook may come later).

**Injection (`kv run`).** `kv run` decrypts the needed secrets **in memory
only**, spawns the child process with env vars set for its lifetime, **masks**
all secret values in the child's stdout/stderr, writes nothing to disk, and
shreds on exit. File-type secrets materialize a temp file, set the path env var,
and shred it. `kv run --dry-run` prints the env-var **names** that will be set
(values masked) and flags duplicate inject names, unfilled open slots, and
ambiguous resolution — the agent-safe verification primitive.

**Agent-safe output.** All agent-facing output (`list`, `status`, `dry-run`,
chooser) emits only slugs, schemas, field-names, tags, and `hasValue` booleans —
never a value, not even masked. Ambiguity is a hard structured error the model
cannot resolve by guessing. The model orchestrates; values flow from the vault
to the child process in memory and never enter the model context or the
transcript.

## Consequences

**Positive**

- The biggest mitigation in the product: an agent cannot exfiltrate from the
  global store because it cannot satisfy the human-presence gate.
- Values never enter model context or the transcript; agents work with slugs and
  booleans.
- `kv run --dry-run` lets an agent verify what will happen without seeing any
  value.
- Batch admission with single auth keeps the human gate from becoming friction;
  no re-auth on every run.
- Lazy resolution and no daemon/watcher keep the attack surface and footprint
  small.

**Negative / honest limits (documented, not hidden)**

- A child process inevitably holds the real value (it is using it), so a rogue
  or confused agent could still exfiltrate via a command it runs.
  **Containment is not omnipotence.** Mitigations are human-gated admission (the
  biggest), an audit log, and egress warnings via a plugin hook.
- Node cannot guarantee zeroing secrets from memory because of garbage
  collection; we minimize plaintext lifetime but cannot promise a wipe (see
  [ADR 0001](0001-language-typescript.md)).
- The optional re-auth-per-use policy dial trades convenience for stronger
  control on sensitive keys; it is off by default, so the default favors flow.

## Alternatives considered

- **Let agents read the global store directly** — fastest, but it is exactly the
  leak we exist to prevent. Rejected.
- **No human gate (software-only admission)** — an agent could self-admit,
  nullifying the protection. Rejected in favor of mandatory local presence auth.
- **A daemon or filesystem watcher for eager resolution** — convenient, but it
  enlarges the attack surface and resolves secrets without an explicit trigger.
  Rejected for v1; lazy resolution at `kv run`/`kv status` only, with an
  optional `cd` hook possibly later.
- **Masked values in agent output** — still leaks structure and tempts
  reconstruction; we emit no values at all to agents, not even masked.
