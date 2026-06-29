# 9. Local unlock model: passphrase root + Touch-ID-gated keychain cache

## Status

Accepted

## Context

[ADR-0007](0007-project-world-sandbox-human-gated-admission.md) established that
admission requires proof of human presence (Touch ID / OS password). The at-rest
layer encrypts the global store with a key derived from a **master passphrase**
(Argon2id). But the plans never specified how the store gets _unlocked_
day-to-day: the key was "derived in client memory only," there is "no daemon,"
and Touch ID was described only as an admission presence gate — never as
something that releases a decryption key. Read literally, every fresh `lockit`
process would need the passphrase retyped. Users expect the 1Password
experience: passphrase once, then fingerprint. The two concerns the plans
conflated are **decryption capability** (rooted in the passphrase) and
**proof-of-presence** (Touch ID), which must be separated.

## Decision

Adopt a single-mechanism unlock model (full spec:
[`../superpowers/specs/2026-06-17-local-unlock-model-design.md`](../superpowers/specs/2026-06-17-local-unlock-model-design.md)).

- **Passphrase is the root.** `AK = Argon2id(passphrase)`. The store payload is
  encrypted under a random **DEK**, and the DEK is kept **wrapped under AK**
  (`wrapKey`/`unwrapKey` in `@lockit/crypto`). The DEK indirection lets the unlock
  path be re-keyed without re-encrypting the store.
- **The cache is an encrypted, Touch-ID-gated keychain item.** After one
  passphrase unlock, the DEK is stored in the OS keychain, OS-encrypted with a
  key held in the **Secure Enclave**, and released under a Touch-ID access
  policy. Auto-lock (sleep / idle timeout / `lockit lock`) evicts it.
- **One access-policy dial.** Personal use reads the cached DEK with a
  **per-session** policy (smooth daily work); **agent-initiated** access reads it
  with a **per-use** policy — a native fingerprint prompt every single time,
  releasing the value into the child process only.
- **Off-device falls back to the passphrase.** SSH types it; CI supplies it as a
  secret (the deliberately-weaker mode). There is no Enclave there to cache
  against.
- **The crypto root is a dedicated lockit passphrase**, never the OS account
  password, so rotating the Mac password cannot orphan the vault.

## Consequences

- **The agent boundary becomes structural.** A human fingerprint is in the loop
  on every agent-initiated access; the agent cannot unlock the store on its own.
- **Honest limit unchanged.** The prompt gates the _grant_, not what the child
  does afterward: once injected, a value can still be exfiltrated through a
  command the agent was allowed to run. Containment, not omnipotence.
- **The cache is only as strong as the Secure Enclave**, and exists only on
  device. CI/SSH security rests on passphrase handling, with the CI env-var path
  explicitly weaker.
- **Layering.** `@lockit/crypto` ships `wrapKey`/`unwrapKey` now; the DEK-wrapped
  store lands in P3; the keychain cache, auto-lock, LocalAuthentication provider,
  and per-use vs per-session policy land in P4; passphrase/`LOCKIT_PASSPHRASE`
  fallbacks land in P5.

## Alternatives considered

- **Re-derive from the passphrase every use (no cache).** Most secure, but
  defeats the fingerprint UX users expect; rejected as the default (still
  available as the off-device fallback).
- **Cache the key in a plaintext session file gated by an app-level presence
  check.** Simpler and cross-platform, but the key sits readable on disk and the
  biometric is advisory; rejected for the trust root in favor of Enclave-backed
  release.
- **Derive the vault key from the macOS account password.** Tempting "one
  password," but couples vault access to OS password policy and rotation and has
  no meaning off-device; rejected.
