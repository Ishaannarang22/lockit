# key_manager — Implementation Plan Index

The `key_manager` monorepo is built as a sequence of one-plan-per-subsystem implementation
plans. Each plan is independently auditable and depends only on the plans before it. This index
lists all eight plans in build order with scope, dependencies, status, and the tests that prove
each subsystem.

The packages form an inward dependency graph: `@kv/crypto` is the pure, I/O-free trust root;
`@kv/core` builds the data + sandbox layer on top of it; `@kv/cli` wraps `core`; the Claude
plugin is unprivileged sugar over the CLI; and the optional self-hosted server stores and relays
only ciphertext.

---

## Plans in build order

### 1. P0 Scaffold + Crypto Foundations
- **Filename:** `2026-06-17-p0-scaffold-and-crypto-foundations.md`
- **Status:** DETAILED / READY — the worked example of bite-sized failing-test-first TDD granularity.
- **Scope:** Stand up the pnpm/TypeScript monorepo (vitest, eslint, CI) and build the `@kv/crypto` at-rest foundation: Argon2id key derivation, XChaCha20-Poly1305 AEAD, the versioned sealed-blob format, and passphrase seal/open.
- **Dependencies:** None (root of the sequence).
- **Proving tests:** AEAD seal/open round-trip with AAD binding, tamper and wrong-key rejection, deterministic Argon2id derivation, sealed-blob encode/decode with version rejection, and passphrase round-trip with fresh-salt/nonce per seal and wrong-passphrase failure.

### 2. Crypto Envelope & Keys
- **Filename:** `2026-06-17-p2-crypto-envelope-and-keys.md`
- **Status:** INTENDED.
- **Scope:** Build the asymmetric sharing trust root in `@kv/crypto`: X25519 keypair generation, the HKDF-SHA256 seed-triple expansion, HPKE Auth-mode wrap/unwrap of a per-item DEK, Ed25519 sign/verify, and the age-style multi-recipient envelope.
- **Dependencies:** Plan #1 (`aead`/`kdf` primitives and blob encoding conventions).
- **Proving tests:** HPKE wrap/unwrap round-trip with wrong-recipient and sender-binding rejection, multi-recipient seal where each recipient opens but non-recipients cannot, signature forgery rejection, header-HMAC detection of stanza strip/swap/insert, and seed-triple determinism with domain separation.

### 3. Core: Store & Vault Model
- **Filename:** `2026-06-17-p3-core-store-and-vault-model.md`
- **Status:** INTENDED.
- **Scope:** Build `@kv/core`'s data layer: the encrypted slug-keyed global store of Secrets, the value-free project vault of Slots, the built-in schema registry, the strict 0/1/N resolver, the per-environment axis, and the gitignored local resolution cache.
- **Dependencies:** Plan #1 (`@kv/crypto` at-rest seal/open). Asymmetric crypto is NOT required.
- **Proving tests:** Store at-rest round-trip with wrong-passphrase failure and no value in the ciphertext, slug-keyed no-collision, value-free listings, resolver 0/1/N for pinned and open slots, duplicate-inject-name hard error, per-environment selection, and value-free self-healing local cache.

### 4. Core: Sandbox, Admission & Injection
- **Filename:** `2026-06-17-p4-core-sandbox-admission-and-injection.md`
- **Status:** INTENDED.
- **Scope:** Build the project-world sandbox (the admitted set), the human-gated admission flow with a pluggable `AuthProvider`, the `kv run` in-memory injection engine (env + file secrets, output masking, dry-run preview), the audit log, and the agent-safe listing surface.
- **Dependencies:** Plan #3 (store + Sets/Slots + resolver) and Plan #1 (at-rest primitives).
- **Proving tests:** Agent cannot bypass admission (deny-mock admits nothing, no alternate code path), auth called exactly once per batch, refusal admits nothing, injection isolation (value in child env but absent from parent and disk), run-time sandbox enforcement, output masking, file materialize-and-shred at `0600`, dry-run carries no values, and value-free audit + listing.

### 5. CLI
- **Filename:** `2026-06-17-p5-cli.md`
- **Status:** INTENDED.
- **Scope:** Build the `kv` binary — the verb-first command surface over `@kv/core` for secret/slot/link/status/run commands — where values enter only via prompt or stdin (never argv), every agent-facing output is value-free, and `share` is a stable deferred stub.
- **Dependencies:** Plan #3 (`@kv/core` store/vault) and Plan #4 (`@kv/core` sandbox + admission). Transitively Plan #1.
- **Proving tests:** Integration tests that build and spawn the real compiled `kv` binary in a temp HOME/project — values from argv are refused, stdin path leaks nothing, `ls`/`status`/`--dry-run` are value-free, ambiguous resolution is a structured chooser, injection at `run` masks child output and keeps values out of the parent process and `kv`'s own output, plus a pinned exit-code contract.

