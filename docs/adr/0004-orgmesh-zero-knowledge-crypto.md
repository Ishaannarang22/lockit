# 4. OrgMesh zero-knowledge crypto

## Status

Accepted

## Context

Secrets must be shareable to a developer's other devices and to teammates, over
any channel, without a server operator ever being able to read them. The
optional self-hosted server must be a dumb relay that only ever holds
ciphertext. We need a cryptographic design that:

- does all encryption and decryption **client-side**;
- supports sharing to other devices and teammates by public key;
- keeps identity rotation cheap and revocation meaningful;
- gives sender authentication and tamper detection;
- protects against a malicious or compromised key directory via transparency.

This decision is the trust root for the whole product and lives in
[`packages/crypto`](0002-monorepo-package-layout.md).

## Decision

Adopt **OrgMesh**: client-side envelope encryption with an optional, dumb,
append-only encrypted store-and-relay server. The server operator can **never**
decrypt. There is **no operator master key**.

**Primitives.** X25519 (ECDH key wrap), Ed25519 (signatures and the device
sigchain), XChaCha20-Poly1305 (AEAD payload sealing), HPKE (RFC 9180) with
DHKEM(X25519) + HKDF-SHA256 + ChaCha20-Poly1305 in **Auth** mode (wrapping
seeds and DEKs to public keys), HKDF-SHA256 (subkey/seed expansion via the
seed-triple trick: one 32-byte seed expands to an Ed25519 key, an X25519 key,
and an optional symmetric key), Argon2id (passphrase to key), and OPAQUE (login
so the server never sees a password-equivalent).

**Key ladder (client-only).**

- `MasterKEK = Argon2id(passphrase, saltA)`.
- `AccountKey AK = HKDF(MasterKEK XOR HKDF(SecretKey))`, where `SecretKey` is an
  optional 128-bit locally-generated second factor (passkey or
  hardware-token-backed) that makes a stolen server blob non-brute-forceable
  from a weak passphrase.
- A per-device key `DK` has a private half that never leaves the device.
- The **User Identity Seed (UIS)** expands to the user identity key **UIK**.
  UIK has exactly one job — to unwrap a small set of seeds — so identity
  rotation costs `O(devices + memberships)` rather than `O(secrets)`.
- The **Personal-Vault Seed (PVS)** expands to **PVK**; personal DEKs wrap to
  PVK. PVS is **hard-excluded** from any sharing-to-others.
- An **Org/Team Seed** expands to a team key; per member, the seed is
  HPKE-sealed to the member's UIK public key — this is the team sharing
  boundary.
- A per-item **DEK** (random per secret/version) seals the payload as
  `XChaCha20-Poly1305(value, DEK)`; the DEK is wrapped per authorized reader (to
  a team key and/or an individual UIK).

**Envelope format (age-style).** A list of recipient stanzas
`{ recipient pubkey id, HPKE-wrapped DEK }`, plus an Ed25519 sender signature
over the stanza set, plus a header HMAC keyed from the DEK, plus the AEAD
payload. The signature gives sender authentication (no impersonation
injection); the header HMAC makes tampering with the recipient set detectable.

**The server stores only:** ciphertext and version history, public keys,
never-unwrapped wrapped key material, salts, the OPAQUE record, the Key
Transparency log and per-user sigchains, and access-control metadata. It
**never** stores any passphrase, private key, seed, DEK, or plaintext.

**Flows.**

- **Enroll** — generate the device key, UIS, PVS; upload public keys plus
  wrapped blobs plus the OPAQUE registration; publish UIK to the Key
  Transparency log.
- **Multi-device** — the new device generates its own key; an existing trusted
  device verifies a short authenticated code, signs the new device into the
  sigchain, and wraps UIS to it.
- **Share** to a teammate — resolve references, wrap the DEK to the recipient
  UIK public key (resolved via Key Transparency with TOFU pinning), Ed25519-sign,
  relay ciphertext; the recipient unwraps. Default on accept is
  **create-new-never-auto-merge**, suffixing on a slug clash.
- **Team-join** — an existing member wraps the team seed to the new member's UIK
  once, `O(1)`, granting history.
- **Rotate a value** — fresh DEK, wrap only to current readers; removed parties
  are absent; old versions are garbage-collected.
- **Revoke** — rotate the team seed to survivors `O(survivors)`, lazily re-wrap
  DEKs, rotate the upstream value.

**Key Transparency.** An append-only signed log of email-to-UIK mappings;
clients auto-verify inclusion and consistency proofs and TOFU-pin a contact on
first share; independent gossip witnesses provide anti-equivocation even when
self-hosted. v1 ships the signed log plus auto-self-audit plus TOFU pinning;
gossip witnesses follow.

## Consequences

**Positive**

- The server operator can never read secrets; the server holds only ciphertext
  and public material. There is no operator master key to steal or compel.
- Identity rotation is cheap (`O(devices + memberships)`, not `O(secrets)`)
  because UIK only unwraps a small set of seeds.
- Sender authentication and recipient-set tamper detection are built into the
  envelope.
- Key Transparency plus TOFU pinning defends against a malicious key directory,
  even self-hosted.
- The optional `SecretKey` second factor protects a stolen server blob against
  a weak passphrase.

**Negative / honest non-goals (documented, not hidden)**

- **No forward secrecy at rest.** A leaked long-term key is retroactive over
  the data it can reach. This is inherent and accepted for durable
  random-access storage, and is exactly why messaging-style ratchets were
  rejected.
- **Metadata is visible** to a server operator (names, sizes, the
  who-shares-with-whom graph), even though values never are.
- A **share is a point-in-time copy**; later rotation does not auto-propagate
  unless re-shared.
- **Rotation cannot un-leak** plaintext already seen, so pair it with upstream
  key rotation. **ACL removal alone is not revocation** — true revocation
  requires team-seed rotation and re-wrap as above.
- **No account recovery in this version** — see
  [ADR 0008](0008-no-account-recovery-in-v1.md).
- Node cannot guarantee zeroing secrets from memory because of garbage
  collection; we minimize plaintext lifetime but cannot promise a wipe.

## Alternatives considered

- **Server-side encryption with an operator key** — trivially lets the operator
  read everything; defeats the entire premise. Rejected.
- **Messaging-style ratchets (forward secrecy)** — incompatible with durable,
  random-access storage that must be re-readable at any time. Rejected; we
  document the no-forward-secrecy-at-rest tradeoff instead.
- **A plain key directory without transparency** — vulnerable to a malicious or
  compromised directory substituting public keys. Rejected in favor of Key
  Transparency with TOFU pinning.
- **Wrapping every DEK directly to device keys** — would make identity rotation
  `O(secrets)`. Rejected in favor of the UIK/seed indirection.
