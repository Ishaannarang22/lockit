# P2 Crypto Envelope & Keys — Test Plan

**Phase:** P2 (crypto envelope & keys)

**Status:** PLANNED — this document describes tests authored just-in-time as features are implemented via TDD.

**Overview:** This phase builds the asymmetric sharing trust root in `@kv/crypto`: keypair generation (X25519 and Ed25519), HKDF-based seed expansion, HPKE Auth-mode DEK wrapping to recipients, Ed25519 signing, and the age-style multi-recipient envelope. All tests are **unit tests** at the crypto layer; no I/O or store integration tested here.

**Dependencies:** Plan #1 (P0) — specifically `aeadSeal`/`aeadOpen` (XChaCha20-Poly1305), `randomBytes`, and HKDF primitives.

---

## 1. X25519 Keypair Generation & Public-Key-ID

### Feature: X25519 keypair generation

| Feature                   | Behavior to test                            | Input / command                                 | Expected output                                                                   | Exit code | Test layer |
| ------------------------- | ------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- | --------- | ---------- |
| X25519 keypair generation | Generates valid public and private key pair | `generateX25519KeyPair()`                       | `{ publicKey: Uint8Array(32), privateKey: Uint8Array(32) }`                       | N/A       | unit       |
| X25519 keypair generation | Each invocation yields distinct keypairs    | Two calls to `generateX25519KeyPair()`          | `kp1.publicKey !== kp2.publicKey && kp1.privateKey !== kp2.privateKey` (by bytes) | N/A       | unit       |
| X25519 keypair generation | Public key is derived from private key      | Generate keypair and derive public from private | Derived public matches generated public                                           | N/A       | unit       |
| X25519 keypair generation | Keys are suitable for X25519 key-agreement  | Use keypair in HPKE wrap/unwrap                 | Wrap and unwrap succeed                                                           | N/A       | unit       |

### Feature: Public-key-id derivation

| Feature                  | Behavior to test                                           | Input / command                                          | Expected output                       | Exit code | Test layer |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- | --------- | ---------- |
| Public-key-id derivation | Computes stable hash of public key                         | `publicKeyId(pk)` on same pk twice                       | Identical bytes both times            | N/A       | unit       |
| Public-key-id derivation | Different public keys yield different ids                  | `publicKeyId(pk1)` vs `publicKeyId(pk2)` where pk1 ≠ pk2 | Different Uint8Array bytes            | N/A       | unit       |
| Public-key-id derivation | 100+ public keys yield distinct ids (collision resistance) | Generate 100 keypairs, call `publicKeyId()` on each      | All 100 ids are unique by value       | N/A       | unit       |
| Public-key-id derivation | Id length is consistent                                    | `publicKeyId(pk1).length === publicKeyId(pk2).length`    | Both ids same length (e.g., 16 bytes) | N/A       | unit       |

---

## 2. Seed-Triple Expansion (HKDF)

### Feature: HKDF seed-triple expansion

| Feature               | Behavior to test                                       | Input / command                                                                    | Expected output                                      | Exit code | Test layer |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | --------- | ---------- |
| Seed-triple expansion | Expands 32-byte seed to { ed25519, x25519, sym? }      | `expandSeed(seed32)`                                                               | `{ ed25519: Ed25519KeyPair, x25519: X25519KeyPair }` | N/A       | unit       |
| Seed-triple expansion | Expansion is deterministic                             | Same seed expanded twice                                                           | Byte-identical ed25519, x25519, sym keys both times  | N/A       | unit       |
| Seed-triple expansion | Different seeds yield different keys                   | `expandSeed(seed1)` vs `expandSeed(seed2)`                                         | All three keys differ across calls                   | N/A       | unit       |
| Seed-triple expansion | ed25519 key differs from x25519 key (label separation) | `expandSeed(seed).ed25519` vs `expandSeed(seed).x25519`                            | Keys are distinct Uint8Array bytes                   | N/A       | unit       |
| Seed-triple expansion | ed25519 key differs from sym key (label separation)    | `expandSeed(seed).ed25519` vs `expandSeed(seed).sym`                               | Keys are distinct Uint8Array bytes                   | N/A       | unit       |
| Seed-triple expansion | x25519 key differs from sym key (label separation)     | `expandSeed(seed).x25519` vs `expandSeed(seed).sym`                                | Keys are distinct Uint8Array bytes                   | N/A       | unit       |
| Seed-triple expansion | Expanded ed25519 key is 32 bytes                       | `expandSeed(seed).ed25519.length`                                                  | `32`                                                 | N/A       | unit       |
| Seed-triple expansion | Expanded x25519 key is 32 bytes                        | `expandSeed(seed).x25519.length`                                                   | `32`                                                 | N/A       | unit       |
| Seed-triple expansion | Expanded symmetric key is 32 bytes                     | `expandSeed(seed, { withSym: true }).sym.length`                                   | `32`                                                 | N/A       | unit       |
| Seed-triple expansion | withSym=false omits symmetric key                      | `expandSeed(seed, { withSym: false }).sym`                                         | `undefined`                                          | N/A       | unit       |
| Seed-triple expansion | HKDF uses distinct info labels                         | Internal behavior: labels `"orgmesh:ed25519"`, `"orgmesh:x25519"`, `"orgmesh:sym"` | Each key bound to its role by label                  | N/A       | unit       |
| Seed-triple expansion | Underlying KDF is HKDF-SHA256                          | Internally uses HKDF-SHA256 for key derivation                                     | Deterministic output suitable for cryptography       | N/A       | unit       |

