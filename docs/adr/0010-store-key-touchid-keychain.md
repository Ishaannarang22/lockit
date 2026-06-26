# 10. Protect the store key with the macOS keychain behind Touch ID

## Status

Accepted. Shipped opt-in in `@lockit/cli@0.5.0`; made the **default** (the key is
born in the keychain and a plaintext key is never written) in `@lockit/cli@0.5.1`.

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

Protect the store key **by default**: it is created directly in the **macOS login
keychain** (generic password) on first use and a plaintext key is never written to disk.
Every read is gated by `LAContext.evaluatePolicy(.deviceOwnerAuthentication)` (Touch ID →
account-password fallback). The keyfile holds only a value-free marker JSON pointing at
the keychain service/account; `resolveKey` transparently unwraps (one Touch ID) when it
sees a marker. A legacy plaintext keyfile is auto-migrated into the keychain (verified)
on next use. Protection is mandatory and cannot be turned off; `LOCKIT_PASSPHRASE` remains
the escape hatch for users who manage their own key (and the path for non-macOS / no-Swift
environments, where lockit refuses to invent a plaintext key). The `lockit protect`
command now only reports status / forces an early migration.

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
  prompts Touch ID once to release the key. This is the point — an agent with shell
  access can no longer read the key from disk. Unattended/CI use sets `LOCKIT_PASSPHRASE`.
- **No double prompts** (`0.5.2`): `admit` / `pull` previously stacked their own
  human-presence gate on top of the key unlock, giving two Touch ID prompts. When the
  key is keychain-protected the unlock *is* the presence proof, so the separate gate is
  skipped (cancelling the unlock still denies the action). The explicit gate remains for
  the plaintext / `LOCKIT_PASSPHRASE` case, where opening the store needs no auth.
- **Self-healing helper re-trust** (`0.6.1`): a keychain item's ACL binds to the cdhash of
  the binary that created it, so a changed helper build makes existing items "foreign" and
  reads pop a keychain-password re-trust dialog. The marker now records `helper` (a hash of
  the Swift source); on a mismatch the resolver re-keys once into a fresh, current-bound
  item (the old foreign item can't be deleted in place, so it orphans — best-effort cleanup).
  Costs one re-trust on the first read after a helper change, then silent. The helper source
  is otherwise treated as frozen (see docs/mistakes-to-consider.md).
- **Unlock session** (`0.6.0`): each `lockit` command is a separate process, so without
  caching a multi-command flow (an agent discovering + admitting a key) prompts Touch ID
  on every command. After one successful unwrap the released key is cached in a second
  keychain item (`<account>.session`), read without re-auth via a no-auth `peek` and
  bound to the helper binary, with an embedded expiry. Default window 90s
  (`LOCKIT_UNLOCK_TTL` seconds; `0` disables); `lockit lock` clears it. Tradeoff (the
  reason the window is short and configurable): within the window a process running as
  you can use the key without a fresh touch — the sudo-timestamp / ssh-agent model. The
  key is still never on disk in plaintext; the session copy lives in the keychain.
- Requires macOS + Xcode Command Line Tools (`swiftc`); otherwise lockit refuses to
  create a key and asks for `LOCKIT_PASSPHRASE` (it will not write plaintext). Existing
  plaintext keyfiles are still read on non-macOS for backward compatibility (with a warning).
- The true non-extractable version needs a **signed + notarized native helper** (a future
  milestone), and the upcoming team **cloud** sync will gate CLI auth on a website login —
  both tracked separately.
