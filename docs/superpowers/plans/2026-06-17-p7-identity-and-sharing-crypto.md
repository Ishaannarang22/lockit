# Identity + End-to-End Sharing Crypto Implementation Plan (Intended)

> Status: INTENDED — scope-level. Expand into bite-sized failing-test-first TDD steps just-in-time, aligned with the repo state at that time. Plan #1 (docs/superpowers/plans/2026-06-17-p0-scaffold-and-crypto-foundations.md) is the worked example of the target granularity.

**Goal:** Build the client-side identity layer (per-device keypairs + Ed25519 device sigchain, the User Identity Seed/UIK and personal/team seeds) and the end-to-end sharing path (a portable, operator-blind share artifact and its create-new-never-auto-merge accept) so that two distinct identities can share a secret over *any* channel — all before, and independent of, any server.

**Depends on:** Plan #2 (`@lockit/crypto` asymmetric envelope — X25519/HPKE wrap, Ed25519 signatures, the seed-triple expansion) and Plan #3 (`@lockit/core` encrypted store + Sets/Slots vault model, reference resolution).

**Packages touched:** `packages/crypto` (identity/sigchain/share-artifact/KT primitives, pure + I/O-free) and `packages/core` (binds those primitives to the store: reference resolution for share, slug-clash suffixing on accept, the local TOFU pin record and device-state persistence). No `packages/server` work — sharing here must function purely client-to-client (e.g. a copy-pasted artifact, a file, any out-of-band channel).

---

## Scope — what this subsystem builds

- **Per-device keypairs + enrollment.** Generate a device key `DK` (X25519 + Ed25519 via the seed-triple) whose private half never leaves the device. Generate the user's `UIS` (→ `UIK`), `PVS` (→ `PVK`), and any team seeds. The first device bootstraps the identity; the public material + wrapped-at-rest blobs are what *could* later be uploaded, but enrollment itself is local.
- **The Ed25519 device sigchain.** An append-only, self-signed-then-chained log of device-add (and device-revoke) entries. Each entry names a device public key and is signed by an already-trusted key, rooted at the genesis device. Verification re-walks the chain and rejects any break, fork, out-of-order, or unsigned entry.
- **Second-device enrollment via a short authenticated code.** A new device generates its own `DK` locally. An existing trusted device and the new device derive a short human-comparable code from a fresh ephemeral exchange; the human compares the codes out of band; on match, the trusted device signs the new device into the sigchain and wraps `UIS` (the seed, conveying `UIK`) to the new device's public key. The new device then derives `UIK` locally. The private `DK` never traverses any channel.
- **Personal / team seeds in the ladder.** `PVS` is generated and hard-excluded from any wrap-to-another-person path. Team seeds are HPKE-sealed to a member's `UIK` public key (team-join), establishing the team sharing boundary. (Team-join *mechanics* may be thin here; the structural exclusion of `PVS` from sharing is in scope and tested.)
- **Creating a share artifact.** Given a reference to a secret, resolve it to the concrete value/DEK (via `@lockit/core`), wrap the DEK to the recipient's `UIK` public key, Ed25519-sign the envelope over the recipient stanza set, and emit a single portable, self-describing ciphertext artifact (base64/JSON) that carries no plaintext and no private material.
- **Accepting a share artifact.** Verify the sender signature and the envelope integrity, resolve and pin the sender's key (TOFU), unwrap the DEK with the recipient's `UIK`, and **CREATE a new slot — never auto-merge**: on slug clash, deterministically suffix to a fresh slug. The accept is a point-in-time copy.
- **A Key Transparency client with TOFU pinning.** A local store of `email → UIK` pins. First contact pins; a later differing key for a pinned contact raises a structured alert (it never silently re-pins). Inclusion/consistency-proof verification against an append-only log is stubbed against the proof interface so the server plan can supply a real log later.

---

## Files / modules to create or modify — concrete paths + one-line responsibility

**`packages/crypto` (pure, I/O-free):**