---

## 3. HPKE DEK Wrapping (DHKEM-X25519, Auth Mode)

### Feature: HPKE wrap DEK to recipient

| Feature                   | Behavior to test                                              | Input / command                                                                               | Expected output                                   | Exit code | Test layer |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------- | ---------- |
| HPKE wrap DEK (Auth mode) | Wraps 32-byte DEK to recipient public key with sender binding | `wrapDek({ senderPriv: Uint8Array, recipientPub: Uint8Array, dek: Uint8Array })`              | `{ enc: Uint8Array, ct: Uint8Array }`             | N/A       | unit       |
| HPKE wrap DEK (Auth mode) | Returns encapsulated key (enc) and ciphertext (ct)            | Parse output fields                                                                           | Both fields present and non-empty Uint8Array      | N/A       | unit       |
| HPKE wrap DEK (Auth mode) | Wrap binds to sender private key (Auth binding)               | Wrap with `senderPriv1`, then try unwrap with wrong `senderPub2`                              | Unwrap fails / throws                             | N/A       | unit       |
| HPKE wrap DEK (Auth mode) | Wrap binds to optional AAD context                            | `wrapDek({ ..., aad: aadBytes })` produces different output than same call with different aad | Different ciphertexts for different AAD           | N/A       | unit       |
| HPKE wrap DEK (Auth mode) | Two wraps of same DEK produce different output (random enc)   | Call `wrapDek()` twice with identical inputs                                                  | Different `enc` and `ct` bytes (random per wrap)  | N/A       | unit       |
| HPKE wrap DEK (Auth mode) | Output is suitable for multi-recipient envelopes              | Use output in envelope stanza                                                                 | Stanza can be parsed and unwrapped by recipient   | N/A       | unit       |
| HPKE wrap DEK (Auth mode) | Suite uses DHKEM(X25519) + HKDF-SHA256 + ChaCha20-Poly1305    | Internally specifies RFC 9180 Auth mode with these params                                     | Wrap/unwrap round-trip confirms suite correctness | N/A       | unit       |

### Feature: HPKE unwrap DEK from recipient

| Feature         | Behavior to test                                   | Input / command                                                           | Expected output                                | Exit code | Test layer |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | --------- | ---------- |
| HPKE unwrap DEK | Recovers original DEK bytes                        | `unwrapDek({ recipientPriv, senderPub, enc, ct })` with matching keypairs | `Uint8Array` equals original DEK byte-for-byte | N/A       | unit       |
| HPKE unwrap DEK | Fails if recipient private key is wrong            | Unwrap with `recipientPriv2` ≠ the key that was wrapped to                | Throws cryptographic error                     | N/A       | unit       |
| HPKE unwrap DEK | Fails if sender public key is wrong (Auth binding) | Unwrap with `senderPub2` ≠ sender of wrap                                 | Throws error (Auth binding rejected)           | N/A       | unit       |
| HPKE unwrap DEK | Fails if AAD is mismatched                         | Wrap with `aad1`, unwrap with `aad2` ≠ `aad1`                             | Throws error (AAD verification failed)         | N/A       | unit       |
| HPKE unwrap DEK | Fails if AAD is omitted when expected              | Wrap with `aad: bytes`, unwrap with no AAD                                | Throws error (AAD mismatch)                    | N/A       | unit       |
| HPKE unwrap DEK | Fails if encapsulated key (enc) is tampered        | Flip one bit in `enc`, attempt unwrap                                     | Throws error                                   | N/A       | unit       |
| HPKE unwrap DEK | Fails if ciphertext (ct) is tampered               | Flip one bit in `ct`, attempt unwrap                                      | Throws error                                   | N/A       | unit       |
| HPKE unwrap DEK | Fails if enc is truncated                          | Truncate `enc` to shorter length, attempt unwrap                          | Throws error                                   | N/A       | unit       |
| HPKE unwrap DEK | Fails if ct is truncated                           | Truncate `ct` to shorter length, attempt unwrap                           | Throws error                                   | N/A       | unit       |

### Feature: HPKE wrap/unwrap round-trip

