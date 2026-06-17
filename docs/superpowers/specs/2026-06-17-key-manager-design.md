# kv — Consolidated Design Spec

> Status: Canonical design record (committed brainstorming output)
> Date: 2026-06-17
> Project: `key_manager` (open source) · CLI command: `kv` · License: Apache-2.0
> Stack: TypeScript / Node, pnpm monorepo

This document is the single reference other sessions, contributors, and agents
read to understand what `kv` is, why it is shaped the way it is, and how the
pieces fit together. It captures the **entire public design** as a coherent
narrative. The step-by-step implementation plan is produced separately, after
this documentation set.

> Note on the name: `kv` is a working placeholder and may be renamed. The CLI
> binary and product are referred to as `kv` throughout for consistency.

---

## 1. Vision and the problem

`kv` is an open-source, **local-first, AI-agent-safe developer secrets
manager**. It targets two concrete, everyday pains:

1. **Copy-paste sprawl.** Developers waste enormous time hunting for and
   copy-pasting API keys across projects, prototypes, and machines. The same
   OpenAI key ends up duplicated in a dozen `.env` files, each one a separate
   thing to rotate and a separate place to leak.

2. **Secret leakage into the wrong places.** Secrets leak into AI-agent context
   and transcripts, shell history, `.env` files, and casual channels (chat,
   tickets, pastebins). Once a value is pasted into one of these, it is
   effectively public.

The core ideas that drive the whole design:

- **Set a key once, reuse it everywhere** — across projects and prototypes with
  zero copy-paste.
- **AI agents can USE secrets without ever SEEING them.** The agent orchestrates
  work; values flow from the vault into a child process in memory and never
  enter the model context or the transcript.
- **Share secrets encrypted** to your other devices and to teammates, end to
  end, over any channel.

`kv` needs no account and no third-party service to be useful locally. An
optional self-hosted server adds end-to-end sync and sharing for a team.

---

## 2. Scope and limitations

**In scope:** a local-first CLI with an optional self-hosted server that lets a
team sync and share secrets end-to-end. It works fully offline and locally with
no account and no external dependency.

