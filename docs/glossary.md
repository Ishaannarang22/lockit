# Glossary

This glossary defines every domain term used across the `kv` project precisely,
for both human readers and AI agents. Entries are intentionally short and link to
related terms. Terms are grouped by area; within each group they build on one
another.

> **Note on cross-references.** This file links to sibling documents by relative
> path (for example [`./architecture.md`](./architecture.md),
> [`./data-model.md`](./data-model.md), [`./threat-model.md`](./threat-model.md), and
> [`./security-crypto.md`](./security-crypto.md)). If a sibling document has not yet been written,
> the link target is the conventional path it will live at.

---

## Data model: Sets + Slots

### Secret

A typed bag of one or more [Fields](#field) stored in the [Global Store](#global-store).
A Secret is identified by a portable [Slug](#slug) and described by a
[Schema](#schema). It is the unit that holds actual values (for example one
OpenAI API key, or the three values that make up a Supabase backend). See
[`./data-model.md`](./data-model.md).

### Field

A single named value inside a [Secret](#secret). A Field is either an
[env-type Field](#env-type-field) or a [file-type Field](#file-type-field). Field
keys are local to their Secret, so two Secrets may each contain a Field named
`SUPABASE_URL` with zero collision.

### Set

The data-model name for a [Secret](#secret) viewed as a collection of
[Fields](#field). "Set" and "Secret" describe the same object: a Set groups the
Fields that belong together. A [Singleton](#singleton) is a Set with exactly one
Field.

### Singleton

A [Set](#set) that contains exactly one [Field](#field) — for example a lone
OpenAI key. Contrast with a multi-field Set such as a Supabase backend
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

### Slug

The portable, human-readable identifier for a [Secret](#secret) — for example
`openai/dev` or `supabase/acme`. The [Global Store](#global-store) is keyed by
Slug, **not** by env-var name, which is why `supabase/acme` and `supabase/blog`
can both contain a `SUPABASE_URL` Field without colliding. Slugs are rename-safe
through an `aka` alias list.

### localId

A machine-local convenience identifier for a [Secret](#secret). It is never
committed and never shared; only the [Slug](#slug) is portable.

### Schema

The shape descriptor for a [Secret](#secret) — for example `openai` or
`supabase`. Schemas come from a built-in registry of known providers (which
supplies Field shapes for completeness checks and autocomplete) plus free-form
strings for unknown providers. A [Slot](#slot) declares the Schema it needs.

### Global Store

The protected, local source of truth that holds every [Secret](#secret) on this
machine, keyed by [Slug](#slug). It is encrypted at rest. A [Project World](#project-world)
can only use Secrets that have been [Admitted](#admission) to it; the agent can
never read the Global Store directly. See [`./architecture.md`](./architecture.md).

### Project Vault

A committed, **value-free** file (for example `./.kv/vault.json`) that lists the
[Slots](#slot) a project requires. It records requirements and bindings, never
values. Contrast with the [Local Resolution Cache](#local-resolution-cache).

### Slot

A single requirement declared in a [Project Vault](#project-vault). A Slot has
the shape `{ schema, bind, to, inject }`, where `bind` is
[pinned](#pinned-slot) or [open](#open-slot), `to` is a [Slug](#slug) or null,
and `inject` maps Field keys to exact env-var names (see [Inject map](#inject-map)).
A Slot is a [Reference](#reference-vs-copy), not a copy of a value.

### Pinned Slot

A [Slot](#slot) bound to one exact [Slug](#slug). Used for genuinely shared
infrastructure that every developer on the project must use. Contrast with an
[Open Slot](#open-slot).

### Open Slot

A [Slot](#slot) that accepts any [Secret](#secret) of the declared
[Schema](#schema) supplied locally by the developer. Used for per-developer or
per-project backends. How an Open Slot is filled on this machine is recorded in
the [Local Resolution Cache](#local-resolution-cache).

### Inject map

The `inject` portion of a [Slot](#slot): a mapping from a [Field](#field) key to
the exact env-var name(s) that [Injection](#injection) will set. One Field may
map to several names (for example `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and
`VITE_SUPABASE_URL`). **Invariant:** the union of all injected env-var names
within a single [Project Vault](#project-vault) must be unique; a duplicate is a
hard error at [Link](#link) time and at `kv run --dry-run`.

### Environment (dev/staging/prod)

An optional secondary axis on resolution. The default is single-context; a
project opts in to a per-environment axis only when it needs distinct values for
`dev`, `staging`, or `prod`.

### Reference vs Copy

A [Slot](#slot) holds a **reference** to a [Secret](#secret), not a copy of its
value. This keeps a single source of truth: rotate a Secret once and every
consumer sees the new value. A **copy** duplicates the value and drifts from the
source (see also the honest tradeoff under [Share](#share)).

### Bundle

An opt-in operation that embeds resolved values into a project for standalone or
offline use, trading the single-source-of-truth benefit of a
[Reference](#reference-vs-copy) for self-containment.

### Link

The act of binding a project's [Slots](#slot) to [Secrets](#secret). Link time is
one of the points where the unique-injected-names invariant (see
[Inject map](#inject-map)) is enforced.

### Resolver

The strict component that maps a [Slot](#slot) to a [Secret](#secret). It is
**0/1/N** and never guesses: an exact [Slug](#slug) is used directly; exactly one
matching Secret resolves; more than one match raises a structured
[Ambiguity](#ambiguity) error; zero matches means the Slot is missing or an
unfilled [Open Slot](#open-slot). There are no label heuristics that could
silently pick the wrong value.

### Ambiguity

The hard, structured error the [Resolver](#resolver) raises when more than one
[Secret](#secret) matches a [Slot](#slot). It is presented as a value-free,
numbered chooser so a human can pick. An AI agent cannot resolve Ambiguity by
guessing — it must surface the choice. See [Agent-safety](#agent-safety).

### Local Resolution Cache

A gitignored file (for example `./.kv/local.json`) that records how this
machine's [Open Slots](#open-slot) were filled. It is a machine-local
convenience and is never committed; contrast with the
[Project Vault](#project-vault).

### env-type Field

A [Field](#field) whose value is a string injected directly as an environment
variable. Contrast with a [file-type Field](#file-type-field).

### file-type Field

A [Field](#field) whose contents are materialized to a temporary file on `tmpfs`
with `0600` permissions; an env var is set to the file path, and the file is
shredded on process exit. Canonical example: a Google service-account JSON
consumed via `GOOGLE_APPLICATION_CREDENTIALS`. Contrast with an
[env-type Field](#env-type-field).

---

## Security model: sandbox, admission, injection

### Project World

The per-project sandbox that holds only the [Secrets](#secret) explicitly
[Admitted](#admission) to it. A project can use a Secret only after it enters the
project world; the [Global Store](#global-store) remains the protected source.

### Project-World Sandbox

The isolation property of the [Project World](#project-world): an AI agent
operating in a project can never pull from the [Global Store](#global-store)
directly — it can only **request** [Admission](#admission). This sandbox boundary
is a core, tested security property. See [`./threat-model.md`](./threat-model.md).

### Admission

The human-gated act of bringing a [Secret](#secret) into a
[Project World](#project-world). Every admission requires **human confirmation**
plus **local auth** (see [Local Auth](#local-auth)) — proof of human presence
that an agent cannot satisfy. Auth happens once at admission; later `kv run`
does not re-authenticate by default.

### Batch admission

Admitting several [Secrets](#secret) at once. All of them are shown in one
confirmation box and a single [Local Auth](#local-auth) admits the whole batch.

### Local Auth

The local presence check required for [Admission](#admission) — Touch ID, OS
password, or biometric (macOS uses LocalAuthentication / Touch ID; the fallback
is the OS keychain or password; a demo may use a passphrase prompt). Re-auth on
each `kv run` is an optional policy dial (for example for service-role or prod
keys), not the default.

### Auto-fill (auto-fill but tell me)

After [Admission](#admission), when an [Open Slot](#open-slot) has exactly one
matching [Secret](#secret) it is auto-resolved **and** the chosen Secret is
printed, so the resolution is never silent. The first admission still passes the
confirm-and-auth gate.

### Lazy resolution

Resolution is triggered only at `kv run` or `kv status` — never on `git clone`.
There is no daemon and no filesystem watcher (an optional, opt-in `direnv`-style
`cd` hook may come later).

### Injection

What `kv run` does: it decrypts the needed [Secrets](#secret) **in memory only**,
spawns the child process with the env vars set for its lifetime,
[Masks](#masking) secret values in the child's stdout/stderr, writes nothing to
disk, and shreds on exit. [file-type Fields](#file-type-field) materialize a temp
file, set the path env var, and shred it. `kv run --dry-run` prints the env-var
**names** that will be set (values masked) and flags duplicate inject names (see
[Inject map](#inject-map)), unfilled [Open Slots](#open-slot), and
[Ambiguity](#ambiguity) — the agent-safe verification primitive.

### Masking

Replacing secret values with a redacted placeholder in any output a human or
agent might read, including child stdout/stderr during [Injection](#injection)
and the `--dry-run` listing.

### Agent-safety

The guarantee that all agent-facing output (`list`, `status`, `--dry-run`, the
[Ambiguity](#ambiguity) chooser) emits only [Slugs](#slug), [Schemas](#schema),
Field names, tags, and `hasValue` booleans — never a value, not even masked.
Values flow from the vault into the child process in memory and never enter the
model context or transcript. **Honest limit:** a child process inevitably holds
the real value while using it, so a rogue or confused agent could still
exfiltrate via a command it runs; containment is not omnipotence. The largest
mitigation is human-gated [Admission](#admission), backed by an audit log and
egress warnings from the plugin hook. See [`./threat-model.md`](./threat-model.md).

---

## Cryptography: OrgMesh

### OrgMesh

The name of the project's cryptographic design: client-side **envelope
encryption** where the optional self-hosted server is a dumb, append-only
encrypted store-and-relay that can never decrypt. All encryption and decryption
happen client-side. See [`./security-crypto.md`](./security-crypto.md).

### Envelope encryption

The pattern OrgMesh is built on: a payload is sealed under a per-item
[DEK](#dek), and the DEK is then wrapped (encrypted) to each authorized reader's
public key. To grant or revoke access you re-wrap the DEK rather than re-encrypt
the payload.

### DEK (Data Encryption Key)

A random, per-item key (one per [Secret](#secret) version) that seals the payload
as `XChaCha20-Poly1305(value, DEK)`. The DEK is wrapped per authorized reader —
to a [Team Key](#orgteam-seed--team-key) and/or an individual [UIK](#uik) — using
[HPKE](#hpke). Compare with [KEK](#kek).

### KEK (Key Encryption Key)

Any key whose job is to wrap (encrypt) another key rather than to seal data. In
the [Key ladder](#key-ladder), `MasterKEK = Argon2id(passphrase, saltA)` is the
root KEK derived from the passphrase. Compare with [DEK](#dek).

### Key ladder

The client-only chain of key derivations: `MasterKEK` from the passphrase via
Argon2id; the [Account Key](#account-key) from the MasterKEK combined with an
optional second factor; per-device, identity, personal-vault, and team keys below
that. Designed so identity rotation costs `O(devices + memberships)` rather than
`O(secrets)`. See [`./security-crypto.md`](./security-crypto.md).

### Account Key (AK)

`AK = HKDF(MasterKEK XOR HKDF(SecretKey))`, where `SecretKey` is an optional
128-bit, locally generated second factor (passkey- or hardware-token-backed). The
second factor makes a stolen server blob non-brute-forceable even from a weak
passphrase.

### Device Key (DK)

A per-device key whose private half never leaves the device. New devices are
admitted through the [Multi-device](#multi-device) flow and recorded in the
[Sigchain](#sigchain).

### UIS (User Identity Seed)

A 32-byte seed that expands (via the HKDF seed-triple trick) to the user's
identity key, the [UIK](#uik). During [Multi-device](#multi-device) enrollment a
trusted device wraps the UIS to the new device.

### UIK (User Identity Key)

The user identity key expanded from the [UIS](#uis). It has exactly one job: to
unwrap a small set of seeds. Keeping its role narrow is what makes identity
rotation cheap. A UIK's public half is published to [Key Transparency](#key-transparency)
and is the recipient key that [Secrets](#secret) are shared to.

### PVS (Personal-Vault Seed)

A seed that expands to the [PVK](#pvk). The PVS is **hard-excluded** from any
sharing-to-others flow — it never leaves the personal boundary.

### PVK (Personal-Vault Key)

The key expanded from the [PVS](#pvs). Personal [DEKs](#dek) are wrapped to the
PVK, scoping personal secrets to the owner alone.

### Org/Team Seed & Team Key

An Org/Team Seed expands to a **Team Key**. Per member, the seed is
[HPKE](#hpke)-sealed to that member's [UIK](#uik) public key — this sealing is
the team sharing boundary. A shared [DEK](#dek) can be wrapped to a Team Key so
every current member can read it.

### HPKE (Hybrid Public Key Encryption)

RFC 9180 hybrid public-key encryption (DHKEM(X25519) + HKDF-SHA256 +
ChaCha20-Poly1305, in Auth mode). OrgMesh uses HPKE to wrap seeds and
[DEKs](#dek) to recipient public keys.

### Recipient stanza

One entry in the age-style [Envelope](#envelope-format): `{ recipient pubkey id,
HPKE-wrapped DEK }`. One stanza exists per authorized reader.

### Envelope format

The on-disk sealed object: a list of [Recipient stanzas](#recipient-stanza),
plus an Ed25519 sender signature over the stanza set (giving sender
authentication, so no impersonation injection), plus a header HMAC keyed from the
[DEK](#dek) (making tampering with the recipient set detectable), plus the AEAD
payload.

### OPAQUE

An asymmetric password-authenticated key exchange used for login so the server
never sees a password or any password-equivalent. The server stores only the
OPAQUE record. See [`./security-crypto.md`](./security-crypto.md).

### Key Transparency

An append-only, signed log of email-to-[UIK](#uik) mappings. Clients
auto-verify inclusion and consistency proofs and [TOFU](#tofu)-pin a contact on
first [Share](#share). Independent gossip witnesses provide anti-equivocation
even when the server is self-hosted. v1 ships the signed log, auto-self-audit,
and TOFU pinning; gossip witnesses follow.

### Sigchain

A per-user, append-only, Ed25519-signed chain of device events. A trusted device
signs each new [Device Key](#device-key) into the sigchain, giving a verifiable
history of which devices belong to the user.

### TOFU (Trust On First Use)

The policy of pinning a contact's [UIK](#uik) (resolved via
[Key Transparency](#key-transparency)) the first time you [Share](#share) with
them, then alerting on any later change to that pin.

---

## Flows

### Enroll

First-time setup: generate the [Device Key](#device-key), [UIS](#uis), and
[PVS](#pvs); upload public keys, wrapped blobs, and the OPAQUE registration;
publish the [UIK](#uik) to [Key Transparency](#key-transparency).

### Multi-device

Adding a device: the new device generates its own [Device Key](#device-key); an
existing trusted device verifies a short authenticated code, signs the new device
into the [Sigchain](#sigchain), and wraps the [UIS](#uis) to it.

### Share

Sharing a [Secret](#secret) with a teammate: resolve [References](#reference-vs-copy),
wrap the [DEK](#dek) to the recipient's [UIK](#uik) public key (resolved via
[Key Transparency](#key-transparency) with [TOFU](#tofu) pinning), Ed25519-sign,
and relay the ciphertext; the recipient unwraps. Default on accept is
**create-new, never auto-merge**, suffixing on a [Slug](#slug) clash. **Honest
tradeoff:** a share is a point-in-time copy, so later [Rotation](#rotate) does
not auto-propagate unless re-shared.

### Team-join

An existing member wraps the [Org/Team Seed](#orgteam-seed--team-key) to the new
member's [UIK](#uik) once — `O(1)` — granting access to shared history.

### Rotate

Replacing a value: generate a fresh [DEK](#dek) and wrap it only to current
readers; removed parties are simply absent; old versions are garbage-collected.
Crypto cannot un-leak already-seen plaintext, so pair rotation with upstream key
rotation at the provider.

### Revoke

Removing access: rotate the [Org/Team Seed](#orgteam-seed--team-key) to survivors
(`O(survivors)`), lazily re-wrap [DEKs](#dek), and rotate the upstream value.
**Honest limit:** ACL removal alone is **not** revocation — the survivor-rotation
and upstream rotation are what actually revoke.

---

## Honest non-goals

These are documented, intentional limitations of OrgMesh — stated openly, not
hidden. See [`./security-crypto.md`](./security-crypto.md) and [`./threat-model.md`](./threat-model.md).

- **No forward secrecy at rest.** A leaked long-term key is retroactive over the
  data it can reach. This is inherent to durable, random-access storage and is
  why messaging-style ratchets were rejected.
- **Metadata is visible to a server operator.** Names, sizes, and the
  who-shares-with-whom graph are visible even though values never are.
- **No account recovery in this version.** If you lose your passphrase and all
  your devices, your data cannot be recovered. This is the unavoidable cost of
  true zero-knowledge encryption (the recovery trilemma: you cannot have
  no-backdoor, loss-proof, and zero-extra-trust all at once). It is a plain
  limitation of this version, not a planned feature here.
- **Plaintext lifetime, not wiping.** Node cannot guarantee zeroing secrets from
  memory because of garbage collection. We minimize plaintext lifetime but
  cannot promise a wipe.