| Feature                     | Behavior to test                                                 | Input / command                                                                                 | Expected output                                  | Exit code | Test layer |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- | ---------- |
| HPKE wrap/unwrap round-trip | `wrapDek` then `unwrapDek` with matching keys recovers exact DEK | Sender generates keypair, recipient generates keypair, wrap DEK to recipient, recipient unwraps | Unwrapped DEK equals original DEK byte-for-byte  | N/A       | unit       |
| HPKE wrap/unwrap round-trip | Round-trip works with multiple different DEKs                    | Wrap 10 random DEKs to same recipient                                                           | Each unwraps to original                         | N/A       | unit       |
| HPKE wrap/unwrap round-trip | Round-trip works with AAD                                        | Wrap with `aad: someBytes`, unwrap with same AAD                                                | Recovers exact DEK                               | N/A       | unit       |
| HPKE wrap/unwrap round-trip | Round-trip works without AAD                                     | Wrap with no AAD, unwrap with no AAD                                                            | Recovers exact DEK                               | N/A       | unit       |
| HPKE wrap/unwrap round-trip | DEK length and content preserved                                 | DEK is 32 bytes, wrap and unwrap                                                                | Unwrapped DEK is 32 bytes with identical content | N/A       | unit       |

### Feature: HPKE wrong-recipient rejection

| Feature                        | Behavior to test                                              | Input / command                                                                        | Expected output                                  | Exit code | Test layer |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- | ---------- |
| HPKE wrong-recipient rejection | DEK wrapped to recipient A cannot be unwrapped by recipient B | Generate keypairs A and B; wrap DEK to A's public key; try unwrap with B's private key | Unwrap throws error (confidentiality maintained) | N/A       | unit       |
| HPKE wrong-recipient rejection | Non-recipient cannot recover DEK from envelope                | Recipient C not in wrap recipient set                                                  | C's unwrap of A's wrapped DEK fails              | N/A       | unit       |

### Feature: HPKE Auth-mode sender binding

| Feature                       | Behavior to test                                   | Input / command                                         | Expected output                         | Exit code | Test layer |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- | --------- | ---------- |
| HPKE Auth-mode sender binding | Unwrap rejects if sender public key differs        | Wrap with `senderPriv1`, unwrap with `senderPub2`       | Throws error (sender identity rejected) | N/A       | unit       |
| HPKE Auth-mode sender binding | Sender binding prevents replay under forged sender | Wrap by Alice, attacker tries to present as wrap by Bob | Unwrap with Bob's public key fails      | N/A       | unit       |

---

## 4. Ed25519 Sign & Verify

### Feature: Ed25519 sign

| Feature      | Behavior to test                                             | Input / command                                     | Expected output                      | Exit code | Test layer |
| ------------ | ------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------ | --------- | ---------- |
| Ed25519 sign | Signs message with Ed25519 private key                       | `sign(message: Uint8Array, privateKey: Uint8Array)` | `Uint8Array` of exactly 64 bytes     | N/A       | unit       |
| Ed25519 sign | Signature is deterministic for same message and key          | Sign same message twice with same key               | Byte-identical signatures both times | N/A       | unit       |
| Ed25519 sign | Different messages produce different signatures              | `sign(msg1, key)` vs `sign(msg2, key)`              | Different signature bytes            | N/A       | unit       |
| Ed25519 sign | Different keys produce different signatures for same message | `sign(msg, key1)` vs `sign(msg, key2)`              | Different signature bytes            | N/A       | unit       |
| Ed25519 sign | Handles arbitrary-length messages                            | Sign 0-byte, 32-byte, 1000-byte, 1 MiB messages     | All produce valid 64-byte signatures | N/A       | unit       |
| Ed25519 sign | Handles empty message                                        | `sign(new Uint8Array(0), key)`                      | Valid 64-byte signature              | N/A       | unit       |

### Feature: Ed25519 verify

| Feature        | Behavior to test                                | Input / command                                                            | Expected output                             | Exit code | Test layer |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- | --------- | ---------- |
| Ed25519 verify | Verifies valid signature produced by sign       | `verify(signature, message, publicKey)` where signature came from `sign()` | Returns cleanly (success, no exception)     | N/A       | unit       |
| Ed25519 verify | Rejects forged signature (arbitrary bytes)      | `verify(randomBytes(64), message, publicKey)`                              | Throws error                                | N/A       | unit       |
| Ed25519 verify | Rejects tampered signature (single bit flip)    | Flip one bit in signature, verify                                          | Throws error                                | N/A       | unit       |
| Ed25519 verify | Rejects signature made by different private key | Sign with key1, verify with key2's public key                              | Throws error                                | N/A       | unit       |
| Ed25519 verify | Rejects wrong-length signature                  | `verify(Uint8Array(32), message, publicKey)`                               | Throws error                                | N/A       | unit       |
| Ed25519 verify | Rejects if message was tampered after signing   | Sign msg, flip one bit in msg, verify                                      | Throws error (signature no longer matches)  | N/A       | unit       |
| Ed25519 verify | Rejects empty/null signature                    | `verify(new Uint8Array(0), message, publicKey)`                            | Throws error                                | N/A       | unit       |
| Ed25519 verify | Fails hard (throws) on verification failure     | Any failed verification path                                               | Error thrown, never returns false/undefined | N/A       | unit       |

### Feature: Ed25519 sign/verify round-trip

