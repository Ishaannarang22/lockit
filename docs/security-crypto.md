# OrgMesh: Cryptography & Security Design

This document specifies **OrgMesh**, the cryptographic design that underpins
`kv`. It is precise enough to implement against. It describes the trust model,
the primitives and why each was chosen, the full key ladder, the on-disk/on-wire
envelope format, exactly what an optional self-hosted server stores and never
stores, the end-to-end flows (enroll, multi-device, share, team-join, rotate,
revoke), Key Transparency, the honest non-goals, and the recommended npm
libraries.

OrgMesh lives almost entirely in [`packages/crypto`](../packages/crypto) — the
cryptographic trust root: tiny, pure, no I/O, and independently auditable. The
application logic that uses it (the vault, the store, admission gating) lives in
[`packages/core`](../packages/core); the optional relay lives in
[`packages/server`](../packages/server). For how secrets are modeled and how
agents are kept from ever seeing a value, see the data-model and agent-safety
docs in this directory.

---

## 1. Design principles

1. **Client-side encryption only.** All encryption and decryption happen on the
   client. Plaintext, passphrases, private keys, seeds, and data-encryption
   keys never leave the device in usable form.

2. **The optional server is a dumb, append-only encrypted relay.** When a team
   chooses to run [`packages/server`](../packages/server), it is a
   store-and-relay for ciphertext, public keys, and never-unwrapped wrapped key
   material. **The server operator can never decrypt.** There is **no operator
   master key** and no backdoor. `kv` needs no account and no server to be used
   locally; the server only enables sync and sharing across devices and
   teammates.

