# Architecture

`kv` is an open-source, local-first, AI-agent-safe developer secrets manager. It lets you set a secret **once** and reuse it across every project with zero copy-paste, lets AI agents **use** secrets without ever **seeing** them, and lets you share secrets end-to-end encrypted to your other devices and teammates.

This document describes the system architecture: the high-level component layout, the monorepo packages and their dependency direction, the data flow for the key operations, the reasoning behind dropping MCP from v1, and the tech stack.

For the secret data model (Sets + Slots, schemas, the resolver, injection rules), see [`data-model.md`](./data-model.md). For the cryptographic design (the OrgMesh key ladder, envelope format, sharing flows, and honest non-goals), see [`security-crypto.md`](./security-crypto.md).

## High-level overview

`kv` is **local-first**: the everyday workflow needs no account and no third-party service. A global store on your machine holds your secrets; each project declares which secrets it needs (value-free) and resolves them at run time. An **optional, self-hosted server** can be added later purely as an end-to-end encrypted sync and sharing relay for a team — it only ever holds ciphertext and can never decrypt anything.

Two interfaces drive the system, and they are deliberately the *same* surface for humans and agents:

- The **`kv` CLI** is the universal interface. Any shell-capable agent (or person) uses it directly.
- The **Claude Code plugin** is a thin layer of convenience and guardrails *over* the CLI — a skill plus hooks. It teaches agent-safe usage and warns before a raw secret is written into a file or command. It is not a privileged path.

The central security property is the **project-world sandbox with human-gated admission**: a project can only use secrets that a human has explicitly **admitted** into its project world, confirmed with local presence auth (Touch ID / OS password). An agent can request admission but can never satisfy the human-presence gate and can never read from the global store directly.

```
                          HUMANS  +  AI AGENTS
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
        +-----------------+              +--------------------------+
        |   kv CLI        |  <---------  |  Claude Code plugin      |
        | (packages/cli)  |   depends    |  (plugin/: skill+hooks)  |
        +--------+--------+    on CLI     +--------------------------+
                 |
                 v
        +-------------------------------------------------------+
        |                    core (packages/core)               |
        |  vault (Sets+Slots, project-world sandbox)            |
        |  store (encrypted at-rest persistence)                |
        |  auth / admission gating (local presence auth)        |
        +----------------------------+--------------------------+
                                     |
                                     v
        +-------------------------------------------------------+
        |                  crypto (packages/crypto)             |
        |  envelope encryption, key hierarchy, HPKE,            |
        |  signatures, zero-knowledge primitives. NO I/O.       |
        +-------------------------------------------------------+

        - - - - - - - - - - - optional - - - - - - - - - - - - - -

        +-------------------------------------------------------+
        |              server (packages/server)                 |
        |  self-hosted E2E sync/sharing relay for a team:       |
        |  members, devices, sharing, shared team vault,        |
        |  Key Transparency, OPAQUE login.                      |
        |  Holds CIPHERTEXT ONLY. Cannot decrypt.               |
        +-------------------------------------------------------+
              ^  depends on core + crypto (client-side seal)
              |
        ciphertext + public keys + wrapped key material only
```

Three local artifacts back the everyday workflow (full rules in [`data-model.md`](./data-model.md)):

- The **global store** — your secrets, encrypted at rest, keyed by **slug** (e.g. `openai/dev`, `supabase/acme`).
- The **project vault** (`./.kv/vault.json`, committed) — **value-free** slot requirements: which schemas the project needs and how each field maps to env-var names.
- The **local resolution cache** (`./.kv/local.json`, gitignored) — how this machine fills the project's *open* slots.

## Monorepo package layout

`kv` is a pnpm workspace. Dependencies point **inward** toward the cryptographic trust root; nothing depends on the CLI except the plugin, and the server is optional.

```
crypto  <--  core  <--  cli  <--  plugin
                ^
                |
             server  (also -> crypto)
```

### `packages/crypto` — the cryptographic trust root

Tiny, pure, **no I/O**, independently auditable. Provides envelope encryption, the key hierarchy, HPKE, signatures, and the zero-knowledge primitives, including a generic *wrap-a-seed-to-any-public-key* primitive that future features can build on. It depends on nothing inside the monorepo. Keeping it I/O-free and self-contained is what makes it auditable in isolation. See [`security-crypto.md`](./security-crypto.md) for the full design.

**Depends on:** nothing internal.

### `packages/core` — the application logic

Three concerns:

- **vault** — the Sets + Slots data model and the **project-world sandbox**.
- **store** — encrypted at-rest persistence: the global store plus per-project vaults.
- **auth / admission gating** — local presence auth that enforces the human-gated admission rule.