| Feature                        | Behavior to test                                | Input / command                                        | Expected output                       | Exit code | Test layer |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------- | --------- | ---------- |
| Ed25519 sign/verify round-trip | `sign` then `verify` with matching key succeeds | Generate keypair, sign message, verify with public key | Verify returns cleanly (no exception) | N/A       | unit       |
| Ed25519 sign/verify round-trip | Verify returns cleanly on success               | Successful verify does not throw                       | N/A                                   | N/A       | unit       |
| Ed25519 sign/verify round-trip | Round-trip works for various message lengths    | Messages of 1, 32, 256, 1024, 1 MiB bytes              | All verify successfully               | N/A       | unit       |
| Ed25519 sign/verify round-trip | Round-trip works for binary and text messages   | Binary Uint8Array and UTF-8 encoded text               | Both sign and verify correctly        | N/A       | unit       |

### Feature: Ed25519 forged/tampered signature rejection

| Feature                           | Behavior to test                                               | Input / command                                                   | Expected output | Exit code | Test layer |
| --------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- | --------------- | --------- | ---------- |
| Ed25519 forged/tampered rejection | Flipping one bit in signature causes verify to fail            | Modify `signature[0] ^= 0x01`, then verify                        | Throws error    | N/A       | unit       |
| Ed25519 forged/tampered rejection | Swapping two bytes in signature causes verify to fail          | Swap `signature[0]` and `signature[1]`, verify                    | Throws error    | N/A       | unit       |
| Ed25519 forged/tampered rejection | Modifying message after signature invalidates verify           | Sign msg1, modify to msg2, verify against original sig            | Throws error    | N/A       | unit       |
| Ed25519 forged/tampered rejection | Replacing signature with one from another message fails verify | Sign msg1 (get sig1), sign msg2 (get sig2), verify msg1 with sig2 | Throws error    | N/A       | unit       |
| Ed25519 forged/tampered rejection | No silent acceptance of invalid signatures                     | All rejection paths throw, never return a false-like value        | N/A             | N/A       | unit       |

---

## 5. Age-Style Envelope Structure & Canonical Serialization

### Feature: Age-style envelope structure

| Feature            | Behavior to test                            | Input / command              | Expected output                                     | Exit code | Test layer |
| ------------------ | ------------------------------------------- | ---------------------------- | --------------------------------------------------- | --------- | ---------- |
| Envelope structure | Envelope contains version field             | `Envelope.v`                 | Integer version number (e.g., 1)                    | N/A       | unit       |
| Envelope structure | Envelope contains recipient stanzas array   | `Envelope.stanzas`           | Array of `RecipientStanza` objects                  | N/A       | unit       |
| Envelope structure | Envelope contains sender Ed25519 signature  | `Envelope.senderSig`         | `Uint8Array` of 64 bytes                            | N/A       | unit       |
| Envelope structure | Envelope contains header HMAC               | `Envelope.headerHmac`        | `Uint8Array` of 32 bytes (HMAC output size)         | N/A       | unit       |
| Envelope structure | Envelope contains nonce for AEAD            | `Envelope.nonce`             | `Uint8Array` of 24 bytes (XChaCha20-Poly1305 nonce) | N/A       | unit       |
| Envelope structure | Envelope contains AEAD payload              | `Envelope.payload`           | `Uint8Array` (ciphertext of plaintext)              | N/A       | unit       |
| Envelope structure | Stanza contains recipient public-key id     | `RecipientStanza.keyId`      | `Uint8Array` (output of `publicKeyId()`)            | N/A       | unit       |
| Envelope structure | Stanza contains HPKE encapsulated key (enc) | `RecipientStanza.enc`        | `Uint8Array` (HPKE enc output)                      | N/A       | unit       |
| Envelope structure | Stanza contains HPKE-wrapped DEK            | `RecipientStanza.wrappedDek` | `Uint8Array` (HPKE ciphertext)                      | N/A       | unit       |

### Feature: Canonical stanza serialization

| Feature                 | Behavior to test                                                            | Input / command                                                                               | Expected output                                                                              | Exit code | Test layer |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- | ---------- |
| Canonical serialization | Produces deterministic canonical bytes of stanza set                        | Serialize same stanza set twice                                                               | Byte-identical canonical bytes both times                                                    | N/A       | unit       |
| Canonical serialization | Canonical form is consistent across calls for same stanzas                  | Call serialization on same stanzas 10 times                                                   | All 10 outputs are byte-identical                                                            | N/A       | unit       |
| Canonical serialization | Canonical form is independent of input stanza order before canonicalization | Serialize [A, B, C] and [C, B, A]                                                             | If order doesn't matter to spec, outputs match; if order matters, outputs differ predictably | N/A       | unit       |
| Canonical serialization | Used as input to signature and header HMAC                                  | Signature covers canonical bytes; HMAC key derived from DEK and computed over canonical bytes | Both operations use identical bytes                                                          | N/A       | unit       |
| Canonical serialization | No map-ordering ambiguity in serialization                                  | Use deterministic encoding (CBOR or fixed-layout)                                             | Output is unambiguous regardless of input construction                                       | N/A       | unit       |
| Canonical serialization | Uses CBOR or fixed-layout deterministic encoding                            | Inspect serialization format                                                                  | Format specified and unambiguous per RFC or doc                                              | N/A       | unit       |

