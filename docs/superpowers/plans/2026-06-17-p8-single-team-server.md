# Single-Team Sync/Sharing Server Implementation Plan (Intended)

> Status: INTENDED — scope-level. Expand into bite-sized failing-test-first TDD steps just-in-time, aligned with the repo state at that time. Plan #1 (docs/superpowers/plans/2026-06-17-p0-scaffold-and-crypto-foundations.md) is the worked example of the target granularity.

**Goal:** Build `packages/server` — the optional, self-hosted, single-team end-to-end encrypted sync/sharing relay that stores and forwards only ciphertext, public material, and access metadata, and can never decrypt anything.

**Depends on:** Plan #7 (identity + end-to-end sharing crypto: device enrollment, sigchains, UIK resolution, shareable envelopes). Transitively on the crypto trust root from Plans #1–#2 and the core store/vault from Plans #3–#4. Plan #7 must supply the client-side seal/unseal, envelope format, sigchain construction, and Key Transparency client verifiers that this server stores against and serves to.

**Packages touched:** `packages/server` (new); read-only consumption of `@lockit/crypto` and `@lockit/core` for shared wire types, envelope/sigchain/KT type definitions, and proof verifiers reused in tests. No changes to `crypto`, `core`, `cli`, or `plugin`.

---

## Scope — what this subsystem builds

- A **dumb, append-only, store-and-relay HTTP server** for a single team that holds **only** ciphertext, public keys, never-unwrapped wrapped key material, salts, the OPAQUE record, the Key Transparency log + per-user sigchains, and access-control metadata. It has **no operator master key** and stores no passphrase, private key, seed, DEK, or plaintext.
- **Member and device registries:** enrollment of a member (upload public keys, wrapped blobs, OPAQUE registration record), and append-only device records linked through each member's Ed25519 sigchain.
- **OPAQUE login:** a password-authenticated key exchange where the server authenticates a client without ever seeing a password or password-equivalent, issuing a session token on success.
- **Sharing delivery (relay):** accept a signed encrypted envelope addressed to a recipient and make it retrievable by that recipient; the server never inspects or alters the recipient stanza set or payload.
- **The shared team vault:** an append-only encrypted store of team-shared items (ciphertext + versions + access metadata), readable by any current member who holds the team seed (sealed to their UIK), with O(1) team-join.
- **Key Transparency service:** an append-only signed Merkle log of email-to-UIK mappings, serving inclusion and consistency proofs that clients auto-verify; per-user sigchains stored and served alongside.
- **A `ScopeContext` interface seam:** all storage and query operations are scoped through a context; the single-team default is one concrete implementation. The seam exists so future work can extend scoping without forking. It is a plain interface, nothing more.
- **A no-op `RecoveryProvider` seam:** a plain interface with a single shipped implementation that always declines, reflecting "no account recovery in this version." The seam exists only so a future recovery mechanism could be slotted in without restructuring; v1 ships the decline-everything implementation.
- **An ephemeral, in-memory store implementation** used as the default backing for tests and local self-hosting, behind a storage-port interface so a durable backend can replace it later.

---

## Files / modules to create or modify — concrete paths + one-line responsibility