`core` consumes `crypto` for all sealing and unsealing. All cryptographic operations are delegated; `core` never reimplements primitives.

**Depends on:** `crypto`.

### `packages/cli` — the `kv` binary

The universal human **and** agent interface. Implements `kv run`, `kv status`, `kv add`, `kv link`, the admission flow, the chooser, and `--dry-run`. All agent-facing output emits only slugs, schemas, field names, tags, and `hasValue` booleans — never a value.

**Depends on:** `core`.

### `packages/server` — optional self-hosted team relay

An end-to-end sync and sharing server for a team: members, devices, sharing, a shared team vault, **Key Transparency**, and **OPAQUE** login. It is a **dumb, append-only, encrypted store-and-relay**: it holds ciphertext, public keys, never-unwrapped wrapped key material, salts, the OPAQUE record, the Key Transparency log, and access-control metadata. It stores no passphrase, private key, seed, DEK, or plaintext, and there is **no operator master key**. All encryption and decryption is client-side, so the server operator can never decrypt. It depends on `crypto` and `core` to share the same client-side sealing logic and data definitions.

**Depends on:** `core`, `crypto`.

### `plugin/` — the Claude Code plugin

A skill plus hooks. The skill teaches agent-safe `kv` usage; the hooks add guardrails (for example, warn if a raw secret is about to be written into a file or command). It is sugar over the CLI and has no privileged access — everything it does flows through the `kv` binary.

**Depends on:** the `kv` CLI.

### `docs/` — documentation

This document and its siblings: [`data-model.md`](./data-model.md), [`security-crypto.md`](./security-crypto.md), and the governance and decision records.

## Data flow for the key operations

### 1. Add a secret (`kv add`)

A secret is added to the **global store** keyed by its **slug** (e.g. `supabase/acme`) with a **schema** (e.g. `supabase`). A schema may be a known provider from the built-in registry (with field shapes for completeness checks and autocomplete) or a free string for an unknown provider.

```
kv add supabase/acme --schema supabase
        |
        v
  cli -> core.vault (validate schema/fields, assign localId)
        |
        v
  core.crypto: seal each field -> XChaCha20-Poly1305(value, DEK)
        |
        v
  core.store: persist ciphertext in the global store (encrypted at rest)
```

A singleton (one OpenAI key) is a Set with one field; a Supabase backend is a Set with three fields. Because the store is keyed by slug and not by env-var name, `supabase/acme` and `supabase/blog` can both contain a `SUPABASE_URL` field with zero collision. The `localId` is a machine-local convenience and is never committed. See [`data-model.md`](./data-model.md).

### 2. Link and admit (`kv link` + admission)

Linking declares a **slot** in the project vault — a value-free requirement: `{ schema, bind: pinned|open, to: slug-or-null, inject: { fieldKey -> EXACT_ENV_VAR_NAME } }`. `pinned` means exactly one named slug (genuinely shared infrastructure); `open` means any secret of that schema the developer supplies locally.

A project can only **use** a secret once it has been **admitted** to the project world. Admission is the security pivot:

```
agent or human: request admission of a secret into the project world
        |
        v
  cli -> core.auth: show confirmation box listing ALL requested keys
        |
        v
  HUMAN CONFIRM + LOCAL AUTH  (Touch ID / OS password / biometric)
        |  (proof of human presence the agent cannot satisfy)
        v
  core.vault: record admission into the project world (sandbox)
        |
        v
  core.store: write open-slot fills into ./.kv/local.json (gitignored)
```

Auth happens **once** at admission. **Batch admission** shows all requested keys in one confirmation box and a single auth admits the whole batch. There is no re-auth on later `kv run` (re-auth-per-use is an optional policy dial, for example for service-role or prod keys, not the default). After admission, keys auto-resolve on use; when an open slot has exactly one matching secret it is auto-resolved **and the chosen secret slug is printed** ("auto-fill but tell me"). The **resolver is strict 0/1/N and never guesses**: an exact slug is used; exactly one match resolves; more than one match is a hard structured ambiguous error with a value-free numbered chooser; zero is missing or open-unfilled. Resolution triggers **lazily** at `kv run` / `kv status`, never on `git clone`. There is no daemon and no filesystem watcher.

### 3. `kv run` injection

```
kv run -- <child command>
        |
        v
  cli -> core: resolve slots strictly (0/1/N), enforce invariants
        |
        v
  core.crypto: decrypt needed secrets IN MEMORY only
        |
        +--> env-type field  -> set env var for the child's lifetime
        +--> file-type field -> materialize temp file on tmpfs (0600),
        |                       set the path env var
        v
  spawn child process with the env set
        |
        v
  MASK all secret values in child stdout/stderr
        |
        v
  on exit: shred temp files; write nothing to disk
```