---

## 6. Seal Envelope to Multiple Recipients

### Feature: sealEnvelope to recipients

| Feature                      | Behavior to test                                                | Input / command                                                      | Expected output                                                                   | Exit code | Test layer |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- | ---------- |
| sealEnvelope basic operation | Generates fresh per-item DEK internally (or accepts caller DEK) | `sealEnvelope({ plaintext, recipients, sender })` with no DEK option | `Envelope` with fresh DEK generated                                               | N/A       | unit       |
| sealEnvelope basic operation | AEAD-seals plaintext under DEK                                  | Inspect `envelope.payload`                                           | Ciphertext is XChaCha20-Poly1305 sealed plaintext                                 | N/A       | unit       |
| sealEnvelope basic operation | HPKE-wraps DEK to each recipient public key                     | For N recipients, produces N stanzas                                 | Each stanza contains HPKE-wrapped DEK to that recipient's pubkey                  | N/A       | unit       |
| sealEnvelope basic operation | Produces one stanza per recipient                               | `recipients.length === 3`                                            | `envelope.stanzas.length === 3`                                                   | N/A       | unit       |
| sealEnvelope basic operation | Each stanza contains recipient key id and HPKE-wrapped DEK      | Inspect stanza fields                                                | `stanza.keyId` (from `publicKeyId(recipientPub)`) and `stanza.wrappedDek` present | N/A       | unit       |
| sealEnvelope basic operation | Computes header HMAC keyed from DEK over canonical stanzas      | HMAC computed over canonical stanza bytes with DEK-derived HMAC key  | `envelope.headerHmac` is 32-byte output                                           | N/A       | unit       |
| sealEnvelope basic operation | Ed25519-signs canonical stanzas with sender private key         | Signature covers canonical stanza set                                | `envelope.senderSig` is 64 bytes                                                  | N/A       | unit       |
| sealEnvelope basic operation | Includes nonce in envelope                                      | `envelope.nonce` is present                                          | 24-byte nonce for AEAD                                                            | N/A       | unit       |
| sealEnvelope basic operation | Works with 1 recipient                                          | `recipients = [pubkey1]`                                             | Produces envelope with 1 stanza                                                   | N/A       | unit       |
| sealEnvelope basic operation | Works with N recipients                                         | `recipients = [pubkey1, ..., pubkeyN]` for N in [2, 3, 10]           | Produces envelope with N stanzas                                                  | N/A       | unit       |
| sealEnvelope basic operation | Sender key pair is bound to wrap (Auth mode)                    | Inspect HPKE wrap parameters                                         | Auth mode binding of sender identity confirmed                                    | N/A       | unit       |

### Feature: Multi-recipient envelope round-trip

| Feature                    | Behavior to test                                         | Input / command                                                       | Expected output                         | Exit code | Test layer |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- | --------- | ---------- |
| Multi-recipient round-trip | Seal to recipients A, B, C then each opens independently | Generate 3 keypairs; seal plaintext to all 3; each calls openEnvelope | All 3 recover identical plaintext       | N/A       | unit       |
| Multi-recipient round-trip | A opens and recovers original plaintext                  | `openEnvelope({ envelope, reader: A })`                               | Plaintext matches original              | N/A       | unit       |
| Multi-recipient round-trip | B opens and recovers identical plaintext                 | `openEnvelope({ envelope, reader: B })`                               | Plaintext matches original              | N/A       | unit       |
| Multi-recipient round-trip | C opens and recovers identical plaintext                 | `openEnvelope({ envelope, reader: C })`                               | Plaintext matches original              | N/A       | unit       |
| Multi-recipient round-trip | All three openings yield byte-identical plaintext        | Compare plaintext from A, B, C opens                                  | All three Uint8Array are equal by value | N/A       | unit       |
| Multi-recipient round-trip | Works with 2 recipients                                  | `recipients = [pkA, pkB]`                                             | Both A and B open successfully          | N/A       | unit       |
| Multi-recipient round-trip | Works with 10 recipients                                 | `recipients = [pk1, ..., pk10]`                                       | All 10 recipients open successfully     | N/A       | unit       |
| Multi-recipient round-trip | Works with 100 recipients                                | `recipients = [pk1, ..., pk100]`                                      | All 100 recipients open successfully    | N/A       | unit       |

### Feature: Multi-recipient non-recipient exclusion

| Feature                 | Behavior to test                      | Input / command                         | Expected output                         | Exit code | Test layer |
| ----------------------- | ------------------------------------- | --------------------------------------- | --------------------------------------- | --------- | ---------- |
| Non-recipient exclusion | Envelope sealed to A, B, C            | Create 4 keypairs; seal to first 3      | Envelope produced with 3 stanzas        | N/A       | unit       |
| Non-recipient exclusion | Fourth keypair D not in recipient set | D attempts to open                      | D finds no stanza matching its key id   | N/A       | unit       |
| Non-recipient exclusion | D's open attempt fails                | `openEnvelope({ envelope, reader: D })` | Throws error (no matching stanza)       | N/A       | unit       |
| Non-recipient exclusion | D cannot unwrap any DEK               | D has no stanza to attempt unwrap on    | Exclusion prevents non-recipient access | N/A       | unit       |

