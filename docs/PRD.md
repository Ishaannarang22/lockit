# Product Requirements Document — `kv`

> Status: Draft (P0)
> Last updated: 2026-06-17
> License: Apache-2.0
> Working product name: **kv** (placeholder, renameable). CLI command: `kv`.

This is the master Product Requirements Document for **kv**, an open-source, local-first, AI-agent-safe developer secrets manager.

For the deeper security material this document references:

- Threat model: [`threat-model.md`](./threat-model.md)
- Cryptographic design ("OrgMesh"): [`security-crypto.md`](./security-crypto.md)

---

## 1. Overview / Vision

`kv` is an open-source, local-first developer secrets manager that you can run entirely on your own machine, with an **optional** self-hosted server for syncing and sharing within a team. It needs no account and no third-party service to use locally.

The vision rests on three core ideas:

1. **Set a key once, reuse it everywhere.** Store a secret a single time and reference it from any project with zero copy-paste.
2. **AI agents can _use_ secrets without ever _seeing_ them.** Values flow from the vault into a child process in memory; they never enter an agent's context or transcript.
3. **Share encrypted to your other devices and teammates.** End-to-end encryption means the relay only ever holds ciphertext.

`kv` is the universal interface for both humans and agents: one CLI binary that a person types into and that any shell-capable agent can drive.

---

## 2. Problem & Target Users

### 2.1 The problem

Developers lose enormous time on two distinct pains:

1. **Hunting and copy-pasting API keys** across projects and throwaway prototypes. The same OpenAI or Supabase key gets re-pasted into dozens of `.env` files, each a slightly stale copy of the last.
2. **Secrets leaking** into AI-agent context and transcripts, shell history, `.env` files, and casual channels (chat, tickets, screenshots). Once a value has been seen, it cannot be un-seen.

The structural root cause for reuse is that `.env`-style storage is keyed by **environment-variable name**, so two projects that both want a `SUPABASE_URL` collide. `kv` keys storage by a portable **slug** instead, which removes the collision by construction.

### 2.2 Target users

- **Individual developers** juggling many projects and prototypes who want one source of truth for their keys.
- **Prototypers** spinning up short-lived projects who want a key available instantly without re-pasting.
- **Small teams** who want to share secrets end-to-end over a channel they control, without handing plaintext to a third party.

---

## 3. Goals & Non-goals

### 3.1 Goals

- Local-first: fully usable offline with no account and no external service.
- One-time storage of a secret, referenced (not copied) by any number of projects.
- A strict, never-guessing resolver so the right value is always chosen deterministically.
- Agent-safe by design: agents orchestrate but never see values.
- Human-gated admission of secrets into a project, backed by local presence auth.
- Injection of secrets into child processes in memory only, with masking and shredding.
- Support for env-type and file-type secrets, and per-environment (dev/staging/prod) selection.
- Optional self-hosted end-to-end sync/sharing server for a team, where the operator can never decrypt.

### 3.2 Non-goals

- **No account recovery in this version.** If you lose your passphrase **and** all your devices, your data cannot be recovered. This is an intentional, documented limitation of true zero-knowledge encryption. See the recovery trilemma in [`security-crypto.md`](./security-crypto.md): you cannot simultaneously have no-backdoor, loss-proof, and zero-extra-trust.
- **No forward secrecy at rest.** A leaked long-term key is retroactive over the data it can reach. This is inherent to durable, random-access storage and is why messaging-style ratchets were rejected.
- **Metadata is visible to a server operator.** Names, sizes, and the who-shares-with-whom graph are visible to whoever runs the self-hosted server, even though values never are.
- **Containment is not omnipotence.** A child process using a secret necessarily holds the real value, so a rogue or confused agent could still exfiltrate it through a command it runs. `kv` minimizes and gates exposure; it does not claim to make exfiltration impossible.
- **No guaranteed memory zeroing.** Node cannot guarantee wiping secrets from memory because of garbage collection; `kv` minimizes plaintext lifetime but cannot promise a wipe.
- **MCP is dropped from v1.** Security lives in the CLI, which is universal; a skill is Claude Code sugar over the CLI. MCP may return later only as an optional thin adapter over `core` to reach hosts that cannot run a shell.

---

## 4. Personas & Top User Stories

### 4.1 Personas