### 6. Claude Plugin
- **Filename:** `2026-06-17-p6-claude-plugin.md`
- **Status:** INTENDED.
- **Scope:** Ship the `plugin/` Claude Code plugin — a manifest, an agent-safe-usage skill, and a `PreToolUse` egress-guardrail hook (provider-pattern + high-entropy detector) — as a thin, unprivileged layer over the `kv` CLI that teaches agents to use secrets via `kv run` without seeing values.
- **Dependencies:** Plan #5 (the `kv` CLI it wraps as a subprocess).
- **Proving tests:** Provider-pattern and high-entropy detection without false positives or value leakage, file-write and command egress caught while clean input and `kv run` invocations pass, manifest validity, and skill content lints (uses `kv run` / never reads values, human-gated admission, honest containment limit).

### 7. Identity & Sharing Crypto
- **Filename:** `2026-06-17-p7-identity-and-sharing-crypto.md`
- **Status:** INTENDED.
- **Scope:** Build the client-side identity layer (per-device keypairs, Ed25519 device sigchain, UIS/UIK and personal/team seeds, short-code second-device enrollment) and the end-to-end sharing path (a portable operator-blind share artifact with create-new-never-auto-merge accept), plus a TOFU-pinning Key Transparency client. Works purely client-to-client.
- **Dependencies:** Plan #2 (asymmetric envelope) and Plan #3 (`@kv/core` store + reference resolution).
- **Proving tests:** Second-device enrollment round-trip with MITM-divergence on the short code, total sigchain verification (rejects fork/gap/reorder/forge/revoke), share→accept between two identities with a third excluded, operator-blind artifact (no plaintext/private material), tamper/forged-sender rejection, structural exclusion of the personal seed from sharing, TOFU pin-on-first-contact with change alert, and point-in-time-copy accept semantics.

### 8. Single-Team Server
- **Filename:** `2026-06-17-p8-single-team-server.md`
- **Status:** INTENDED.
- **Scope:** Build `packages/server` — the optional, self-hosted, single-team end-to-end encrypted sync/sharing relay that stores and forwards only ciphertext, public material, and access metadata: member/device registries, OPAQUE login, the sharing relay, the shared team vault with O(1) join, and a Key Transparency Merkle log.
- **Dependencies:** Plan #7 (identity + sharing crypto). Transitively Plans #1–#4.
- **Proving tests:** End-to-end integration over an ephemeral memory store, the zero-knowledge property (dump stored state and assert no passphrase/private key/seed/DEK/plaintext is present, and the wire schema rejects plaintext-shaped fields), O(1) team-join that reads full history, KT inclusion/consistency proof verification, sigchain-tamper rejection, relay tamper detection, OPAQUE password-blindness, and append-only enforcement.

---

## Testing strategy

- **Toolchain established in Plan #1.** vitest, eslint/prettier, strict TypeScript, and the GitHub Actions CI workflow (`typecheck` + `lint` + `test` + `build`) are stood up in Plan #1 and reused by every later package. Tests are colocated as `*.test.ts` next to source.
- **Crypto and core get heavy unit + property tests.** The crypto layers (Plans #1, #2, #7) and the core data/sandbox layers (Plans #3, #4) carry dense unit tests plus property-style tests for security invariants: round-trip equivalence, tamper/wrong-key/wrong-recipient rejection, KDF and seed-triple determinism, and the resolver's 0/1/N behavior.
- **The CLI gets integration tests that spawn the binary.** Plan #5 builds and spawns the real compiled `kv` binary (temp HOME, temp project), asserting output masking at `run` and that every agent-facing output — listings, status, dry-run, the ambiguous chooser, and `kv`'s own non-child output — never contains a secret value.
- **The sandbox auth is an injectable `AuthProvider`.** Plan #4 routes admission through one `AuthProvider` seam, mocked in CI so the agent path can never satisfy proof-of-presence; the deny-mock proves there is no code path that admits a secret without passing the human gate.
- **The server gets a zero-knowledge property test.** Plan #8 drives a full enroll → login → share → team-join → fetch flow, dumps the entire stored state, and asserts no passphrase, private key, seed, DEK, or plaintext value is present anywhere — proving the relay can never decrypt.

---

> Note: only Plan #1 is written to bite-sized failing-test-first granularity. The remaining plans
> are scope-level (INTENDED) and are expanded into detailed bite-sized plans just-in-time, aligned
> with the repo state at that time, using Plan #1 as the worked example of the target granularity.