---

## 7. Open Envelope as Authorized Recipient

### Feature: openEnvelope operation

| Feature                      | Behavior to test                                                      | Input / command                                                              | Expected output                                     | Exit code | Test layer |
| ---------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- | --------- | ---------- |
| openEnvelope basic operation | Locates stanza for reader's key id                                    | `openEnvelope({ envelope, reader })` where reader.keyId matches one stanza   | Finds matching stanza                               | N/A       | unit       |
| openEnvelope basic operation | HPKE-unwraps DEK using reader's private key                           | Stanza found; unwrap with reader's `wrapPriv`                                | DEK recovered                                       | N/A       | unit       |
| openEnvelope basic operation | Verifies sender Ed25519 signature over stanzas                        | `verify(envelope.senderSig, canonicalStanzas, senderSignPub)`                | Signature verification succeeds                     | N/A       | unit       |
| openEnvelope basic operation | Recomputes header HMAC from DEK and stanzas                           | Derive HMAC key from DEK; compute over canonical stanzas                     | Recomputed HMAC matches `envelope.headerHmac`       | N/A       | unit       |
| openEnvelope basic operation | Verifies header HMAC matches envelope header                          | HMAC comparison                                                              | Match confirmed                                     | N/A       | unit       |
| openEnvelope basic operation | AEAD-opens payload under recovered DEK                                | `aeadOpen(envelope.payload, dek, nonce)` with recovered DEK and stored nonce | Plaintext recovered                                 | N/A       | unit       |
| openEnvelope basic operation | Returns plaintext before any verification failure                     | No verification failure in happy path                                        | Plaintext returned                                  | N/A       | unit       |
| openEnvelope basic operation | Aborts if sender signature verification fails (no plaintext returned) | Signature tampered; verify returns early                                     | Throws error before AEAD open; no plaintext exposed | N/A       | unit       |
| openEnvelope basic operation | Aborts if header HMAC verification fails (no plaintext returned)      | Stanzas tampered; HMAC mismatch; verify returns early                        | Throws error before AEAD open; no plaintext exposed | N/A       | unit       |
| openEnvelope basic operation | Aborts if AEAD-open fails (no plaintext returned)                     | Payload tampered; AEAD auth fails; verify returns early                      | Throws error; no garbage/plaintext returned         | N/A       | unit       |

### Feature: Envelope sender signature verification

| Feature                       | Behavior to test                                               | Input / command                                      | Expected output                                        | Exit code | Test layer |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | --------- | ---------- |
| Sender signature verification | openEnvelope succeeds with valid sender signature              | Envelope created correctly; no tampering             | Opens and returns plaintext                            | N/A       | unit       |
| Sender signature verification | openEnvelope fails if any stanza byte is flipped after signing | Flip one bit in stanza bytes after signature created | Throws error (signature verify fails)                  | N/A       | unit       |
| Sender signature verification | openEnvelope fails if stanzas are swapped after signing        | Swap order of two stanzas after signature created    | Throws error (canonical form changes; signature fails) | N/A       | unit       |
| Sender signature verification | openEnvelope fails if a stanza is removed after signing        | Remove one stanza from set after signature created   | Throws error (canonical form changes; signature fails) | N/A       | unit       |
| Sender signature verification | openEnvelope fails if signature is from a different key        | Sign with key1; verify with key2's public key        | Throws error (signature verification fails)            | N/A       | unit       |
| Sender signature verification | openEnvelope fails if signature is forged/fabricated           | Create random signature bytes; attempt verify        | Throws error                                           | N/A       | unit       |
| Sender signature verification | No plaintext is returned if signature fails                    | Any signature failure                                | Error thrown before plaintext is returned              | N/A       | unit       |

### Feature: Envelope header-HMAC recipient-set protection

| Feature                | Behavior to test                                            | Input / command                                    | Expected output                                           | Exit code | Test layer |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- | --------- | ---------- |
| Header-HMAC protection | Header HMAC detects removal of one stanza from set          | Remove stanza from envelope; attempt open          | Recomputed HMAC differs; verification fails; throws error | N/A       | unit       |
| Header-HMAC protection | Header HMAC detects insertion of attacker-controlled stanza | Insert new stanza into stanza set; attempt open    | Canonical form changes; HMAC mismatch; throws error       | N/A       | unit       |
| Header-HMAC protection | Header HMAC detects swap of two stanzas                     | Swap two stanzas in order; attempt open            | Canonical form changes; HMAC mismatch; throws error       | N/A       | unit       |
| Header-HMAC protection | Header HMAC detects truncation of stanza set                | Truncate stanzas array (remove last); attempt open | Canonical form changes; HMAC mismatch; throws error       | N/A       | unit       |
| Header-HMAC protection | Recomputed HMAC matches when stanzas unmodified             | Envelope untouched; open successfully              | HMAC verification passes                                  | N/A       | unit       |
| Header-HMAC protection | Recomputed HMAC differs when canonical stanzas differ       | Any stanza modification                            | Recomputed HMAC ≠ stored HMAC                             | N/A       | unit       |
| Header-HMAC protection | Open fails if header HMAC does not match (no plaintext)     | Any stanza tampering detected by HMAC              | Throws error before AEAD open; plaintext not returned     | N/A       | unit       |