3. **Zero-knowledge means honest limits.** If you lose your passphrase and all
   your devices, your data cannot be recovered. This is an intentional,
   documented limitation of true zero-knowledge encryption (see
   [§11 Honest non-goals](#11-honest-non-goals)). We never hide it.

4. **Minimize plaintext lifetime.** Values are decrypted in memory only, for as
   short a time as possible. We cannot guarantee zeroing memory under a managed
   runtime (see [§11](#11-honest-non-goals)), but we never persist plaintext.

5. **Authenticate senders; detect tampering.** Every encrypted artifact carries
   a sender signature and a keyed header tag so that neither the sender identity
   nor the recipient set can be silently altered.

6. **Rotation is cheap where it must be.** The key ladder is shaped so that
   identity rotation costs `O(devices + memberships)` and team revocation costs
   `O(survivors)` — never `O(secrets)`.

---

## 2. Primitives & rationale

| Primitive | Algorithm | Why |
|---|---|---|
| Key agreement / key wrap | **X25519** (ECDH) | Fast, misuse-resistant curve for wrapping keys to a recipient's public key. |
| Signatures & device sigchain | **Ed25519** | Deterministic, fast signatures for sender authentication and the append-only device chain. |
| Payload sealing (AEAD) | **XChaCha20-Poly1305** | Extended 192-bit nonce permits random nonces without exhaustion risk; authenticated. |
| Asymmetric wrapping of seeds/DEKs | **HPKE — RFC 9180**, `DHKEM(X25519)` + `HKDF-SHA256` + `ChaCha20-Poly1305`, **Auth mode** | Standardized hybrid public-key encryption. Auth mode binds the wrap to the sender's identity key, preventing recipient-set injection. |
| Key derivation / expansion | **HKDF-SHA256** | Expands a single seed into multiple typed keys (the "seed-triple trick", [§5](#5-the-seed-triple-trick)). |
| Passphrase hardening | **Argon2id** | Memory-hard KDF; resists GPU/ASIC brute force of the passphrase. |
| Password-authenticated login | **OPAQUE** | The server authenticates a client without ever seeing a password or password-equivalent. |

All asymmetric public-key operations reduce to X25519/Ed25519 over Curve25519,
and all symmetric sealing uses a ChaCha20-Poly1305 family member, keeping the
audit surface small.

---

## 3. The key ladder

OrgMesh derives every key from a small, well-defined hierarchy. Everything above
the dashed line is **client-only** and never reaches the server in usable form.

```
                          passphrase
                              │
                  Argon2id(passphrase, saltA)
                              │
                              ▼
                        ┌──────────┐        optional 128-bit SecretKey
                        │ MasterKEK│        (passkey / hardware-token backed,
                        └────┬─────┘         locally generated 2nd factor)
                             │                        │
                             │             HKDF(SecretKey)
                             │                        │
                             └────────── XOR ─────────┘
                                          │
                                        HKDF
                                          │
                                          ▼
                                   ┌───────────────┐
                                   │  AccountKey AK│   (unlocks local wrapped blobs)
                                   └───────┬───────┘
                                           │ unwraps
              ┌────────────────────────────┼───────────────────────────────┐
              ▼                             ▼                                ▼
     ┌─────────────────┐          ┌──────────────────┐            ┌──────────────────┐
     │ User Identity   │          │ Personal-Vault   │            │ Org/Team Seed     │
     │ Seed  (UIS)     │          │ Seed   (PVS)     │            │ (one per team)    │
     └────────┬────────┘          └────────┬─────────┘            └────────┬─────────┘
              │ HKDF (seed-triple)         │ HKDF                          │ HKDF
              ▼                            ▼                               ▼
        ┌──────────┐                 ┌──────────┐                    ┌──────────┐
        │  UIK     │                 │  PVK     │                    │ TeamKey  │
        │(identity)│                 │(personal)│                    │          │
        └────┬─────┘                 └────┬─────┘                    └────┬─────┘
             │ "one job:                  │ personal DEKs                 │ per member: Org/Team Seed
             │  unwrap a small            │ wrap to PVK.                  │ is HPKE-sealed to that
             │  set of seeds"             │ PVS is HARD-EXCLUDED          │ member's UIK public key
             │                            │ from sharing-to-others.       │ (the team sharing boundary)
             ▼                            ▼                               ▼
   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                            client-only above │ relay/storage below

        Per-device key  DK  (private half NEVER leaves the device;
                            public half published; signed into the sigchain)

        Per-item DEK (random, per secret/version)
            payload  = XChaCha20-Poly1305(value, DEK)
            DEK      = wrapped per authorized reader → to a TeamKey and/or an individual UIK
```

### 3.1 The rungs, precisely

- **MasterKEK** = `Argon2id(passphrase, saltA)`. The root derived from the
  user's passphrase.

- **SecretKey (optional, 128-bit)** — a locally generated second factor backed
  by a passkey or hardware token. It is **not** derived from the passphrase. Its
  purpose: make a *stolen server blob non-brute-forceable from a weak
  passphrase*. Without the SecretKey, an attacker who exfiltrates server
  ciphertext still cannot grind a weak passphrase offline, because AK depends on
  a high-entropy factor the server never sees.

- **AccountKey (AK)** = `HKDF(MasterKEK XOR HKDF(SecretKey))`. (When no SecretKey
  is configured, the XOR term is absent and `AK = HKDF(MasterKEK)`.) AK unlocks
  the locally stored wrapped seeds.

- **Per-device key (DK).** Each device generates its own asymmetric key. **The
  private half never leaves the device.** The public half is published and signed
  into the user's device sigchain. Compromise of one device does not expose other
  devices' private keys.

- **User Identity Seed (UIS) → User Identity Key (UIK).** UIS expands (via the
  seed-triple trick, [§5](#5-the-seed-triple-trick)) to UIK. **UIK has exactly
  one job: to unwrap a small set of seeds** (the personal-vault seed and any
  team seeds sealed to this user). Because UIK is a thin unwrap-only layer,
  rotating identity costs `O(devices + memberships)` — you re-wrap a handful of
  seeds — rather than `O(secrets)`.

- **Personal-Vault Seed (PVS) → Personal-Vault Key (PVK).** Personal (single-
  user) DEKs wrap to PVK. **PVS is hard-excluded from any sharing-to-others
  path**: it can never be sealed to another person, so the personal vault is
  structurally non-shareable.

- **Org/Team Seed → TeamKey** (one per team). The seed expands to the team key.
  **Per member, the Org/Team Seed is HPKE-sealed to that member's UIK public
  key. This seal is the team sharing boundary** — possessing the sealed seed (and
  the matching UIK) is exactly what grants team access.

- **Per-item DEK.** A fresh random key per secret/version. It seals the payload
  as `XChaCha20-Poly1305(value, DEK)`. The DEK is then **wrapped per authorized
  reader** — to a TeamKey (for team-shared items) and/or to an individual UIK
  (for directly shared items).

---

## 4. Where keys live

| Key | Where it exists in usable form |
|---|---|
| passphrase, MasterKEK, AK | derived in client memory only |
| SecretKey | passkey/hardware token, client-side only |
| DK private half | the single device that generated it; never transmitted |
| UIS / UIK private | client memory; wrapped at rest under AK and to devices |
| PVS / PVK | client memory; wrapped under AK; never shared out |
| Org/Team Seed / TeamKey | client memory; HPKE-sealed to each member's UIK |
| per-item DEK | client memory during seal/open only |

---

## 5. The seed-triple trick

A single 32-byte seed deterministically expands, via `HKDF-SHA256` with distinct
info labels, into a typed key bundle:

```
seed (32 bytes)
  ├── HKDF(seed, info="ed25519") → Ed25519 signing key
  ├── HKDF(seed, info="x25519")  → X25519 key-agreement key
  └── HKDF(seed, info="sym")     → optional symmetric (AEAD) key
```

Benefits:

- **One secret to back up and to wrap.** Wrapping the seed to a public key (or
  sealing it under AK) implicitly conveys all three derived keys.
- **Type separation by construction.** Each derived key is bound to a domain
  label, so a signing key can never be confused with an agreement key.
- **Cheap rotation.** Rotating a role means rotating one seed, not three keys.

UIS, PVS, and the Org/Team Seed all use this expansion.

> **Generic wrap-to-public-key primitive.** [`packages/crypto`](../packages/crypto)
> exposes a generic *wrap-a-seed-to-any-public-key* operation (HPKE seal of a
> seed to a recipient public key). The team-sharing boundary is one consumer of
> it. A future feature could build other capabilities on the same primitive —
> but **no such feature exists in this version**, and there is no account
> recovery (see [§11](#11-honest-non-goals)).

---

## 6. Envelope format (age-style)

Every encrypted artifact uses a stanza-based envelope:

```
OrgMesh envelope
├── recipient stanzas[]            # one per authorized reader
│     ├── recipient pubkey id      # which public key this stanza is for
│     └── HPKE-wrapped DEK         # the per-item DEK sealed to that recipient
├── sender signature               # Ed25519 over the full stanza set
├── header HMAC                    # keyed from the DEK
└── AEAD payload                   # XChaCha20-Poly1305(value, DEK)
```

- **Recipient stanzas** — for each authorized reader (a TeamKey and/or
  individual UIK), one stanza containing the recipient's public-key id and the
  HPKE-wrapped per-item DEK.
- **Sender signature (Ed25519)** over the stanza set provides **sender
  authentication**: a relay or third party cannot inject a forged recipient set
  or impersonate a sender.
- **Header HMAC**, keyed from the DEK, makes **tampering with the recipient set
  detectable** by anyone who can unwrap a DEK.
- **AEAD payload** — the value sealed under the per-item DEK with
  XChaCha20-Poly1305.

The format is intentionally close to the age recipient-stanza shape, which is
why [`age-encryption`](https://www.npmjs.com/package/age-encryption) is a
reference for the envelope.

---

## 7. What the server stores — and never stores

When a team opts into [`packages/server`](../packages/server), it is an
append-only encrypted relay.

**Stores (only):**

- ciphertext and version history,
- **public** keys,
- never-unwrapped **wrapped** key material,
- salts (e.g. `saltA` for Argon2id),
- the OPAQUE record,
- the Key Transparency log and per-user sigchains,
- access-control metadata.

**Never stores:**

- any passphrase,
- any private key,
- any seed (UIS, PVS, Org/Team Seed),
- any DEK,
- any plaintext.

There is **no operator master key**. The server cannot decrypt anything, by
construction. (Metadata such as names, sizes, and the who-shares-with-whom graph
*is* visible to an operator — see [§11](#11-honest-non-goals).)

---

## 8. Flows

### 8.1 Enroll

1. Generate the device key **DK**, the **UIS**, and the **PVS**.
2. Upload **public** keys, the wrapped seed blobs (seeds wrapped under AK and to
   the device), and the **OPAQUE registration** record.
3. Publish the **UIK** to the Key Transparency log.

No private key, seed, or passphrase is ever uploaded in usable form.

### 8.2 Multi-device

1. The new device generates **its own** DK (private half stays local).
2. An existing **trusted** device verifies a short authenticated code shown
   between the two devices.
3. The trusted device signs the new device into the **sigchain** and **wraps the
   UIS to the new device**.

The new device now derives UIK locally; its private DK never traversed the
network.

### 8.3 Share to a teammate

1. Resolve references to the concrete secret(s) being shared (single source of
   truth; see the data-model doc).
2. Resolve the recipient's **UIK public key via Key Transparency**, with **TOFU
   pinning** on first contact.
3. **Wrap the DEK to the recipient UIK**, **Ed25519-sign** the envelope, and
   relay the ciphertext.
4. The recipient unwraps. **Default on accept is create-new — never
   auto-merge** — suffixing on a slug clash.

> **Honest tradeoff:** a share is a **point-in-time copy**. Later rotation of the
> source value does **not** auto-propagate to the recipient unless you re-share.

### 8.4 Team-join

An existing member **wraps the team seed to the new member's UIK once** — an
`O(1)` operation that grants the new member access to the team's history.

### 8.5 Rotate a value

1. Generate a **fresh DEK**.
2. Re-seal the value and wrap the new DEK **only to current readers**; removed
   parties are simply **absent** from the new recipient set.
3. Old versions are **garbage-collected**.

> Crypto cannot un-leak plaintext that was already seen, so value rotation should
> be paired with **upstream key rotation** (e.g. rolling the actual provider
> credential).

### 8.6 Revoke

1. **Rotate the team seed to the survivors** — an `O(survivors)` operation.
2. **Lazily re-wrap** DEKs under the new team key as items are next touched.
3. **Rotate the upstream value** as well.

> **ACL removal alone is NOT revocation.** Removing an entry from access-control
> metadata does not invalidate keys the removed party already holds. Real
> revocation requires the seed rotation and upstream-value rotation above. We
> state this honestly.

---

## 9. Key Transparency

OrgMesh ships an **append-only, signed log of email-to-UIK mappings**.

- Clients **auto-verify inclusion and consistency proofs** against the log.
- Clients **TOFU-pin** a contact's UIK on first share, and detect later changes.
- **Independent gossip witnesses** provide anti-equivocation — protection against
  a log that shows different views to different clients — even for a self-hosted
  deployment.

**v1 ships:** the signed log, auto-self-audit (inclusion + consistency
verification), and TOFU pinning. **Gossip witnesses follow.**

The Merkle log is built on
[`@transparency-dev/merkle`](https://www.npmjs.com/package/@transparency-dev/merkle).

---

## 10. Threat model summary

- A **malicious or compromised server operator** sees ciphertext, public keys,
  wrapped (never-unwrapped) key material, salts, OPAQUE records, the KT log, and
  metadata — and can decrypt **nothing**.
- A **network attacker** cannot impersonate senders (Ed25519 signatures, HPKE
  Auth mode) or silently alter recipient sets (header HMAC + signature).
- A **stolen server blob** is not offline-brute-forceable from a weak passphrase
  when the optional SecretKey second factor is configured.
- A **single compromised device** does not expose other devices' private keys;
  it can be revoked from the sigchain (paired with seed/value rotation per
  [§8.6](#86-revoke)).

What is **not** covered is in [§11](#11-honest-non-goals).

---

## 11. Honest non-goals

These are documented openly, not hidden.

- **No forward secrecy at rest.** A leaked long-term key is retroactive over the
  data it can reach. This is inherent to durable, random-access encrypted storage
  and is the reason messaging-style ratchets were rejected.
- **Metadata is visible to a server operator.** Names, sizes, and the
  who-shares-with-whom graph are visible to whoever runs the relay — even though
  **values never are**.
- **No account recovery in this version.** If you lose your passphrase **and**
  all your devices, your data **cannot** be recovered. This is the recovery
  trilemma: you cannot simultaneously have *no backdoor*, *loss-proof*, and *zero
  extra trust*. The cryptography does include a **generic wrap-to-public-key
  primitive** that a future recovery mechanism could be built on
  ([§5](#5-the-seed-triple-trick)), **but no recovery feature exists in this
  version** — treat lost-passphrase-plus-lost-devices as unrecoverable.
- **Memory zeroing is not guaranteed.** Under a managed runtime, garbage
  collection means we cannot promise plaintext is wiped from memory. We minimize
  plaintext lifetime; we do not promise a wipe.

---

## 12. Recommended npm libraries

| Concern | Library |
|---|---|
| HPKE core | [`@hpke/core`](https://www.npmjs.com/package/@hpke/core) |
| HPKE KEM | [`@hpke/dhkem-x25519`](https://www.npmjs.com/package/@hpke/dhkem-x25519) |
| HPKE AEAD | [`@hpke/chacha20poly1305`](https://www.npmjs.com/package/@hpke/chacha20poly1305) |
| Sodium primitives | [`libsodium-wrappers-sumo`](https://www.npmjs.com/package/libsodium-wrappers-sumo), [`sodium-native`](https://www.npmjs.com/package/sodium-native) |
| Hashing / KDF | [`hash-wasm`](https://www.npmjs.com/package/hash-wasm) |
| Argon2id | [`argon2`](https://www.npmjs.com/package/argon2) |
| OPAQUE | [`@serenity-kit/opaque`](https://www.npmjs.com/package/@serenity-kit/opaque) |
| Curves / ciphers / hashes | [`@noble/curves`](https://www.npmjs.com/package/@noble/curves), [`@noble/ciphers`](https://www.npmjs.com/package/@noble/ciphers), [`@noble/hashes`](https://www.npmjs.com/package/@noble/hashes) |
| Envelope reference | [`age-encryption`](https://www.npmjs.com/package/age-encryption) |
| Key Transparency / Merkle | [`@transparency-dev/merkle`](https://www.npmjs.com/package/@transparency-dev/merkle) |

### 12.1 At-rest implementation notes (P0)

- **Effective libsodium core is lockfile-pinned.** `libsodium-wrappers-sumo` is
  pinned to exactly `0.7.15` — its `0.7.16` build ships a broken relative import
  of the wasm module and fails to load under Node ESM/CJS/vitest. The wrapper
  resolves its actual wasm primitive (`libsodium-sumo`) through its own semver
  range, so the *primitive* version is fixed only by the committed
  `pnpm-lock.yaml` (currently `libsodium-sumo 0.7.16`). Treat any lockfile change
  to `libsodium-sumo` as a security-reviewable crypto-core change.
- **Default Argon2id params are interactive-tier.** `DEFAULT_KDF_PARAMS` is
  `t=3, m=64 MiB, p=1` — it meets the OWASP Argon2id minimum but is tuned
  conservatively for P0; production tuning plus a benchmark is deferred to a later
  hardening pass. Params are persisted per sealed blob, so raising the default
  later upgrades only newly-sealed vaults — existing vaults keep their original
  params until re-sealed.
- **Untrusted blob headers are bounds-checked.** `deriveKey` rejects out-of-range
  `iterations`/`memorySize`/`parallelism` before invoking Argon2id, so a tampered
  header cannot force unbounded CPU/RAM (or an uncontrolled allocation error) when
  opening a blob.

---

## 13. Testing expectations

[`packages/crypto`](../packages/crypto) and
[`packages/core`](../packages/core) are security-critical and carry the heaviest
test coverage, written test-first (TDD) in very small, independently verifiable
increments. Crypto tests must cover, at minimum:

- envelope **round-trips** (seal → open) across recipient sets,
- **tamper detection** (mutating a stanza, the recipient set, the signature, or
  the payload must fail to open),
- **sender authentication** (a forged or swapped sender signature is rejected),
- correctness of the **key ladder** derivations and the seed-triple expansion,
- the rotation/revocation invariants from [§8](#8-flows) (removed parties are
  absent from new recipient sets).

For injection isolation, output masking, and the agent-never-sees-a-value
property, see the agent-safety doc in this directory.
