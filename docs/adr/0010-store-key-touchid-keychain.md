# 10. Protect the store key with the macOS keychain behind Touch ID

## Status

Accepted (shipped in `@lockit/cli@0.5.0`, opt-in via `lockit protect on`)

## Context

[ADR-0009](0009-local-unlock-model.md) separated **decryption capability** (rooted in
the store key) from **proof of presence** (Touch ID). By default the store key is a
random 32-byte value sitting in a plaintext file at `~/.lockit/key` (mode `0600`). The
encrypted store (`~/.lockit/store.json`, XChaCha20-Poly1305 + Argon2id) is therefore
only as protected as that file: **any process running as the user — including an AI
agent with shell access — can `cat ~/.lockit/key` and decrypt everything.** This is the
honest limit documented since `0.4.x`. We want the key protected by the *same* Touch ID
gate we use for admission, so it cannot be read off disk without a live human
authentication.

The intended mechanism was the **Secure Enclave** (a non-extractable, hardware-bound
key) or a **biometric-ACL keychain item**. We empirically tested whether either is
reachable from our distribution model — an **npm package that shells out to the system
`swift`**, i.e. an **unsigned / ad-hoc-signed** process with no Apple Developer identity.

## Decision

Ship an **opt-in** `lockit protect` command that moves the store key from the plaintext
file into the **macOS login keychain** (generic password), gated on every read by
`LAContext.evaluatePolicy(.deviceOwnerAuthentication)` (Touch ID → account-password
fallback). The keyfile becomes a value-free marker JSON pointing at the keychain
service/account; `resolveKey` transparently unwraps (one Touch ID) when it sees a marker.

- The keychain helper is a **compiled** Swift binary (cached under `~/.lockit/bin`,
  keyed by source hash), **not** the `swift` interpreter — so the keychain item's default
  ACL binds to a stable code identity. Another same-user process reading the item off
  disk hits a keychain prompt instead of getting the bytes.
- Migration is **safe-by-construction**: `protect on` stores the key, then *proves* a
  Touch ID unwrap round-trips to the same bytes **before** overwriting the plaintext
  keyfile; `protect off` writes the plaintext back **before** deleting the keychain item.
- `LOCKIT_PASSPHRASE` still overrides everything and is refused as a `protect` target.

## Why not the Secure Enclave (tested, not assumed)

On this machine (Apple Silicon, Secure Enclave present, Touch ID enrolled), from an
unsigned/ad-hoc `swift`/`swiftc` process:

- **Secure Enclave key creation** (`kSecAttrTokenIDSecureEnclave`, `kSecAttrIsPermanent`)
  → `errSecMissingEntitlement (-34018)`. The Enclave generates the key but refuses to
  persist it without an `application-identifier` / `keychain-access-groups` entitlement.
- **Biometric keychain ACL** (`SecAccessControlCreateWithFlags(.biometryCurrentSet)`)
  → `errSecMissingEntitlement (-34018)`, in both the data-protection and legacy keychains.
- **Faking the entitlement** via ad-hoc `codesign --entitlements` → the process is
  **SIGKILLed at launch** by AMFI (an ad-hoc binary cannot claim restricted entitlements).

These require a real Apple Developer signing identity + notarization, which an
npm-distributed CLI cannot have. So the hardware-bound key is genuinely out of reach in
this distribution model; the keychain + `LAContext` gate is the strongest thing that
works unsigned.

## Honest limit

`evaluatePolicy` is an **authorization gate**, not a cryptographic release: it returns a
boolean, after which our binary reads the keychain item. It is **not** bound to the Touch
ID event the way a Secure Enclave ACL would be. Residual risks for a same-UID attacker:
invoking our helper and socially-engineering the user into approving the prompt, or
riding the unlocked keychain. This is a large improvement over a flat plaintext file —
`cat ~/.lockit/key` yields only a marker, and a live Touch ID is required per use — but it
is not non-extractable hardware protection. The cryptographic root of trust remains the
store key / passphrase; Touch ID is the presence-and-authorization layer.

## Consequences

- Every store-touching command (`set`, `ls`, `admit`, `import`, secure-mode `run`, …)
  prompts Touch ID once when protection is on. Off by default to preserve unattended
  agent workflows; users opt in.
- Requires macOS + Xcode Command Line Tools (`swiftc`) to enable; a clear error otherwise.
- The true non-extractable version needs a **signed + notarized native helper** (a future
  milestone), and the upcoming team **cloud** sync will gate CLI auth on a website login —
  both tracked separately.