### Feature: Envelope payload tamper rejection

| Feature                  | Behavior to test                                  | Input / command                                  | Expected output                                           | Exit code | Test layer |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- | --------- | ---------- |
| Payload tamper rejection | openEnvelope fails if any payload byte is flipped | Flip one bit in `envelope.payload`; attempt open | AEAD-open fails; throws error                             | N/A       | unit       |
| Payload tamper rejection | openEnvelope fails if payload is truncated        | Truncate payload; attempt open                   | AEAD-open fails; throws error                             | N/A       | unit       |
| Payload tamper rejection | openEnvelope fails if nonce is modified           | Flip one bit in `envelope.nonce`; attempt open   | AEAD-open fails (nonce is part of auth tag); throws error | N/A       | unit       |
| Payload tamper rejection | AEAD-open fails and propagates to open failure    | Any payload tampering                            | `aeadOpen` raises error; propagated as-is                 | N/A       | unit       |
| Payload tamper rejection | No plaintext is returned on payload tamper        | Any AEAD failure                                 | Error thrown; no garbage/partial plaintext returned       | N/A       | unit       |

---

## 8. Cross-Subsystem Integration & Interoperability

### Feature: Seed-triple determinism

| Feature                 | Behavior to test                                                  | Input / command                                                                          | Expected output                                 | Exit code | Test layer |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- | --------- | ---------- |
| Seed-triple determinism | Same 32-byte seed expands to byte-identical ed25519 key on repeat | `expandSeed(seed)` called twice                                                          | Both ed25519 keys are byte-identical            | N/A       | unit       |
| Seed-triple determinism | Same 32-byte seed expands to byte-identical x25519 key on repeat  | `expandSeed(seed)` called twice                                                          | Both x25519 keys are byte-identical             | N/A       | unit       |
| Seed-triple determinism | Same 32-byte seed expands to byte-identical sym key on repeat     | `expandSeed(seed, { withSym: true })` called twice                                       | Both sym keys are byte-identical                | N/A       | unit       |
| Seed-triple determinism | Two different seeds expand to different ed25519 keys              | `expandSeed(seed1).ed25519` vs `expandSeed(seed2).ed25519`                               | Keys differ                                     | N/A       | unit       |
| Seed-triple determinism | Two different seeds expand to different x25519 keys               | `expandSeed(seed1).x25519` vs `expandSeed(seed2).x25519`                                 | Keys differ                                     | N/A       | unit       |
| Seed-triple determinism | Two different seeds expand to different sym keys                  | `expandSeed(seed1, { withSym: true }).sym` vs `expandSeed(seed2, { withSym: true }).sym` | Keys differ                                     | N/A       | unit       |
| Seed-triple determinism | ed25519 key from seed differs from x25519 key from same seed      | `expandSeed(seed).ed25519` vs `expandSeed(seed).x25519`                                  | Keys are distinct (label/type separation works) | N/A       | unit       |
| Seed-triple determinism | ed25519 key from seed differs from sym key from same seed         | `expandSeed(seed).ed25519` vs `expandSeed(seed).sym`                                     | Keys are distinct                               | N/A       | unit       |
| Seed-triple determinism | x25519 key from seed differs from sym key from same seed          | `expandSeed(seed).x25519` vs `expandSeed(seed).sym`                                      | Keys are distinct                               | N/A       | unit       |

### Feature: Public-key-id stability and uniqueness

| Feature                 | Behavior to test                                                     | Input / command                                   | Expected output                                              | Exit code | Test layer |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ | --------- | ---------- |
| Public-key-id stability | publicKeyId(pk) is stable across repeated calls                      | Call `publicKeyId(pk)` 10 times on same pk        | All 10 ids are byte-identical                                | N/A       | unit       |
| Public-key-id stability | Two different public keys yield different ids (collision resistance) | Generate 2 keypairs; call `publicKeyId()` on each | Ids differ                                                   | N/A       | unit       |
| Public-key-id stability | Many public keys (N>100) all yield distinct ids                      | Generate 100+ keypairs; compute ids for all       | All ids are pairwise distinct                                | N/A       | unit       |
| Public-key-id stability | Stanza addressing is reliable using key id                           | Use key ids to locate stanzas in envelope         | Each recipient finds exactly one stanza with matching key id | N/A       | unit       |

### Feature: DEK interop with at-rest layer (Plan #1 aead)