**An honest, documented limitation — account recovery is not in this version.**
If you lose your passphrase and all of your devices, your data cannot be
recovered. This is the inherent cost of true zero-knowledge encryption: there is
no backdoor and no operator who can let you back in, because no operator ever
holds anything that could. We state this plainly rather than hide it. Account
recovery is future work beyond v1 (see [§12 Phasing](#12-phasing-p0p4)).

---

## 3. Product decisions

These are the decisions that shape the surface area of v1.

- **The CLI is the universal interface** for both humans and agents. Anything an
  agent can do, it does through the same `kv` commands a human would run.
- **References, not copies.** A project declares which secrets it needs; it does
  not embed their values. There is a single source of truth — rotate once and
  all consumers see the new value.
- **The store is keyed by a portable human slug, not by env-var name.** This is
  what structurally eliminates the classic collision where two projects both
  want a variable named `SUPABASE_URL`.
- **The resolver never guesses.** Resolution is strict 0/1/N. Ambiguity is a
  hard, structured error with a value-free chooser, never a silent best-guess.
- **Per-environment (dev/staging/prod) is in scope for v1**, but optional: the
  default is single-context, and you opt in when you need an environment axis.
- **File-based secrets are in scope for v1** (e.g. a Google service-account JSON
  materialized to a temp file).
- **MCP is dropped from v1** (see [§10](#10-package-architecture)).
- **Account recovery is out of scope for v1** (see [§2](#2-scope-and-limitations)).

---

## 4. Data model: "Sets + Slots"

The data model is the heart of `kv`. It cleanly separates **what secrets exist**
(the global store, which holds values) from **what a project requires** (the
project vault, which holds no values).

### 4.1 The global store holds SECRETS

A **secret** is a typed bag of one or more **fields**, identified by:

- a portable, human **slug** — examples: `openai/dev`, `supabase/acme`; and
- a **schema** — examples: `openai`, `supabase`.

A singleton (one OpenAI key) is a Set with **one** field. A Supabase backend is
a Set with **three** fields: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

**The store is keyed by slug, not by env-var name.** This is the central problem
the model solves, structurally: `supabase/acme` and `supabase/blog` can BOTH
contain a field named `SUPABASE_URL` with zero collision, because the store
indexes by slug, never by the variable name a field happens to use.

Supporting details:

- **Rename-safe** via an `aka` alias list — a slug can be renamed without
  breaking references that used the old name.
- **`localId`** is a machine-local convenience identifier only. It is **never
  committed**.

### 4.2 Schemas

Schemas come from a **built-in registry of known providers** (each with field
shapes used for completeness checks and autocomplete) **plus free strings** for
unknown providers. You are never blocked from storing a secret just because its
provider is not in the registry.

### 4.3 The project vault holds SLOTS (and no values)

The **project vault** (committed, e.g. `./.kv/vault.json`) is **value-free**. It
is a list of **slots** — requirements the project declares. A slot looks like:

```jsonc
{
  "schema": "supabase",
  "bind": "pinned",          // "pinned" | "open"
  "to": "supabase/acme",     // slug, or null when open
  "inject": {                // fieldKey -> EXACT env-var name(s)
    "url": "SUPABASE_URL",
    "anonKey": "SUPABASE_ANON_KEY",
    "serviceRoleKey": "SUPABASE_SERVICE_ROLE_KEY"
  }
}
```

- **`bind: pinned`** means the slot must resolve to exactly that slug — for
  genuinely shared infrastructure that every developer should use.
- **`bind: open`** means any secret of this schema that the developer supplies
  locally — for per-developer or per-project backends.

Because the vault holds references rather than copies, there is a single source
of truth: rotate a secret once and every consuming project picks it up.

**Opt-in bundling** is available for standalone or offline projects that need to
carry their values with them.

### 4.4 The resolver: strict 0 / 1 / N, never guesses

Given a slot, the resolver behaves deterministically:

- **Exact slug** (pinned `to`) → that secret is used.
- **Exactly one** matching secret of the schema → it resolves.
- **More than one** match → a **hard, structured `AMBIGUOUS` error** with a
  value-free, numbered chooser. The resolver never picks for you.
- **Zero** matches → **missing** (pinned) or **open-unfilled** (open).

There are **no label heuristics** that could silently pick a wrong value. This
strictness is what makes the model safe to drive from an automated agent.

### 4.5 Per-environment axis

Per-environment (dev / staging / prod) is an **optional secondary axis** in v1.
The default is single-context; you opt into the environment axis only when a
project genuinely needs it.

### 4.6 Field types: env and file

A field is one of two types:

- **`type=env`** — a string injected as an environment variable.
- **`type=file`** — contents materialized to a temp file on tmpfs with `0600`
  permissions; an env var points at the path; the file is shredded on process
  exit. Canonical example: a Google service-account JSON consumed via
  `GOOGLE_APPLICATION_CREDENTIALS`.

### 4.7 One value, many names

The `inject` map lets any field map to any env-var name, and **multiple names
can map to one field** — for example `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
and `VITE_SUPABASE_URL` all pointing at the same field.

**Invariant:** the union of injected env-var names within a single vault must be
**unique**. A duplicate is a **hard error** at link time and at
`kv run --dry-run`.

### 4.8 Local resolution cache

A **local resolution cache** (gitignored, e.g. `./.kv/local.json`) records how
**open** slots were filled on **this machine**. It is per-machine state and is
never committed.

---

## 5. The project-world sandbox and human-gated admission

This is the core security UX of `kv`.

### 5.1 The sandbox

The **global store is the protected source**. A **project world** is a sandbox.
**A project can only use keys that have been ADMITTED into its project world.**
The agent (for example Claude) can **never** pull from the global store
directly — it can only **request** admission. The protected store sits behind a
gate the agent cannot open on its own.

### 5.2 Human-gated admission

Every admission requires **two things together**:

1. **Human confirmation** (you explicitly approve), and
2. **Local auth** — Touch ID / OS password / biometric — proof of human
   presence that an agent cannot satisfy.

On macOS this uses **LocalAuthentication / Touch ID**; the fallback is the OS
keychain or a password; a demo can use a passphrase prompt.

### 5.3 Auth happens once, with batching

- **Auth happens once, at admission.** There is **no re-auth on later
  `kv run`.**
- **Batch admission:** admitting several keys at once shows **all** of them in a
  single confirmation box, and **one** auth admits the whole batch.
- **Optional re-auth-per-use** is a policy dial (for example for service-role or
  prod keys). It is **not** the default.

### 5.4 After admission

- Keys **auto-resolve on use** once admitted.
- **Auto-fill but tell me:** when an open slot has exactly **one** matching
  secret, it is auto-resolved **and** the chosen secret slug is printed, so the
  choice is visible.
- The **first** admission still passes the confirm-and-auth gate.

### 5.5 Lazy, no daemon

Resolution triggers **lazily** at `kv run` / `kv status` — **never on
`git clone`**. There is **no daemon and no filesystem watcher**. (An optional,
opt-in direnv-style `cd` hook may come later.)

---

## 6. Injection — `kv run`

`kv run` is the execution primitive. It:

- decrypts the needed secrets **in memory only**;
- spawns the child process with the env vars set **for the lifetime of that
  child**;
- **masks** all secret values in the child's stdout/stderr;
- **writes nothing to disk**; and
- **shreds on exit**.

For **file-type** secrets, it materializes a temp file, sets the path env var,
and shreds the file on exit.

`kv run --dry-run` is the **agent-safe verification primitive**. It prints the
env-var **names** that will be set (values masked) and flags:

- duplicate inject names,
- unfilled open slots, and
- ambiguous resolution.

---

## 7. Agent-safety and its honest limits

### 7.1 What is guaranteed

All agent-facing output — `list`, `status`, `--dry-run`, the chooser — emits
**only** slugs, schemas, field-names, tags, and `hasValue` booleans. **Never a
value, not even masked.** Ambiguity surfaces as a hard, structured error the
model cannot resolve by guessing. The model **orchestrates**; values flow from
the vault into the child process **in memory** and never enter the model context
or the transcript.

### 7.2 Honest limits (documented, not hidden)

- **A child process inevitably holds the real value** — it is using it. So a
  rogue or confused agent could still exfiltrate a secret via a command it runs.
  **Containment is not omnipotence.**
- **Mitigations:** human-gated admission (the biggest lever), an **audit log**,
  and **egress warnings** via a plugin hook.
- **Node cannot guarantee zeroing secrets from memory** because of garbage
  collection. We minimize plaintext lifetime but **cannot promise a wipe**.

We document these limits so users can reason accurately about their threat
model.

---

## 8. Crypto architecture — "OrgMesh"

### 8.1 Model

**Client-side envelope encryption.** The optional server is a **dumb,
append-only encrypted store-and-relay**; the **server operator can never
decrypt**. All encryption and decryption happen client-side.

### 8.2 Primitives

- **X25519** — ECDH key wrap.
- **Ed25519** — signatures and the device sigchain.
- **XChaCha20-Poly1305** — AEAD payload sealing.
- **HPKE (RFC 9180)** with **DHKEM(X25519) + HKDF-SHA256 + ChaCha20-Poly1305**
  in **Auth mode** — wrapping seeds and DEKs to public keys.
- **HKDF-SHA256** — subkey/seed expansion via the **seed-triple trick**: one
  32-byte seed expands to an Ed25519 key, an X25519 key, and an optional
  symmetric key.
- **Argon2id** — passphrase to key.
- **OPAQUE** — login so the server never sees a password-equivalent.

### 8.3 Key ladder (client-only)

- **MasterKEK** = `Argon2id(passphrase, saltA)`.
- **AccountKey AK** = `HKDF(MasterKEK XOR HKDF(SecretKey))`, where **SecretKey**
  is an **optional** 128-bit locally-generated second factor (passkey- or
  hardware-token-backed) that makes a stolen server blob non-brute-forceable
  even from a weak passphrase.
- **Device key DK** — a per-device key whose private half **never leaves the
  device**.
- **User Identity Seed (UIS)** → expands to the **user identity key (UIK)**. UIK
  has exactly one job: to **unwrap a small set of seeds**. This makes identity
  rotation cost **O(devices + memberships)** rather than O(secrets).
- **Personal-Vault Seed (PVS)** → expands to **PVK**; personal DEKs wrap to PVK.
  **PVS is hard-excluded from any sharing-to-others.**
- **Org/Team Seed** → expands to a **team key**; per member, the seed is
  **HPKE-sealed to the member's UIK public key** — this is the **team sharing
  boundary**.
- **Per-item DEK** (random per secret/version) seals the payload as
  `XChaCha20-Poly1305(value, DEK)`; the DEK is wrapped **per authorized reader**
  (to a team key and/or an individual UIK).

### 8.4 Envelope format (age-style)

Each sealed item is:

- a list of **recipient stanzas** `{ recipient pubkey id, HPKE-wrapped DEK }`;
- an **Ed25519 sender signature** over the stanza set;
- a **header HMAC** keyed from the DEK; and
- the **AEAD payload**.

The **signature** gives sender authentication (no impersonation injection); the
**header HMAC** makes tampering with the recipient set detectable.

### 8.5 What the server stores (and never stores)

The server stores **only**: ciphertext and version history, **public** keys,
never-unwrapped wrapped key material, salts, the OPAQUE record, the Key
Transparency log and per-user sigchains, and access-control metadata.

It **never** stores any passphrase, private key, seed, DEK, or plaintext.
**There is no operator master key.**

### 8.6 Flows

- **Enroll** — generate the device key, UIS, and PVS; upload public keys plus
  wrapped blobs plus the OPAQUE registration; publish UIK to the Key
  Transparency log.
- **Multi-device** — the new device generates its own key; an existing trusted
  device verifies a short authenticated code, signs the new device into the
  sigchain, and wraps UIS to it.
- **Share to a teammate** — resolve references, wrap the DEK to the recipient's
  UIK public key (resolved via Key Transparency with **TOFU pinning**),
  Ed25519-sign, relay ciphertext; the recipient unwraps. Default on accept is
  **create-new, never auto-merge**, suffixing on a slug clash. **Honest
  tradeoff:** a share is a **point-in-time copy**; later rotation does not
  auto-propagate unless re-shared.
- **Team-join** — an existing member wraps the team seed to the new member's UIK
  **once, O(1)**, granting history.
- **Rotate a value** — fresh DEK, wrap only to current readers; removed parties
  are absent; old versions are garbage-collected. **Crypto cannot un-leak
  already-seen plaintext**, so pair with upstream key rotation.
- **Revoke** — rotate the team seed to survivors **O(survivors)**, lazily
  re-wrap DEKs, rotate the upstream value. **ACL removal alone is not
  revocation** — we state this honestly.

### 8.7 Key Transparency

An **append-only signed log** of email-to-UIK mappings. Clients auto-verify
**inclusion and consistency proofs** and **TOFU-pin** a contact on first share.
**Independent gossip witnesses** provide anti-equivocation even when
self-hosted.

**v1 ships:** the signed log, auto-self-audit, and TOFU pinning. **Gossip
witnesses follow.**

### 8.8 Honest non-goals (documented)

- **No forward secrecy at rest.** A leaked long-term key is retroactive over the
  data it can reach. This is inherent to durable, random-access storage and is
  why messaging-style ratchets were rejected.
- **Metadata is visible to a server operator** — names, sizes, the
  who-shares-with-whom graph — even though **values never are**.
- **No account recovery in this version.** The recovery trilemma: you cannot
  simultaneously have no-backdoor, loss-proof, and zero-extra-trust.

### 8.9 Recommended libraries

`@hpke/core`, `@hpke/dhkem-x25519`, `@hpke/chacha20poly1305`,
`libsodium-wrappers-sumo`, `sodium-native`, `hash-wasm`, `argon2`,
`@serenity-kit/opaque`, `@noble/curves`, `@noble/ciphers`, `@noble/hashes`,
`age-encryption`, and `@transparency-dev/merkle` (for Key Transparency).

---

## 9. Package architecture (pnpm monorepo)

| Package | Responsibility |
| --- | --- |
| **`packages/crypto`** | The cryptographic **trust root** — envelope encryption, key hierarchy, HPKE, signatures, zero-knowledge primitives. Tiny, pure, **no I/O**, independently auditable. Includes a generic **wrap-a-seed-to-any-public-key** primitive that future features can build on. |
| **`packages/core`** | The application logic: **vault** (the Sets+Slots data model, the project-world sandbox), **store** (encrypted at-rest persistence — the global store plus per-project vaults), and **auth/admission gating** (local presence auth). |
| **`packages/cli`** | The **`kv` binary** — the universal human **and** agent interface. |
| **`packages/server`** | An optional **self-hosted end-to-end sync/sharing server** for a team — members, devices, sharing, a shared team vault, Key Transparency, and OPAQUE login. A **relay that only ever holds ciphertext**. |
| **`plugin/`** | The **Claude Code plugin** — skill(s) + hooks. Teaches agent-safe `kv` usage; hooks add guardrails (for example, warn if a raw secret is about to be written into a file or command). Depends on the `kv` CLI. |
| **`docs/`** | Documentation (this spec lives here). |

Dependency direction flows inward toward `crypto`: `cli` and `server` depend on
`core`, and `core` depends on `crypto`. `crypto` depends on nothing in the
workspace and does no I/O, so it can be audited in isolation.

### 9.1 Why MCP was dropped from v1

MCP is **dropped from v1**, deliberately:

- **Security lives in the CLI, not in MCP.** The gate, the sandbox, and the
  masking are all CLI-side.
- **The CLI is universal** — any shell-capable agent can use it.
- **A skill is Claude-Code sugar over the CLI**, not a separate capability.

The one reason to add MCP later would be to reach AI hosts that **cannot run a
shell**. If added, it would be an **optional thin adapter over `core`**, not a
core dependency.

---

## 10. Engineering practices

- **TypeScript strict mode**, **pnpm workspaces**, **vitest** for tests,
  **eslint + prettier**.
- **changesets** for versioning, **semantic versioning**, **conventional
  commits**.
- **CI** runs typecheck, lint, test, and build.

`crypto` and `core` are security-critical and get the **heaviest coverage**:

- crypto round-trips,
- injection isolation,
- output masking,
- tamper detection,
- the **sandbox-cannot-be-bypassed** property, and
- the **agent-never-sees-a-value** property.

### 10.1 Implementation philosophy

Build in **very small, independently testable increments using TDD**: write a
failing test first, implement the minimum to pass, then verify the step in
isolation before moving on. This is a **security product** — **never trade
security for speed**, and every step must be verifiable. The detailed
step-by-step implementation plan is produced separately, after this
documentation set.

---

## 11. Putting it together — an end-to-end picture

1. A developer stores a secret **once** in the global store under a portable
   slug (`openai/dev`).
2. A project commits a value-free vault declaring a **slot** for what it needs.
3. On first use, the agent or developer **requests admission**; a **human
   confirms** and passes **local auth** once. Batches admit in one step.
4. `kv run` **resolves** strictly (0/1/N, never guessing), decrypts **in
   memory**, injects env vars (and materializes file-type secrets), **masks**
   output, and **shreds on exit**.
5. To collaborate, a secret is **shared end-to-end** — wrapped to a teammate's
   UIK public key resolved through Key Transparency with TOFU pinning — via the
   optional self-hosted relay that **only ever sees ciphertext**.

Throughout, the agent **orchestrates without seeing values**, and the honest
limits ([§7.2](#72-honest-limits-documented-not-hidden),
[§8.8](#88-honest-non-goals-documented)) are documented rather than glossed
over.

---

## 12. Phasing (P0–P4)

All phases are committed in the PRD. This is the build order.

- **P0** — Monorepo scaffold + this documentation set + governance files.
- **P1** — `crypto` + `core` + `cli`: the local global store, Sets+Slots, the
  project-world sandbox, human-gated admission with local auth, `kv run`
  injection (env and file types), and per-environment. **The daily driver, no
  server needed.**
- **P2** — The **Claude plugin** (skill + hooks): agent-safe reuse and the
  admission flow.
- **P3** — **Identity and end-to-end sharing crypto**: device enrollment and
  shareable encrypted artifacts that work over any channel.
- **P4** — The **optional self-hosted team server**: the sync/sharing relay,
  members and devices, the team vault, Key Transparency, and OPAQUE login.

**Account recovery is future work beyond v1.**

---

## See also

- `../../../README.md` — project overview and getting started.
- Sibling specs and docs under `docs/` for component-level detail as they land.