- **Dana, the solo developer.** Runs ten projects locally. Wants `openai/dev` available in every one without re-pasting and without leaking it into shell history.
- **Priya, the prototyper.** Spins up a new app daily. Wants to declare "I need a Supabase backend" and have her local key fill the slot automatically.
- **The small team (Sam + Riya).** Want to share a genuinely shared piece of infrastructure end-to-end, over a channel they control, with no plaintext ever leaving a device.
- **Claude (the agent).** Drives `kv` on the user's behalf. Must be able to request and use secrets, but must never be able to read a value or bypass the human gate.

### 4.2 Top user stories

- As a developer, I store `openai/dev` once and reference it from every project, so rotating it once updates all consumers.
- As a developer, I run `kv run -- <cmd>` and my program gets its env vars set for its lifetime, with nothing written to disk.
- As a developer using an agent, I am shown a single confirmation box listing exactly which keys the agent is requesting, and I approve them with one local-auth prompt.
- As a developer, I declare a project's requirements as value-free slots committed to git, so a teammate who clones the repo sees what is needed but no values.
- As a prototyper, I declare an `open` Supabase slot and have my single matching local secret auto-resolved and named back to me.
- As a team member, I share a secret end-to-end to a teammate over any channel, and the relay only ever holds ciphertext.

---

## 5. Scope

`kv` is a local-first CLI (`packages/cli`) built on a pure cryptographic core (`packages/crypto`) and application logic (`packages/core`), with an optional self-hosted team server (`packages/server`) and a Claude Code plugin (`plugin/`).

**In scope for v1:**

- The local global store and the Sets + Slots data model.
- The project-world sandbox and human-gated admission with local auth.
- `kv run` injection for both env-type and file-type secrets.
- Per-environment (dev/staging/prod) selection.
- Agent-safe output and verification (`--dry-run`).
- End-to-end identity, sharing artifacts, and the optional self-hosted team server (Key Transparency, OPAQUE login).

**Out of scope for v1:** account recovery; MCP; the honest security non-goals listed in §3.2.

---

## 6. Feature Requirements

### 6.1 Global store and Sets + Slots

The **global store** holds **secrets**. A secret is a typed bag of one or more **fields**, identified by:

- a portable human **slug** (e.g. `openai/dev`, `supabase/acme`), and
- a **schema** (e.g. `openai`, `supabase`).