| Feature                       | Behavior to test                                                             | Input / command                                                                             | Expected output                                                      | Exit code | Test layer |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------- | ---------- |
| DEK interop with Plan #1 aead | DEK produced by envelope still seals/opens through Plan #1 aeadSeal/aeadOpen | Generate DEK via sealEnvelope; seal plaintext via aeadSeal with same DEK; open via aeadOpen | Round-trip succeeds; plaintext recovered                             | N/A       | unit       |
| DEK interop with Plan #1 aead | Asymmetric layer composes with at-rest layer unchanged                       | No modification to aead.ts required                                                         | aeadSeal/aeadOpen behave identically before and after P2 integration | N/A       | unit       |
| DEK interop with Plan #1 aead | No crypto-layer breakage from new features                                   | All existing P0 tests still pass                                                            | P0 test suite unaffected                                             | N/A       | unit       |

### Feature: Header HMAC key derivation separation

| Feature             | Behavior to test                                                | Input / command                                     | Expected output                       | Exit code | Test layer |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------- | --------- | ---------- |
| HMAC key separation | Header HMAC key is derived from DEK via HKDF                    | HMAC key derived with distinct info label from AEAD | HMAC key ≠ AEAD encryption key        | N/A       | unit       |
| HMAC key separation | Header HMAC key differs from AEAD encryption key (no key reuse) | Inspect HKDF derivation                             | HMAC and AEAD keys are distinct bytes | N/A       | unit       |
| HMAC key separation | HMAC uses distinct info label from AEAD                         | HKDF labels are different for HMAC vs AEAD          | No key reuse between protocols        | N/A       | unit       |
| HMAC key separation | Domain separation prevents cross-protocol attacks               | HMAC key cannot be used to forge AEAD or vice versa | Attack attempts fail                  | N/A       | unit       |

### Feature: Module composition tests

| Feature                      | Behavior to test                                                      | Input / command                              | Expected output                                     | Exit code | Test layer |
| ---------------------------- | --------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- | --------- | ---------- |
| Keys module composition      | Keypair shape matches X25519KeyPair interface                         | Generate keypair; inspect fields             | `{ publicKey: Uint8Array, privateKey: Uint8Array }` | N/A       | unit       |
| Keys module composition      | Public-key-id parse/serialize round-trip                              | Serialize key id; deserialize                | Recovered id equals original                        | N/A       | unit       |
| Keys module composition      | Serialize then deserialize public key yields original bytes           | Public key → bytes → public key              | Recovered key bytes match original                  | N/A       | unit       |
| HPKE module composition      | wrapDek accepts senderPriv, recipientPub, dek, and optional aad       | Call with all parameters                     | Function accepts all args correctly                 | N/A       | unit       |
| HPKE module composition      | unwrapDek accepts recipientPriv, senderPub, enc, ct, and optional aad | Call with all parameters                     | Function accepts all args correctly                 | N/A       | unit       |
| HPKE module composition      | Suite-id is DHKEM(X25519) + HKDF-SHA256 + ChaCha20-Poly1305           | Inspect suite specification                  | RFC 9180 suite matches                              | N/A       | unit       |
| HPKE module composition      | AAD binding is enforced (mismatch causes failure)                     | Wrap with AAD1; unwrap with AAD2             | Unwrap fails                                        | N/A       | unit       |
| Sign module cross-validation | Sign uses libsodium primary                                           | Inspect implementation                       | libsodium-wrappers-sumo used for sign               | N/A       | unit       |
| Sign module cross-validation | Verify may use @noble/curves as cross-check in tests                  | Test fixtures validate both implementations  | Both implementations agree on valid/invalid         | N/A       | unit       |
| Sign module cross-validation | Sign and verify are compatible                                        | Sign with libsodium; verify with either impl | Verification succeeds                               | N/A       | unit       |
| Sign module cross-validation | 64-byte Ed25519 signatures produced                                   | Sign any message                             | Output is exactly 64 bytes                          | N/A       | unit       |

---

## 9. Out of Scope for This Phase

- Wrapping **seeds** (not DEKs) to public keys for team-sharing
- Per-device key (DK) generation and device sigchain
- Key Transparency, TOFU pinning, OPAQUE, server/relay logic
- Account recovery mechanisms
- Full key ladder (MasterKEK, AccountKey, UIS/UIK, etc.)
- Vault persistence, project-world sandbox, admission, CLI
- Sets/Slots model and injection
- Argon2id production parameter tuning

---

## Test Execution Notes

- **Test framework:** vitest (unit tests only)
- **KDF parameters in tests:** Use fast params `{ iterations: 2, memorySize: 8192, parallelism: 1 }` where KDF is involved (never used at this layer directly, but if seed expansion uses KDF internally, use fast params)
- **Async/await:** All crypto operations are async; all tests must properly await or return Promises
- **Import style:** ESM with relative imports ending in `.js`; cross-package imports use package name
- **Type checking:** Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- **Test assertions:** Use `expect()` from vitest; verify byte-equality with `Buffer.equals()` or typed array comparison