- `packages/server/package.json` — package manifest; depends on `@lockit/crypto`, `@lockit/core`, an HTTP framework, and `@transparency-dev/merkle`.
- `packages/server/tsconfig.json` — extends the base tsconfig; `src` → `dist`.
- `packages/server/src/index.ts` — public entry: `createServer(deps)` factory and exported types.
- `packages/server/src/app.ts` — wires routes to handlers given injected ports (store, KT log, OPAQUE, scope, recovery).
- `packages/server/src/scope.ts` — `ScopeContext` interface + `singleScope()` default implementation.
- `packages/server/src/recovery.ts` — `RecoveryProvider` interface + `noopRecoveryProvider()` (always declines).
- `packages/server/src/store/port.ts` — `ServerStore` storage-port interface (append-only reads/writes scoped by `ScopeContext`).
- `packages/server/src/store/memory.ts` — `createMemoryStore()` ephemeral in-memory `ServerStore` for tests and local use.
- `packages/server/src/members.ts` — member enrollment + lookup handlers (public keys, wrapped blobs, OPAQUE record).
- `packages/server/src/devices.ts` — append-only device records + sigchain append/verify-on-write handlers.
- `packages/server/src/opaque.ts` — OPAQUE registration + login server-side handlers (server never sees a password-equivalent).
- `packages/server/src/sharing.ts` — submit/fetch/ack handlers for relayed encrypted share envelopes.
- `packages/server/src/team-vault.ts` — append-only team-vault item submit/list/fetch handlers + access-metadata records.
- `packages/server/src/kt/log.ts` — append-only Merkle KT log: append a mapping, produce inclusion + consistency proofs, serve signed checkpoints.
- `packages/server/src/kt/routes.ts` — HTTP handlers exposing the KT log (append, lookup, proofs, checkpoint).
- `packages/server/src/wire.ts` — request/response wire schemas (validated; ciphertext + public material + metadata only) shared with clients via `@lockit/core` types where they exist.
- `packages/server/src/errors.ts` — structured error types (e.g. `PlaintextRejectedError`, `SigchainConflictError`, `ProofUnavailableError`).
- Test files colocated as `*.test.ts` next to each source module, plus an integration suite at `packages/server/src/integration.test.ts` driving the assembled server against the memory store.

---

## Key components & responsibilities

**`ScopeContext` seam.** A plain interface that scopes every storage and query operation. The single-team default returns one fixed scope. Future scoping can add other implementations without touching handlers.

```ts
export interface ScopeContext {
  readonly scopeId: string; // opaque storage namespace for this team
}
export function singleScope(): ScopeContext;
```

**`RecoveryProvider` seam.** A plain interface whose only shipped implementation declines, encoding "no recovery in v1." It exists purely so the shape is stable if recovery is ever added; it grants nothing and stores nothing.

```ts
export interface RecoveryProvider {
  // Always returns { available: false } in v1.
  status(ctx: ScopeContext, memberId: string): Promise<{ available: false }>;
}
export function noopRecoveryProvider(): RecoveryProvider;
```

**`ServerStore` port.** Append-only operations scoped by `ScopeContext`: put/get ciphertext blobs and versions, append device records, append KT log entries, store wrapped blobs / public keys / salts / OPAQUE records / access metadata. The interface forbids overwrite and exposes no decrypt capability. `createMemoryStore()` is the ephemeral default.

**Members & devices.** Enrollment accepts only public keys, wrapped (never-unwrapped) blobs, and the OPAQUE registration record. Device addition is an append to the member's Ed25519 sigchain; the server verifies the new entry's signature chains correctly before accepting, but performs no decryption — it only checks public-key-verifiable links.

**OPAQUE.** Registration stores the server-side OPAQUE record; login runs the OPAQUE message exchange and, on success, issues a short-lived session token. The server never receives a password or any password-equivalent at any step.

**Sharing relay.** A submitted envelope (recipient stanzas + Ed25519 sender signature + header HMAC + AEAD payload) is stored verbatim and made fetchable by the addressed recipient. The server does not and cannot read the payload, and it must not be able to silently rewrite the recipient set without detection by the client.

