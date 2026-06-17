# Roadmap

This document describes the build order for `kv`, an open-source, local-first,
AI-agent-safe developer secrets manager. It explains what each phase delivers,
the dependencies between phases, and the implementation philosophy that governs
how every phase is built.

`kv` is a self-hostable, local-first tool. The CLI works entirely on your own
machine with no account and no third-party service. An optional, self-hosted
server lets you sync and share secrets end-to-end across your own devices and
with a single team. Everything is encrypted client-side; the server only ever
holds ciphertext.

For deeper context, see the sibling documents:

- [`vision.md`](./PRD.md) — the problem and the product vision
- [`architecture.md`](./architecture.md) — the pnpm monorepo and package boundaries
- [`data-model.md`](./data-model.md) — the Sets + Slots data model
- [`security.md`](./threat-model.md) — the project-world sandbox and human-gated admission
- [`crypto.md`](./security-crypto.md) — the OrgMesh cryptographic design
- Architecture Decision Records in [`./adr/`](./adr/)

---

## Implementation philosophy

This philosophy applies to **every** phase below. It is the single most
important constraint on how the project is built.

- **Very small, independently testable increments.** Work proceeds in tiny
  steps. Each step changes one thing, is verifiable on its own, and is finished
  and confirmed before the next step begins.
- **Test-first (TDD).** Write a failing test first, implement the minimum code
  needed to make it pass, then verify the step in isolation before moving on.
- **Security-first, always.** This is a security product. Never trade security
  for speed. If a shortcut weakens a guarantee, it is not a valid shortcut.
- **Every step must be verifiable.** Each increment produces evidence (a passing
  test, a reproducible check) that the intended property holds.
- **Heaviest coverage on `crypto` and `core`.** These two packages are
  security-critical and receive the most thorough testing, including:
  - crypto round-trips (seal then open, wrap then unwrap)
  - injection isolation (`kv run` writes nothing to disk; secrets live only in
    memory for the child process lifetime)
  - output masking (secret values masked in child `stdout`/`stderr`)
  - tamper detection (recipient-set and payload tampering is detectable)
  - the sandbox-cannot-be-bypassed property (a project only ever uses keys
    explicitly admitted to its project world)
  - the agent-never-sees-a-value property (agent-facing output emits only slugs,
    schemas, field names, tags, and `hasValue` booleans — never a value)

The **detailed, step-by-step implementation plan is a separate document**,
produced after this documentation set is complete. This roadmap defines *what*
each phase delivers and *in what order*; the implementation plan defines the
exact sequence of small increments within each phase.

---

## Phases at a glance

| Phase | Theme | Headline deliverable |
|-------|-------|----------------------|
| **P0** | Foundation | Monorepo scaffold, this documentation set, governance files |
| **P1** | The daily driver | `crypto` + `core` + `cli`: local store, Sets + Slots, sandbox, admission, `kv run` |
| **P2** | Agent integration | The Claude Code plugin: skill + hooks for agent-safe reuse |
| **P3** | Identity & sharing crypto | Device enrollment and shareable end-to-end encrypted artifacts |
| **P4** | Optional team server | Self-hosted sync/sharing relay, Key Transparency, OPAQUE login |

