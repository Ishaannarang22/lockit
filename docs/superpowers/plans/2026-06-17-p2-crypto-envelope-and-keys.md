# Crypto Asymmetric Layer: Envelope, HPKE & Keys Implementation Plan (Intended)

> Status: INTENDED — scope-level. Expand into bite-sized failing-test-first TDD steps just-in-time, aligned with the repo state at that time. Plan #1 (docs/superpowers/plans/2026-06-17-p0-scaffold-and-crypto-foundations.md) is the worked example of the target granularity.

**Goal:** Build the asymmetric sharing trust root in `@kv/crypto` — keypair generation, the seed-triple expansion, HPKE wrap/unwrap of a per-item DEK to recipient public keys, Ed25519 sign/verify, and the age-style multi-recipient envelope — so a DEK can be sealed to any set of public keys with sender authentication and recipient-set tamper detection.

**Depends on:** Plan #1 (P0 scaffold + crypto at-rest foundation) — specifically the `aead` (XChaCha20-Poly1305 `aeadSeal`/`aeadOpen`, `randomBytes`) and `kdf`/HKDF primitives, plus the versioned blob/CBOR encoding conventions established there.

**Packages touched:** `packages/crypto` only. This layer remains pure, I/O-free, and independently auditable; no store, CLI, identity, or server concerns enter here.

---

## Scope — what this subsystem builds

- **X25519 keypair generation** — produce key-agreement keypairs (and the helpers to serialize/parse public-key ids) used as recipient targets.
- **The seed-triple expansion** — deterministically expand one 32-byte seed via HKDF-SHA256 with distinct `info` labels into an Ed25519 signing key, an X25519 wrap (key-agreement) key, and an optional symmetric (AEAD) key (per security-crypto.md §5).
- **HPKE (RFC 9180)** — `DHKEM(X25519)` + `HKDF-SHA256` + `ChaCha20-Poly1305`, **Auth mode** — to wrap a per-item DEK to a recipient public key and unwrap it with the recipient private key, binding the wrap to the sender's identity key.
- **Ed25519 sign/verify** — sign arbitrary bytes (the envelope stanza set) and verify, rejecting forged/tampered signatures.
- **The age-style envelope format** — recipient stanzas `{ recipient pubkey id, HPKE-wrapped DEK }`, an Ed25519 sender signature over the full stanza set, a header HMAC keyed from the DEK, and the AEAD payload (XChaCha20-Poly1305 of the value under the DEK), per security-crypto.md §6.
- **Multi-recipient wrapping** — seal one payload to N recipients so each authorized reader can independently unwrap the DEK and open the payload, while non-recipients cannot.

This layer deliberately exposes a **generic wrap-to-public-key** primitive (HPKE seal of a DEK or seed to any recipient public key). The team-sharing boundary and seed-wrapping consumers live in later plans; no recovery feature is built here or anywhere in v1.

## Files / modules to create or modify — concrete paths + one-line responsibility each

