# Local Unlock Model — Design Spec

**Status:** Approved (2026-06-17). Supersedes the under-specified unlock behavior implied by the
key ladder in [`security-crypto.md`](../../security-crypto.md) and the admission flow in P4.

## Problem

The at-rest layer (P0) encrypts the global store with a key derived from a **master passphrase**
(Argon2id → key → XChaCha20-Poly1305). But the plans never said _how the store gets unlocked
day-to-day_: the key was "derived in client memory only," there is "no daemon," and Touch ID was
described only as a **presence gate at admission** — never as something that releases a decryption
key. Taken literally, that means a fresh `lockit` process would need the passphrase retyped on every
use. Users reasonably expect the 1Password experience: **passphrase once, then fingerprint.**

This spec pins the unlock model and separates two things the plans conflated:

1. **Decryption capability** — rooted in the passphrase.
2. **Proof-of-presence** — Touch ID / OS password, used to _release_ a cached key and to gate
   agent-initiated access.

## The model — one mechanism

> The master passphrase derives the store key. That key is cached as an **encrypted,
> Touch-ID-gated item in the OS keychain**. _How often_ Touch ID is demanded is a per-context
> access-policy flag. Off the Mac (no Secure Enclave) there is no cache — you provide the
> passphrase.

Encrypting the cached key only buys security because the keychain's wrapping key lives in the
**Secure Enclave** — somewhere strictly safer than the passphrase. That is the entire reason the
cache is sound, and the reason it cannot exist off-device.

### Key hierarchy (this slice)

```
passphrase ──Argon2id──▶ AK (account key)
                          │ wraps
                          ▼
                     DEK (random per store)  ──AEAD──▶ encrypted store
```

- **AK** = `deriveKey(passphrase, salt, params)` (P0, exists).
- **DEK** = a random 32-byte key that actually encrypts the store payload. The store keeps the DEK
  **wrapped under AK** (`wrapKey(DEK, AK)`). The DEK indirection means we can re-key the unlock
  path (cache, rotate, add a second factor) **without re-encrypting the store**.
- **Cache** = the DEK (or AK) stored in the OS keychain, OS-encrypted, released under a Touch-ID
  access policy. Auto-lock evicts it.

### Unlock paths

| Situation                   | Unlock                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You, at your Mac**        | Passphrase once per session → unwrap DEK → cache DEK in the Secure-Enclave-gated keychain. Subsequent uses release it via Touch ID. Auto-lock on sleep/idle evicts the cached DEK.                                                                                  |
| **Agent-initiated request** | Cached item is read with a **per-use** Touch-ID policy: the agent blocks, a native prompt shows _which app + which keys_, your fingerprint releases the value into the **child process only**, every single time. The agent never sees the passphrase or the value. |
| **SSH**                     | No keychain access; type the master passphrase at the prompt (re-derives AK, unwraps DEK). Never stored.                                                                                                                                                            |
| **CI / unattended**         | Master passphrase supplied as a CI secret/env var. Works, but that runner then holds the key to the whole store — the deliberately-weaker mode; prefer per-secret injection long-term.                                                                              |
| **AI agent on its own**     | Never unlocks. No biometric to satisfy, never handed the passphrase. It may _request_ admission; a human fingerprint is always in the loop.                                                                                                                         |

### The Touch-ID access-policy dial

One mechanism, two policies set on the keychain item:

- **Per-session** (personal use): one Touch ID release per unlock window; smooth daily work.
- **Per-use** (agent-initiated): `require Touch ID on every read` → the "ask every single time"
  behavior, with no reuse window.

### Auto-lock

The store "locks" by evicting the cached DEK from the keychain (and zeroing the in-memory copy as
best the runtime allows). Triggers: system sleep, an idle timeout (default 15 min, configurable),
and explicit `lockit lock`. After lock, the next use needs the passphrase again.

## Layering — what's built now vs deferred

| Piece                                                                                              | Layer                 | When                  |
| -------------------------------------------------------------------------------------------------- | --------------------- | --------------------- |
| `wrapKey` / `unwrapKey` (symmetric key wrap)                                                       | `@lockit/crypto` (pure)   | **Now** (this change) |
| DEK indirection + wrapped-DEK store envelope                                                       | `@lockit/core` store      | P3                    |
| Keychain cache (read/write/evict), auto-lock policy                                                | `@lockit/core` + platform | P4                    |
| Touch ID / OS-password presence via macOS LocalAuthentication; per-use vs per-session access flags | `AuthProvider`        | P4                    |
| Agent-initiated per-use prompt wired through admission/`lockit run`                                    | `@lockit/core` + `cli`    | P4 / P5               |
| Passphrase prompt (SSH) + `LOCKIT_PASSPHRASE` (CI, opt-in) fallbacks                                   | `cli`                 | P5                    |

A _fully working_ fingerprint-unlock therefore lands with P3 + P4 + native macOS code. This spec
builds the crypto foundation now and makes the rest build-ready.

## Crypto additions to `@lockit/crypto` (now)

Pure, I/O-free, AEAD-backed symmetric key wrap with domain separation:

```ts
/** Wrap a 32-byte key under a 32-byte KEK (AEAD, domain-separated). */
wrapKey(key: Uint8Array, kek: Uint8Array): Promise<SealedBytes>;

/** Unwrap a key previously wrapped under `kek`; rejects on wrong KEK or tampering. */
unwrapKey(wrapped: SealedBytes, kek: Uint8Array): Promise<Uint8Array>;
```

A fixed AAD (`kv:keywrap:v1`) domain-separates wrapped keys from generic AEAD payloads. Both
ends enforce a 32-byte key length. These are the primitive the DEK indirection and the keychain
cache are built from.

## Threat model & honest limits

- **The agent boundary is now structural, not engineered:** a human fingerprint is in the loop on
  every agent-initiated access, so the agent _cannot_ unlock the store on its own.
- **Containment, not omnipotence (unchanged honest limit):** the per-use prompt controls the
  _grant_. Once you approve and the value is injected into the command the agent runs, that child
  process holds the real secret while using it and could exfiltrate it through a command it was
  allowed to run. The fingerprint gate makes access deliberate and auditable; it does not make the
  value un-leakable afterward.
- **The cache is only as strong as the Secure Enclave:** off-device (CI/SSH) there is no Enclave,
  so the only unlock is the passphrase, with the CI gradient noted above.
- **Dedicated passphrase, not the OS account password:** the crypto root is a lockit-owned passphrase.
  A user may choose the same string as their macOS login, but lockit never _derives from_ the OS
  password — so rotating the Mac password cannot orphan the vault.

## Open / future

- CI hardening: scoped, short-lived unlock tokens instead of a full passphrase env var.
- Cross-platform: macOS Touch ID first; Linux (libsecret) / Windows (Hello) presence providers and
  a passphrase fallback behind the same `AuthProvider` seam.
- Optional second factor (passkey/hardware token) XORed into AK, per the existing key ladder.