Every phase listed here is committed in the PRD. Account recovery is **not** part
of this version — see [Account recovery is future work](#account-recovery-is-future-work).

---

## P0 — Foundation

**Delivers**

- The pnpm monorepo scaffold with the package boundaries described in
  [`architecture.md`](./architecture.md):
  - `packages/crypto` — the cryptographic trust root (pure, no I/O, independently auditable)
  - `packages/core` — vault, store, and auth/admission gating
  - `packages/cli` — the `kv` binary
  - `packages/server` — the optional self-hosted sync/sharing server (scaffold only at this stage)
  - `plugin/` — the Claude Code plugin (scaffold only at this stage)
  - `docs/` — documentation
- This documentation set.
- Governance files: license (Apache-2.0), contribution guidelines, code of
  conduct, security policy, and the engineering baseline — TypeScript strict
  mode, pnpm workspaces, vitest, eslint + prettier, changesets, semantic
  versioning, conventional commits, and CI running typecheck, lint, test, and
  build.

**Dependencies**

- None. P0 is the foundation everything else builds on.

**Exit criteria**

- The repository builds clean, CI is green on an empty-but-wired-up workspace,
  and the documentation set is in place.

---

## P1 — The daily driver (`crypto` + `core` + `cli`)

This is the heart of the product: a fully usable local secrets manager with **no
server needed**.

**Delivers**

- **The local global store** — encrypted at-rest persistence holding `SECRET`s,
  keyed by portable human `SLUG` (for example `openai/dev`, `supabase/acme`),
  not by env-var name, so `supabase/acme` and `supabase/blog` can both contain a
  field named `SUPABASE_URL` with zero collision. See [`data-model.md`](./data-model.md).
- **Sets + Slots** — a `SECRET` is a typed bag of one or more `FIELD`s with a
  `SCHEMA` from a built-in provider registry plus free strings for unknown
  providers. The committed, value-free **project vault** holds `SLOT`s
  (requirements) that are `bind: pinned` or `bind: open`, with an `inject` map
  from field keys to exact env-var names.
- **The strict 0/1/N resolver** — an exact slug is used; exactly one match
  resolves; more than one match is a hard structured **AMBIGUOUS** error with a
  value-free numbered chooser; zero is missing or open-unfilled. No label
  heuristics, no guessing.
- **The project-world sandbox** — a project can only use keys that have been
  admitted to its project world; the global store is the protected source.
- **Human-gated admission with local auth** — every admission requires human
  confirmation plus local presence auth (Touch ID / OS password / biometric,
  with a passphrase fallback). Auth happens once at admission; batches show all
  keys in one confirmation and a single auth admits the whole batch. See
  [`security.md`](./threat-model.md).
- **`kv run` injection (env and file types)** — decrypts needed secrets in
  memory only, spawns the child with env vars set for its lifetime, masks secret
  values in child output, writes nothing to disk, and shreds on exit.
  `type=file` secrets materialize to a `0600` temp file on tmpfs, set the path
  env var, and shred it. `kv run --dry-run` prints env-var **names** (values
  masked) and flags duplicate inject names, unfilled open slots, and ambiguous
  resolution.
- **Per-environment support** — an optional secondary `dev`/`staging`/`prod`
  axis; default is single-context, opt in when needed.

**Dependencies**

- Depends on **P0**.
- `cli` depends on `core`; `core` depends on `crypto`. Built in that order,
  bottom-up, so each layer is fully tested before the layer above consumes it.

**Exit criteria**

- A developer can set a key once, declare slots in a project vault, admit keys
  through the human-gated flow, and run a child process with `kv run` — entirely
  locally. The sandbox, masking, and dry-run verification properties are covered
  by tests.

---

## P2 — Agent integration (the Claude Code plugin)

**Delivers**

- The Claude Code plugin in `plugin/`: a **skill** plus **hooks**.
  - The skill teaches agent-safe `kv` usage — orchestrate with slugs, schemas,
    field names, and `hasValue` booleans; never request or surface a value.
  - Hooks add guardrails, for example warning if a raw secret is about to be
    written into a file or command (an egress warning).
- The agent-safe admission flow: the agent can **request** admission but can
  never pull from the global store directly. Human confirmation plus local auth
  remains the gate the agent cannot satisfy.

**Dependencies**

- Depends on **P1**. The plugin depends on the `kv` CLI — security lives in the
  CLI, and the plugin is convenience over it.

**Notes**

- MCP is intentionally **not** part of v1. The CLI is universal: any
  shell-capable agent can use it, and the skill is Claude-Code sugar over the
  CLI. The only future reason to add MCP is to reach AI hosts that cannot run a
  shell; if added, it would be an optional thin adapter over `core`, never a core
  dependency. See the relevant ADR in [`./adr/`](./adr/).

**Exit criteria**

- An agent can drive the full reuse-and-admission flow without ever seeing a
  secret value, and the guardrail hooks fire on attempted secret egress.

---

## P3 — Identity and end-to-end sharing crypto

This phase builds the cryptographic machinery for identity and sharing **before**
any server exists, so the artifacts work over any channel.

**Delivers**

- **Device enrollment** — generate the device key, the User Identity Seed (UIS),
  and the Personal-Vault Seed (PVS); produce the public keys and wrapped blobs.
- **Multi-device** — a new device generates its own key; an existing trusted
  device verifies a short authenticated code, signs the new device into the
  sigchain, and wraps the UIS to it.
- **Shareable encrypted artifacts** — using the OrgMesh envelope format
  (recipient stanzas with HPKE-wrapped DEKs, an Ed25519 sender signature, a
  header HMAC keyed from the DEK, and the AEAD payload), a secret can be shared
  end-to-end so that only the intended reader can unwrap it. On accept, the
  default is create-new (never auto-merge), suffixing on a slug clash. See
  [`crypto.md`](./security-crypto.md).

**Dependencies**

- Depends on **P1** (the `crypto` and `core` foundations and the data model).
- Independent of the server: these artifacts are designed to travel over any
  channel, which is what makes the **P4** relay a thin layer rather than a trust
  anchor.

**Honest tradeoff (documented, not hidden)**

- A share is a point-in-time copy; later rotation does not auto-propagate unless
  re-shared. This and the other honest limits live in [`crypto.md`](./security-crypto.md).

**Exit criteria**

- Two of your own devices, and two members, can enroll and exchange an
  end-to-end encrypted secret artifact with sender authentication and tamper
  detection — with no server in the loop.

---

## P4 — The optional self-hosted team server

**Delivers**

- The optional, self-hosted `packages/server`: an end-to-end sync/sharing relay
  for a team that **only ever holds ciphertext**. There is no operator master
  key, and the operator can never decrypt.
- Members, devices, and a shared team vault.
- Team flows: team-join (an existing member wraps the team seed to a new member
  once, O(1)), share, rotate, and revoke — with the honest distinction that ACL
  removal alone is not revocation (revocation rotates the team seed to survivors
  and re-wraps).
- **Key Transparency** — an append-only signed log of email-to-UIK mappings;
  clients auto-verify inclusion and consistency proofs and TOFU-pin a contact on
  first share. v1 ships the signed log plus auto-self-audit plus TOFU pinning;
  independent gossip witnesses follow.
- **OPAQUE login** — so the server never sees a password-equivalent.

**Dependencies**

- Depends on **P3** (identity, the sigchain, and the sharing crypto) and on the
  **P1** data model. The server is a relay over crypto that already exists, not a
  new trust root.

**Exit criteria**

- A team can self-host the server and sync/share secrets end-to-end, with Key
  Transparency self-audit and OPAQUE login working, and with the property that a
  server operator who inspects storage finds only ciphertext, public keys,
  wrapped (never-unwrapped) key material, salts, the OPAQUE record, the Key
  Transparency log and sigchains, and access-control metadata — never a
  passphrase, private key, seed, DEK, or plaintext.

---

## Dependency summary

```
P0  (foundation)
 └─> P1  (crypto + core + cli — the local daily driver)
      ├─> P2  (Claude Code plugin — depends on the kv CLI)
      └─> P3  (identity + end-to-end sharing crypto)
           └─> P4  (optional self-hosted team server)
```

- **P1** is bottom-up: `crypto` → `core` → `cli`.
- **P2** and **P3** both build on **P1** and can be sequenced independently of
  each other.
- **P4** builds on **P3**.

---

## Account recovery is future work

Account recovery is **not** included in this version. This is an intentional,
honestly documented limitation of true zero-knowledge encryption: if you lose
your passphrase and all of your devices, your data cannot be recovered, because
no one — not even a server operator — ever holds a key that could decrypt it.

This reflects the recovery trilemma: you cannot simultaneously have all three of
no backdoor, loss-proof recovery, and zero extra trust. We choose no backdoor
and zero extra trust, and we state the cost plainly. Recovery is future work
beyond v1, and when it is designed it will be evaluated against the same
security-first, every-step-verifiable philosophy as everything above. See
[`crypto.md`](./security-crypto.md) for the full set of honest limits and non-goals.