- `packages/crypto/src/keys.ts` — X25519 keypair generation, public-key-id derivation, and (de)serialization of key material.
- `packages/crypto/src/keys.test.ts` — keypair shape, public-key-id stability, parse/serialize round-trip.
- `packages/crypto/src/seed-triple.ts` — expand one 32-byte seed via HKDF-SHA256 into `{ ed25519, x25519, sym? }` with domain-separated `info` labels.
- `packages/crypto/src/seed-triple.test.ts` — determinism, label/type separation, distinctness across the three derived keys.
- `packages/crypto/src/hpke.ts` — HPKE Auth-mode `wrapDek`/`unwrapDek` (DHKEM-X25519 + HKDF-SHA256 + ChaCha20-Poly1305) over `@hpke/*`.
- `packages/crypto/src/hpke.test.ts` — wrap/unwrap round-trip, wrong-recipient rejection, suite-id/AAD binding.
- `packages/crypto/src/sign.ts` — Ed25519 `sign`/`verify` (libsodium primary; cross-checkable against `@noble/curves`).
- `packages/crypto/src/sign.test.ts` — sign/verify round-trip, forged/tampered-signature rejection, wrong-key rejection.
- `packages/crypto/src/envelope.ts` — build/parse the age-style envelope: stanzas, sender signature, header HMAC, AEAD payload; `sealEnvelope`/`openEnvelope`.
- `packages/crypto/src/envelope.test.ts` — multi-recipient round-trip, tamper/strip/swap detection, signature rejection.
- `packages/crypto/src/index.ts` — **modify** to re-export the new public API (keys, seed-triple, hpke, sign, envelope).
- `packages/crypto/package.json` — **modify** to add `@hpke/core`, `@hpke/dhkem-x25519`, `@hpke/chacha20poly1305`, `@noble/curves`, `@noble/hashes` (libsodium-wrappers-sumo already present from Plan #1).

## Key components & responsibilities — short prose; illustrative signatures only

**Keys.** X25519 keypair generation and a stable, collision-resistant public-key id (a hash of the raw public key) used to label stanzas so a reader can find the stanza addressed to it without trial-decrypting all of them.

```ts
export interface X25519KeyPair { publicKey: Uint8Array; privateKey: Uint8Array; }
export function generateX25519KeyPair(): Promise<X25519KeyPair>;
export function publicKeyId(publicKey: Uint8Array): Uint8Array; // short stable id
```

**Seed-triple.** One 32-byte seed expands via HKDF-SHA256 with fixed `info` labels (`"orgmesh:ed25519"`, `"orgmesh:x25519"`, `"orgmesh:sym"`) so each derived key is bound to its role by construction; a signing key can never be confused with an agreement key.

```ts
export interface SeedTriple { ed25519: Ed25519KeyPair; x25519: X25519KeyPair; sym?: Uint8Array; }
export function expandSeed(seed32: Uint8Array, opts?: { withSym?: boolean }): Promise<SeedTriple>;
```

**HPKE.** Auth-mode single-shot seal/open of the per-item DEK. `wrapDek` takes the sender's X25519 private key (for Auth binding), the recipient public key, the DEK, and an AAD (the stanza/envelope context); it returns the enc (encapsulated key) plus ciphertext. `unwrapDek` reverses it with the recipient private key and the sender public key, failing if the sender binding or AAD does not match.

```ts
export function wrapDek(args: {
  senderPriv: Uint8Array; recipientPub: Uint8Array; dek: Uint8Array; aad?: Uint8Array;
}): Promise<{ enc: Uint8Array; ct: Uint8Array }>;
export function unwrapDek(args: {
  recipientPriv: Uint8Array; senderPub: Uint8Array; enc: Uint8Array; ct: Uint8Array; aad?: Uint8Array;
}): Promise<Uint8Array>;
```

**Sign.** Ed25519 `sign(message, privateKey)` / `verify(signature, message, publicKey)`. The implementation may use libsodium for signing; verification is the security-critical path and may be cross-validated against `@noble/curves`/`@noble/hashes`.

**Envelope.** `sealEnvelope` generates (or accepts) a per-item DEK, AEAD-seals the payload under the DEK, HPKE-wraps the DEK to each recipient producing one stanza per reader, computes a header HMAC keyed from the DEK over the canonical stanza set, and Ed25519-signs the canonical stanza set with the sender key. `openEnvelope` locates the stanza for the reader's key id, HPKE-unwraps the DEK, **verifies the sender signature**, **recomputes and checks the header HMAC** (detecting any stanza strip/swap/insert), then AEAD-opens the payload. Both signature failure and HMAC failure are hard errors that abort before returning plaintext.

```ts
export interface RecipientStanza { keyId: Uint8Array; enc: Uint8Array; wrappedDek: Uint8Array; }
export interface Envelope {
  v: number; stanzas: RecipientStanza[]; senderSig: Uint8Array; headerHmac: Uint8Array;
  nonce: Uint8Array; payload: Uint8Array;
}
export function sealEnvelope(args: {
  plaintext: Uint8Array; recipients: Uint8Array[]; sender: { signPriv: Uint8Array; signPub: Uint8Array; wrapPriv: Uint8Array };
}): Promise<Envelope>;
export function openEnvelope(args: {
  envelope: Envelope; reader: { wrapPriv: Uint8Array; keyId: Uint8Array }; senderSignPub: Uint8Array;
}): Promise<Uint8Array>;
```

A canonical, deterministic serialization of the stanza set (the bytes the signature and HMAC cover) is required so that signing, verifying, and HMAC are computed over identical bytes; this canonicalization is itself part of the security surface and is tested.

## Tests that prove it — emphasizing security properties

- **HPKE wrap/unwrap round-trip.** `wrapDek` then `unwrapDek` with the matching recipient keypair and sender keys recovers the exact DEK bytes — the foundational sealing primitive works.
- **HPKE wrong-recipient rejection.** A DEK wrapped to recipient A cannot be unwrapped by recipient B's private key; unwrap fails rather than returning garbage — confidentiality of the wrap.
- **HPKE Auth-mode sender binding.** Unwrapping with the wrong sender public key (or mismatched AAD) fails, proving the wrap is bound to the sender identity and cannot be replayed under a forged sender.
- **Multi-recipient: each recipient opens.** An envelope sealed to recipients A, B, C can be opened independently by each of A, B, and C, recovering identical plaintext — every authorized reader gets access.
- **Multi-recipient: non-recipients cannot.** A fourth keypair D, absent from the recipient set, finds no stanza for its key id and cannot unwrap any DEK; opening fails — exclusion actually excludes.
- **Signature verify and forged/tampered rejection.** `openEnvelope` succeeds under a valid sender signature; flipping any byte of a stanza, or substituting a signature made by a different key, causes verification to fail and aborts before plaintext is returned — sender authentication and no-impersonation.
- **Header-HMAC detects recipient strip/swap/insert.** Removing a stanza, swapping two stanzas, or injecting an attacker stanza changes the canonical stanza set so the recomputed header HMAC (keyed from the DEK) no longer matches; open fails — the recipient set cannot be silently altered by a relay or third party.
- **Payload tamper rejection.** Mutating the AEAD payload or nonce causes `aeadOpen` to fail after a valid unwrap — end-to-end integrity of the value.
- **Seed-triple determinism.** Expanding the same 32-byte seed twice yields byte-identical Ed25519, X25519, and symmetric keys; expanding two different seeds yields different keys; and the three keys derived from one seed are mutually distinct (label/type separation) — the derivation is reproducible and domain-separated.
- **Public-key-id stability and uniqueness.** The id of a public key is stable across calls and differs for different public keys, so stanza addressing is reliable.
- **Wrong-passphrase/at-rest interop sanity (regression).** A DEK produced here still seals/opens through the Plan #1 `aead` layer unchanged, confirming the asymmetric layer composes with the at-rest layer without altering it.

## Out of scope / deferred

- The full key ladder rungs (MasterKEK, AccountKey, UIS/UIK, PVS/PVK, Org/Team Seed/TeamKey) and Argon2id production parameter tuning — later plan.
- Wrapping **seeds** to public keys for the team-sharing boundary and team-join (`O(1)` seal of a team seed to a member's UIK) — built on this layer's generic wrap primitive in a later plan.
- Per-device key (`DK`) generation, the device sigchain, and multi-device enrollment — later identity plan.
- Key Transparency, TOFU pinning, OPAQUE, and any server/relay or sync logic — later plans.
- The Sets/Slots vault model, the encrypted store, the project-world sandbox, admission, the CLI, and the plugin — later plans.
- Any account-recovery mechanism — not in v1.

## Open questions

- **Canonical serialization choice for the signed/HMAC'd stanza set.** Reuse the Plan #1 blob/CBOR encoding for deterministic bytes, or define a dedicated fixed-layout header? Whichever is chosen must be canonical (no map-ordering ambiguity) and is itself under test.
- **Header HMAC construction.** Confirm HKDF label/domain separation so the HMAC key derived from the DEK is independent from the AEAD encryption key (avoid key reuse across the HMAC and the payload AEAD).
- **Ed25519 implementation split.** Sign via libsodium and verify via libsodium, with `@noble/curves` as a cross-check in tests — or verify via `@noble/curves` in production? Decide based on audit-surface minimization.
- **DEK ownership.** Should `sealEnvelope` always generate the DEK internally, or accept a caller-provided DEK (needed later for value rotation re-wrapping the same payload semantics)? Likely accept-or-generate; confirm when the rotation flow is planned.
- **Public-key-id length/algorithm.** Choose the hash and truncation length for `publicKeyId` to balance stanza size against collision resistance.