A singleton (one OpenAI key) is a Set with **one** field. A Supabase backend is a Set with **three** fields (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

Requirements:

- The store is **keyed by slug, not by env-var name.** Therefore `supabase/acme` and `supabase/blog` can both contain a field named `SUPABASE_URL` with zero collision. This is the central problem the model solves, structurally.
- Secrets are **rename-safe** via an `aka` alias list.
- A `localId` is a machine-local convenience only and is **never committed**.
- **Schemas** come from a built-in registry of known providers (with field shapes for completeness checks and autocomplete) **plus** free strings for unknown providers.

#### Project vaults (value-free slots)

The **project vault** (committed, e.g. `./.kv/vault.json`) is **value-free**: a list of **slots** (requirements). A slot is:

```
{ schema, bind: pinned | open, to: slug-or-null, inject: { fieldKey -> EXACT_ENV_VAR_NAME } }
```

- **`pinned`** means the slot must resolve to exactly that slug — genuinely shared infrastructure.
- **`open`** means any secret of this schema that the developer supplies locally — per-developer or per-project backends.
- Slots are **references, not copies**: a single source of truth, so you rotate once and all consumers update.
- **Opt-in bundling** is available for standalone or offline projects.

A **local resolution cache** (gitignored, e.g. `./.kv/local.json`) records how `open` slots are filled on **this** machine.

#### The resolver (strict 0 / 1 / N, never guesses)

- An **exact slug** is used directly.
- **Exactly one** match resolves.
- **More than one** match is a hard, structured **ambiguous** error with a value-free, numbered chooser.
- **Zero** matches is `missing` or `open-unfilled`.

There are **no label heuristics** that could silently pick the wrong value.

#### One-value-many-names invariant

The `inject` map lets any field map to any env-var name, and multiple names can map to one field (e.g. `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `VITE_SUPABASE_URL` all from one field).

**Invariant:** the union of injected env-var names within a single vault must be unique. A duplicate is a **hard error** at link time and at `run --dry-run`.

### 6.2 Project-world sandbox and human-gated admission

A project can only use keys that have been **admitted** to its **project world**. The global store is the protected source; the project world is a sandbox. The agent can **never** pull from the global store directly — it can only **request** admission.

- Every admission requires **human confirmation plus local auth** (Touch ID / OS password / biometric) — proof of human presence that the agent cannot satisfy. On macOS this uses LocalAuthentication / Touch ID; the fallback is the OS keychain or password; the demo can use a passphrase prompt.
- **Auth happens once, at admission.** There is **no re-auth** on later `kv run`. Re-auth-per-use is an optional policy dial (e.g. for service-role or prod keys), not the default.
- **Batch admission:** admitting several keys at once shows **all** of them in one confirmation box, and a single auth admits the whole batch.
- After admission, keys **auto-resolve on use**. When an `open` slot has exactly one matching secret, it is auto-resolved **and the chosen secret is printed** ("auto-fill but tell me"). The first admission still passes the confirm-and-auth gate.
- Resolution triggers **lazily** at `kv run` / `kv status` — never on `git clone`. There is **no daemon** and **no filesystem watcher** (an optional opt-in direnv-style `cd` hook may come later).

### 6.3 `kv run` injection (file-based and per-environment)

`kv run`:

- decrypts the needed secrets **in memory only**,
- spawns the child process with env vars set **for its lifetime**,
- **masks** all secret values in the child's stdout/stderr,
- writes **nothing to disk**, and
- **shreds on exit**.

**File-type secrets:** a field is `type=env` (a string injected as an env var) **or** `type=file` (contents materialized to a temp file on tmpfs with `0600` permissions; an env var points to the path; shredded on process exit). Canonical example: a Google service-account JSON consumed via `GOOGLE_APPLICATION_CREDENTIALS`.

**Per-environment:** an optional secondary environment axis (dev / staging / prod). The default is single-context; opt in when needed.

**`kv run --dry-run`** prints the env-var **names** that will be set (values masked) and flags duplicate inject names, unfilled `open` slots, and ambiguous resolution. This is the agent-safe verification primitive.

### 6.4 Agent-safety

- All agent-facing output (`list`, `status`, `--dry-run`, chooser) emits **only** slugs, schemas, field-names, tags, and `hasValue` booleans — never a value, **not even masked**.
- **Ambiguity is a hard, structured error** the model cannot resolve by guessing.
- The model **orchestrates**; values flow from the vault to the child process in memory and never enter the model context or the transcript.

**Honest limits (documented, not hidden):**

- A child process inevitably holds the real value (it is using it), so a rogue or confused agent could still exfiltrate it via a command it runs. Containment is not omnipotence.
- Mitigations: human-gated admission (the biggest), an audit log, and egress warnings via a plugin hook.
- Node cannot guarantee zeroing secrets from memory because of garbage collection; `kv` minimizes plaintext lifetime but cannot promise a wipe.

See [`threat-model.md`](./threat-model.md) for the full treatment.

#### The Claude Code plugin

`plugin/` is the Claude Code plugin: skill(s) plus hooks. It teaches agent-safe `kv` usage and adds guardrails — for example, a hook that warns if a raw secret is about to be written into a file or command. It depends on the `kv` CLI.

### 6.5 Sharing (end-to-end)

Sharing is end-to-end encrypted; the relay only ever holds ciphertext. The cryptographic model is **OrgMesh** (full detail in [`security-crypto.md`](./security-crypto.md)). Behavioral requirements:

- **Share to a teammate:** references are resolved, the per-item DEK is wrapped to the recipient's identity key (resolved via Key Transparency with TOFU pinning), the artifact is signed, and ciphertext is relayed. The recipient unwraps locally.
- **Default on accept is create-new, never auto-merge,** suffixing on a slug clash.
- **Honest tradeoff:** a share is a **point-in-time copy**; later rotation does **not** auto-propagate unless re-shared.
- **Multi-device:** a new device generates its own key; an existing trusted device verifies a short authenticated code and signs the new device into the sigchain.
- **Rotate / revoke:** rotation re-wraps only to current readers; ACL removal alone is **not** revocation — true revocation requires rotating the relevant seeds and the upstream value. Crypto cannot un-leak already-seen plaintext.

### 6.6 The optional self-hosted team server

`packages/server` is an **optional** self-hosted end-to-end sync/sharing server for a team. It is a **relay that only ever holds ciphertext.** It supports members, devices, sharing, a shared team vault, **Key Transparency**, and **OPAQUE login**.

The server stores **only**: ciphertext and version history, public keys, never-unwrapped wrapped key material, salts, the OPAQUE record, the Key Transparency log and per-user sigchains, and access-control metadata. It **never** stores any passphrase, private key, seed, DEK, or plaintext. **There is no operator master key.**

**Key Transparency** ships in v1 as a signed, append-only log of email-to-identity-key mappings, with client auto-self-audit (inclusion and consistency proofs) and TOFU pinning on first share. Independent gossip witnesses for anti-equivocation follow later.

---

## 7. Security Posture Summary

- **Client-side envelope encryption.** All encryption and decryption is client-side. The optional server is a dumb, append-only encrypted store-and-relay; **the server operator can never decrypt.**
- **Human-gated admission with local presence auth** is the primary defense against an agent pulling secrets it should not have.
- **In-memory injection, output masking, and shredding** minimize plaintext exposure during use.
- **Agent-safe outputs** ensure the model never receives a value.
- **Honest non-goals** (no account recovery, no forward secrecy at rest, visible metadata, containment limits, no guaranteed memory zeroing) are stated plainly rather than hidden.

For the full attacker model and mitigations, see [`threat-model.md`](./threat-model.md). For primitives, the key ladder, envelope format, and flows, see [`security-crypto.md`](./security-crypto.md).

---

## 8. Success Criteria

- A developer can store a secret once and reference it from multiple projects with zero copy-paste, and rotating once updates all consumers.
- `kv run` injects the correct values into a child process, masks them in output, writes nothing to disk, and shreds on exit — verified by tests for injection isolation and output masking.
- The resolver is provably strict 0/1/N: it never silently picks a wrong value, and ambiguity is always a hard structured error.
- An agent can drive the full flow (request, dry-run, run) without any value entering its context or transcript — verified by the "agent-never-sees-a-value" property test.
- Admission cannot be completed without human confirmation and local auth — verified by the "sandbox-cannot-be-bypassed" property test.
- The one-value-many-names invariant is enforced at link time and at `--dry-run`.
- For the team server, the operator can never decrypt; round-trip and tamper-detection tests pass for the OrgMesh envelope.

---

## 9. Phasing Summary (P0–P4)

All phases below are committed in this PRD; they define build order.

- **P0** — Monorepo scaffold, this documentation set, and governance files.
- **P1** — `crypto` + `core` + `cli`: the local global store, Sets + Slots, the project-world sandbox, human-gated admission with local auth, `kv run` injection (env and file types), and per-environment. The daily driver, no server needed.
- **P2** — The Claude plugin (skill + hooks): agent-safe reuse and the admission flow.
- **P3** — Identity and end-to-end sharing crypto: device enrollment and shareable encrypted artifacts that work over any channel.
- **P4** — The optional self-hosted team server: sync/sharing relay, members and devices, the team vault, Key Transparency, and OPAQUE login.

Account recovery is future work beyond v1.

The detailed step-by-step implementation plan is produced separately, after this documentation set. The implementation philosophy is to build in very small, independently testable increments using TDD — write a failing test first, implement the minimum to pass, and verify each step in isolation. This is a security product: never trade security for speed.

---

## 10. Open Questions & Risks

### Open questions

- **Rename of the working name `kv`.** The product name is a placeholder; the final name and any binary-name collisions need resolving before a public release.
- **Per-use re-auth policy surface.** How granular should the optional re-auth-per-use dial be (per-schema, per-slug, per-tag), and what is the default policy template for sensitive keys such as service-role and prod?
- **direnv-style `cd` hook.** Whether and how to ship the optional opt-in directory hook later without reintroducing a daemon or watcher.
- **Gossip witnesses for Key Transparency.** The deployment story for independent witnesses in a self-hosted setting.
- **MCP adapter.** Whether demand from non-shell AI hosts justifies a future optional thin adapter over `core`.

### Risks

- **Agent exfiltration via the child process.** A child holds the real value; a rogue or confused agent could exfiltrate through a command it runs. Mitigated by human-gated admission, audit logging, and egress-warning hooks, but not eliminated.
- **Memory zeroing.** Node's garbage collection prevents a guaranteed wipe of plaintext from memory.
- **Lost passphrase and devices.** Without account recovery in this version, loss of the passphrase and all devices is unrecoverable. This must be communicated clearly in onboarding.
- **Metadata exposure.** A self-hosted server operator can see names, sizes, and the sharing graph.
- **Stale shares.** A share is a point-in-time copy; rotation does not auto-propagate, risking consumers holding outdated values until re-shared.
- **Revocation is not retroactive.** Crypto cannot un-leak already-seen plaintext; revocation must be paired with upstream key rotation.