`kv run --dry-run` is the agent-safe verification primitive: it prints the env-var **names** that will be set (values masked) and flags duplicate inject names, unfilled open slots, and ambiguous resolution — without revealing any value.

**Invariant:** the union of injected env-var names within a single vault must be unique. A duplicate is a hard error at link time and at `run --dry-run`. The inject map supports one-value-many-names (e.g. `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `VITE_SUPABASE_URL` all mapping to one field).

**Honest limit:** a child process inevitably holds the real value because it is *using* it, so a rogue or confused agent could still exfiltrate via a command it runs — containment is not omnipotence. The mitigations are human-gated admission (the biggest), an audit log, and egress warnings via a plugin hook. Separately, Node cannot guarantee zeroing secrets from memory because of garbage collection; we minimize plaintext lifetime but cannot promise a wipe. See [`security-crypto.md`](./security-crypto.md).

### 4. Share to a teammate

Sharing is end-to-end encrypted and client-side; the optional server only relays ciphertext.

```
sharer: kv share <slug> --to <teammate>
        |
        v
  cli -> core: resolve references
        |
        v
  core.crypto: wrap the item DEK to the recipient's UIK public key
               (resolved via Key Transparency, TOFU-pinned on first share)
               + Ed25519-sign the stanza set
        |
        v
  server (optional): relay ciphertext  (cannot decrypt)
        |
        v
  recipient: cli -> core.crypto unwraps with their device/identity key
        |
        v
  default on accept: CREATE-new (never auto-merge), suffix on slug clash
```

A share is a point-in-time copy: later rotation does not auto-propagate unless re-shared. The full identity, multi-device, team-join, rotate, and revoke flows — and the honest tradeoffs around them — are documented in [`security-crypto.md`](./security-crypto.md).

## Why MCP was dropped from v1 (and where it could slot in later)

MCP (Model Context Protocol) was **dropped from v1**. The rationale:

- **Security lives in the CLI, not in MCP.** The sandbox, human-gated admission, masking, and strict resolution are enforced in `core` behind the `kv` binary. An MCP layer would not add any security property.
- **The CLI is already universal.** Any shell-capable agent can use `kv` directly, so MCP would be a parallel surface to maintain with no new reach.
- **The Claude Code skill is just sugar over the CLI.** Agent ergonomics are already covered by the plugin without a separate protocol.

**Where it could slot in later:** the one reason to add MCP would be to reach AI hosts that cannot run a shell. If added, it would be an **optional thin adapter over `core`** — never a core dependency — sitting alongside the CLI in the dependency graph, sealing through the same `core` and `crypto` paths and inheriting the same admission and masking guarantees.

## Tech stack and tooling

- **Language / runtime:** TypeScript (strict mode) on Node.
- **Monorepo:** pnpm workspaces.
- **Testing:** vitest. `crypto` and `core` are security-critical and get the heaviest coverage — crypto round-trips, injection isolation, output masking, tamper detection, the sandbox-cannot-be-bypassed property, and the agent-never-sees-a-value property.
- **Linting / formatting:** eslint plus prettier.
- **Versioning / releases:** changesets, semantic versioning, conventional commits.
- **CI:** typecheck, lint, test, and build on every change.
- **License:** Apache-2.0.

### Implementation philosophy

Build in very small, independently testable increments using TDD: write a failing test first, implement the minimum to pass, and verify each step in isolation before moving on. This is a security product — never trade security for speed, and every step must be verifiable.

### Build phasing

- **P0** — monorepo scaffold, this documentation set, governance files.
- **P1** — `crypto` + `core` + `cli`: the local global store, Sets + Slots, the project-world sandbox, human-gated admission with local auth, `kv run` injection (env and file types), and per-environment. The daily driver, no server needed.
- **P2** — the Claude Code plugin (skill + hooks): agent-safe reuse and the admission flow.
- **P3** — identity and end-to-end sharing crypto: device enrollment and shareable encrypted artifacts that work over any channel.
- **P4** — the optional self-hosted team server: sync/sharing relay, members and devices, the team vault, Key Transparency, and OPAQUE login.

## Limitations

Account recovery is **not** part of this version. With true zero-knowledge encryption, if you lose your passphrase and all your devices, your data cannot be recovered. This is an intentional, documented limitation, stated honestly rather than hidden. Additional honest non-goals (no forward secrecy at rest; metadata visible to a server operator) are covered in [`security-crypto.md`](./security-crypto.md).