**Team vault.** Append-only encrypted items with version history and access-control metadata. A new member gains access via O(1) team-join performed client-side (an existing member wraps the team seed to the new member's UIK); the server merely stores the resulting wrapped seed and the access record, after which the new member can fetch and locally decrypt the full history.

**Key Transparency.** An append-only signed Merkle log of email-to-UIK mappings built on `@transparency-dev/merkle`, serving inclusion proofs (this mapping is in the log) and consistency proofs (the new checkpoint extends the old one) plus signed checkpoints. Per-user sigchains are stored and served so clients can verify device evolution. Gossip witnesses are out of scope here (deferred per the crypto design); v1 serves the signed log, proofs, and checkpoints that the client auto-self-audits and TOFU-pins against.

---

## Tests that prove it

- **Integration against an ephemeral store:** assemble the full server over `createMemoryStore()` and drive enroll → login → share → team-join → fetch end to end, asserting each step succeeds with only ciphertext and public material crossing the wire.
- **Zero-knowledge / server never holds plaintext or a usable private key:** after a full enroll + share + team-vault-write sequence, dump the entire memory-store contents and assert that no field decrypts without client keys and that no passphrase, private key, seed, DEK, or plaintext value is present anywhere in stored state. A companion test feeds a request whose body contains a private-key- or plaintext-shaped field and asserts the wire schema rejects it (`PlaintextRejectedError`).
- **A new team member joins in O(1) and can read history:** seed a team vault with N historical versions, perform the join (store the team seed wrapped to the new member's UIK plus one access record — a single append, independent of N), then have the new member's client fetch and locally decrypt every historical version successfully; assert the join did no per-item re-encryption.
- **Key Transparency inclusion proofs verify:** append a member's email→UIK mapping, request the inclusion proof + signed checkpoint, and verify it with the client-side verifier from Plan #7 against the checkpoint root; assert a forged or wrong-leaf proof fails verification.
- **Key Transparency consistency proofs verify:** append further mappings to advance the log, request a consistency proof between an earlier and a later checkpoint, verify it succeeds, and assert that a proof claiming an inconsistent (non-extending) history is rejected.
- **Sigchain tamper rejected:** submitting a device record whose signature does not chain to the member's existing sigchain head is rejected (`SigchainConflictError`); a correctly chained append is accepted.
- **Sharing relay isolation / tamper detection:** a stored envelope round-trips byte-for-byte to the recipient; a server-side mutation of the recipient stanza set or payload is detected by the recipient's client (signature / header-HMAC check fails on open), proving the relay cannot silently alter who-can-read or what-is-read.
- **OPAQUE password-blindness:** drive registration and login through the OPAQUE handlers and assert that no request body or stored record contains the password or any password-equivalent, and that login with the wrong password fails without the server learning the password.
- **Append-only enforcement:** any attempt to overwrite an existing ciphertext/version/log entry via the store port is rejected, locking in the append-only property.
- **Scope seam:** writes made under one `ScopeContext.scopeId` are not readable under a different scope, proving the seam isolates state (the single-team default uses one fixed scope).
- **Recovery is a no-op:** `noopRecoveryProvider().status(...)` always reports unavailable, and there is no server path that yields any key material toward recovery.

---

## Out of scope / deferred

- **Gossip witnesses for Key Transparency anti-equivocation** — deferred per the crypto design; v1 ships the signed log, self-audit proofs, and TOFU pinning only.
- **A durable storage backend** — only the ephemeral in-memory `ServerStore` ships here; a persistent backend slots behind the same port later.
- **Account recovery** — not in v1; the `RecoveryProvider` seam ships only its decline-everything implementation.
- **Native-crypto hotpath optimization, deployment packaging, rate limiting, and operational hardening** — separate later passes.
- **Any client-side flows** (enroll/share/rotate/revoke logic) — those live in `core`/`cli` from Plans #3–#7; this server only stores and relays what those clients produce.
- **Server-side rotation/revocation logic** — revocation is client-driven (team-seed rotation to survivors); the server only stores the resulting new wrapped seeds and access records.

## Open questions

- HTTP framework choice and the exact session-token format/lifetime issued after OPAQUE login.
- Whether the wire layer should structurally reject suspected-plaintext fields by schema shape alone, or also by a size/entropy heuristic (the schema-shape rejection is the baseline test target).
- Exact checkpoint signing-key management for the KT log in a self-hosted deployment, and how a fresh client bootstraps its first trusted checkpoint before TOFU pins exist.
- Whether device-sigchain verification on write should be strict-reject-only or also expose a structured conflict-resolution hint to the client.
- The precise `ServerStore` port surface needed to keep the memory store and a future durable backend interchangeable without leaking storage concerns into handlers.