- `packages/crypto/src/identity.ts` — generate/derive an identity: `UIS`→`UIK`, `PVS`→`PVK`, device `DK`; expose public-key extraction.
- `packages/crypto/src/sigchain.ts` — build and verify the append-only Ed25519 device sigchain (genesis, add-device, revoke-device entries).
- `packages/crypto/src/enroll-code.ts` — derive and compare the short authenticated code for second-device enrollment from an ephemeral exchange.
- `packages/crypto/src/share-artifact.ts` — encode/decode + sign/verify the portable share artifact (recipient stanzas, sender signature, AEAD payload).
- `packages/crypto/src/kt-client.ts` — TOFU pin model + pin/lookup/verify-change logic; the inclusion/consistency-proof verification interface (proof verification pure; log fetching is the consumer's job).
- `packages/crypto/src/index.ts` — re-export the new public surface (modify).

**`packages/core` (binds crypto to the store/disk):**

- `packages/core/src/sharing/create-share.ts` — resolve a reference → DEK, call `share-artifact` to produce the artifact for a recipient `UIK`.
- `packages/core/src/sharing/accept-share.ts` — verify + unwrap an artifact, apply create-new-never-auto-merge with slug-clash suffixing into the store.
- `packages/core/src/identity/device-state.ts` — persist/load this device's key material (wrapped at rest) and the local sigchain view.
- `packages/core/src/identity/kt-pins.ts` — persist/load the local TOFU pin set; surface the "contact key changed" alert to callers.

(Exact paths align to the repo's `@lockit/core` layout at expansion time; if Plan #3 chose a different folder shape, mirror it.)

---

## Key components & responsibilities

**Identity & seeds.** All seeds are 32-byte and expand via the Plan #2 seed-triple. `UIK`'s sole job is to unwrap a small set of seeds, keeping identity rotation `O(devices + memberships)`. `PVS` is generated like any seed but is structurally barred from the wrap-to-recipient API.

```ts
interface DeviceKeyPair { sign: Ed25519KeyPair; agree: X25519KeyPair } // private halves device-local
interface Identity { uik: SeedTriple; pvk: SeedTriple; device: DeviceKeyPair }
function generateIdentity(): Identity;            // first-device bootstrap
function uikPublicKey(id: Identity): Uint8Array;  // the shareable identity public key
```

**Sigchain.** Append-only; each entry signed by a key already trusted in a prior entry (genesis self-roots). Verification is total: it walks from genesis and rejects forks, gaps, reordering, unknown signers, and bad signatures.

```ts
type SigchainEntry =
  | { kind: "genesis"; devicePub: Uint8Array; sig: Uint8Array }
  | { kind: "add-device"; devicePub: Uint8Array; signerPub: Uint8Array; prev: Uint8Array; sig: Uint8Array }
  | { kind: "revoke-device"; devicePub: Uint8Array; signerPub: Uint8Array; prev: Uint8Array; sig: Uint8Array };
function verifySigchain(entries: SigchainEntry[]): { trustedDevices: Uint8Array[] }; // throws on any break
```

**Enrollment code.** A short (e.g. 6+ digit / word) code derived deterministically from both sides' ephemeral public material so a MITM on the channel cannot make both codes match. Comparison is constant-time-ish on the derived code; the human is the out-of-band check. On success the trusted device emits an `add-device` entry + an HPKE wrap of `UIS` to the new device.

**Share artifact.** A self-describing record: version tag, recipient stanzas (`{ recipientUikId, hpkeWrappedDEK }`), an Ed25519 sender signature over the canonical stanza set, and the XChaCha20-Poly1305 payload. It is the on-wire form of the Plan #2 envelope, serialized for any channel. It contains *no* plaintext, *no* private key, *no* seed.

```ts
function createShareArtifact(value: Uint8Array, recipientUikPub: Uint8Array, sender: Identity): string;
function openShareArtifact(artifact: string, recipient: Identity): { value: Uint8Array; senderUikId: string };
```

**Accept (create-new-never-auto-merge).** `accept-share` never overwrites or merges into an existing slot. On slug collision it suffixes deterministically (e.g. `-2`, `-3`, …) and creates a fresh slot, recording provenance as a point-in-time copy.

**KT client / TOFU.** A pin is `{ email, uikPub, pinnedAt }`. `lookupOrPin` returns the pinned key or pins on first contact; `checkContactKey` flags a mismatch as a structured alert rather than silently trusting. Proof verification (`verifyInclusion`, `verifyConsistency`) is pure over a supplied proof + root, so the later server plan supplies real log roots.

---

## Tests that prove it — emphasizing the security properties

- **Second-device enrollment round-trip.** A genesis identity enrolls a second device: the short codes match only when the ephemeral exchange is untampered; after success the second device, using *only* its own `DK` and the wrapped `UIS` it received, derives the same `UIK` and can unwrap what the first device could. Assert the second device's private `DK` is never present in any emitted artifact.
- **Enrollment code rejects a MITM.** If the ephemeral material is swapped (simulated channel attacker), the two derived codes differ — proving the code binds the actual exchange and a human mismatch would catch the attack.
- **Sigchain integrity.** A well-formed chain verifies and yields the expected trusted-device set; mutating an entry, reordering entries, dropping the genesis, forging a signer not yet in the chain, or splicing a fork each causes `verifySigchain` to throw. A revoked device is absent from the trusted set.
- **Share → accept round-trip between two distinct identities.** Identity A creates an artifact for identity B's `UIK`; B opens it and recovers the exact original value; a *third* identity C cannot open the same artifact (no stanza for C). The sender id reported on open equals A's `UIK` id.
- **Operator-blind property (no plaintext in the artifact).** Serialize an artifact for a known plaintext and assert the plaintext bytes (and any obvious encodings of them) never appear anywhere in the artifact; assert no private key or seed bytes appear either. Anyone holding only the artifact (a stand-in for the relay/operator) cannot recover the value.
- **Tamper / forged-sender rejection.** Flipping a payload byte, altering a recipient stanza, or swapping in a different sender signature each make `openShareArtifact` fail — proving sender authentication and recipient-set integrity carry over to the portable form.
- **PVS is hard-excluded from sharing.** Attempting to create a share artifact whose DEK is wrapped to/derived from `PVS`, or to seal `PVS` to another identity, fails by construction — the personal vault is structurally non-shareable.
- **KT TOFU: pin on first contact, alert on change.** First lookup of a contact pins its `UIK`; a subsequent lookup returning a *different* `UIK` for that contact raises the structured "contact key changed" alert and does not silently re-pin. A repeated lookup of the unchanged key is a clean hit.
- **KT proof verification.** A valid inclusion proof verifies against the matching root; a tampered proof or wrong root fails — so a forged log view is rejected by the client.
- **Point-in-time-copy semantics.** After accept, rotating the *source* secret on A's side does not change B's accepted copy (no auto-propagation); re-sharing is required to convey the new value. Assert B's value is unchanged after an A-side rotation.
- **Create-new-never-auto-merge on slug clash.** Accepting an artifact whose slug already exists in B's store creates a new suffixed slot and leaves the existing slot byte-for-byte untouched (never merged, never overwritten).

---

## Out of scope / deferred

- **The server / relay, OPAQUE login, and a real append-only KT log with gossip witnesses** — Plan #8. Here the KT client verifies *supplied* proofs and pins locally; nothing is fetched over a network.
- **Team-join at scale and team-seed rotation / revocation flows** — the structural team boundary (`PVS` exclusion, seal-to-`UIK`) is exercised, but `O(survivors)` revocation, lazy re-wrap, and upstream-value rotation are deferred to a later sharing/rotation pass.
- **Account recovery** — not in v1; lost passphrase + lost devices is unrecoverable by design.
- **CLI surface for `lockit share` / `lockit accept` / `lockit device enroll`** — Plan #5 wires commands onto these primitives.
- **Native-crypto hotpath optimization** (`sodium-native`) — a later hardening pass.

## Open questions

- **Short-code construction:** digit string vs. word list, length, and the exact ephemeral-exchange shape (SAS-style commit/reveal vs. plain ECDH-derived) — pick the construction that makes the MITM-divergence test cleanest while staying human-comparable.
- **Slug-suffix policy:** numeric `-N` vs. a sender-tag suffix; how provenance (who shared, when) is recorded on the new slot.
- **Sigchain entry hashing/canonicalization:** the exact canonical byte encoding signed per entry and how `prev` links are computed (hash of prior entry) — must be fixed before signatures are stable.
- **Artifact serialization format:** reuse the Plan #2 envelope's wire shape verbatim vs. a thin share-specific wrapper carrying the sender `UIK` id and a version tag.
- **Where the local TOFU pin set and device state live on disk** and how they wrap at rest — should reuse Plan #1's passphrase seal and align with Plan #3's store layout.
