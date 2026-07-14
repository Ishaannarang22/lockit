# Threat Model

This document describes what `lockit` protects, what it does not protect, and the
reasoning behind each guarantee. It is written to be honest about limits:
every guarantee is paired with the precise conditions under which it holds, and
the known gaps are stated plainly rather than hidden.

`lockit` is a local-first developer secrets manager with an optional self-hosted
sync/sharing server. It uses client-side envelope encryption (the **OrgMesh**
crypto design); the server is a dumb, append-only encrypted store-and-relay
that only ever holds ciphertext. For the cryptographic construction referenced
throughout this document, see [`security-crypto.md`](./security-crypto.md). For the data
model (Sets + Slots), see [`data-model.md`](./data-model.md); the project-world sandbox
and admission model are described in this document.

---

## Assets

What an attacker would want, ranked roughly by sensitivity.

| Asset | Description | Where it lives |
| --- | --- | --- |
| **Secret values** | The actual API keys, tokens, connection strings, and file-type secrets (e.g. a Google service-account JSON). The thing the whole product exists to protect. | Encrypted at rest in the local store and per-project vaults; decrypted only in memory during `lockit run`. |
| **Key material** | The passphrase, the optional `SecretKey` second factor, the `MasterKEK`, `AccountKey`, per-device key (`DK`), `User Identity Seed`/`UIK`, `Personal-Vault Seed`/`PVK`, team seeds and team keys, and per-item `DEK`s. Compromise of key material is compromise of every value it can reach. | Private halves never leave the device. Wrapped (encrypted) blobs may be uploaded to the optional server. |
| **Metadata** | Slugs, schemas, field names, tags, version history, sizes, timestamps, public keys, the Key Transparency log, sigchains, access-control records, and the who-shares-with-whom graph. Values are never in this category. | Local store; visible to a server operator when the optional server is used. |

The product's central guarantee is about **secret values** and **private key
material**. Metadata is explicitly a weaker-protected asset (see
[Honest non-goals](#honest-non-goals)).

---

## Trust boundaries

1. **The device.** The fully trusted zone. Private keys, seeds, the passphrase,
   and decrypted plaintext exist here. If the device (and its unlocked OS user
   session) is fully compromised, `lockit` cannot save you; this is true of any
   local tool.

2. **The global store ↔ the project world.** Within a single device, the global
   store of secrets is a *protected source* and each project is a *sandbox*
   ("project world"). A project may only use secrets that have been **admitted**
   to it. This boundary is what contains an AI agent working inside a project.

3. **The human ↔ the agent.** An AI agent (e.g. Claude Code) operates with the
   developer's shell access but is treated as **semi-trusted**. The boundary is
   enforced by human-gated admission: crossing from "requested" to "admitted"
   requires proof of human presence (local auth) that the agent cannot produce.

4. **The client ↔ the optional server.** All encryption and decryption happen
   client-side. The server sits *outside* the trust boundary for confidentiality:
   it is designed so that it can hold everything it stores and still never learn
   a value or a private key. It is trusted only for availability and for not
   equivocating about public-key bindings (and even that last point is checked,
   not assumed — see Key Transparency below).

---

## Adversaries

- **Honest-but-curious self-hosted server operator.** Runs the optional server
  correctly but reads everything it stores and inspects traffic. Wants to learn
  secret values.

- **A fully compromised server.** An attacker has total control of the server:
  can read, modify, withhold, replay, and reorder stored data, and can attempt
  to serve forged public keys.

- **A malicious team admin or member.** A legitimate participant who abuses
  their position — e.g. tries to read secrets they were never granted, or
  attempts to inject content under another member's identity.

- **The semi-trusted AI agent.** An automated agent acting with the developer's
  local privileges. May be benign-but-confused or actively adversarial (e.g.
  driven by a prompt-injection attack). Wants to read secret values or exfiltrate
  them into its context, transcripts, files, or outbound commands.

- **A local attacker or other local process.** Another process on the same
  machine, or someone with momentary access to an unlocked session. Wants to read
  on-disk secrets or scrape plaintext from memory.

---

## Threat scenarios and mitigations

Each scenario states the threat, the mitigation, and (where relevant) the
residual risk.

### The operator cannot decrypt stored data

**Threat:** the server operator reads the database and tries to recover secret
values.

**Mitigation:** envelope encryption is performed entirely client-side. The
server stores only ciphertext, version history, public keys, never-unwrapped
wrapped key material, salts, the OPAQUE record, the Key Transparency log and
sigchains, and access-control metadata. It never stores any passphrase, private
key, seed, `DEK`, or plaintext, and **there is no operator master key**. Each
secret value is sealed as `XChaCha20-Poly1305(value, DEK)`, and the `DEK` is
HPKE-wrapped only to authorized readers' public keys. The operator holds no
private half of any of those keys.

**Residual risk:** metadata (see non-goals). Values are not at risk from a
correctly running operator.

### Compromised-server exposure

**Threat:** an attacker fully owns the server and can tamper with what it serves.

**Mitigation:**
- *Confidentiality* is unchanged from the honest-but-curious case: the attacker
  gains ciphertext and wrapped blobs but no private keys, so values stay sealed.
- *Integrity / authenticity:* every envelope carries an Ed25519 sender signature
  over the recipient stanza set, plus a header HMAC keyed from the `DEK`. A
  forged or modified recipient set or a tampered payload is detectable by the
  client. The signature prevents an attacker (including the server) from
  injecting content that impersonates another member.
- *Equivocation about identities:* a compromised server might try to hand out a
  forged public key for a contact so that a share is wrapped to the attacker.
  This is countered by **Key Transparency** — an append-only signed log of
  email-to-`UIK` mappings. Clients auto-verify inclusion and consistency proofs,
  and TOFU-pin a contact on first share, so a later substituted key is flagged.
  Independent gossip witnesses provide anti-equivocation even in a self-hosted
  deployment. v1 ships the signed log, auto-self-audit, and TOFU pinning;
  gossip witnesses follow.

**Residual risk:** a compromised server can deny service or withhold updates
(an availability attack, not a confidentiality one), and metadata remains
visible. Before gossip witnesses ship, a server that is malicious *from the very
first contact* could in principle present a consistent forged view to a brand-new
client that has nothing to pin against; TOFU protects established pins, and the
self-audit and (later) witnesses close the remaining gap.

### A team admin cannot read a member's personal secret

**Threat:** a team admin tries to read another member's personal (non-shared)
secrets.

**Mitigation:** personal secrets are wrapped to the **Personal-Vault Key**
(`PVK`), expanded from the **Personal-Vault Seed** (`PVS`). `PVS` is
**hard-excluded** from any sharing-to-others flow. There is no path — admin or
otherwise — by which a personal secret's `DEK` is wrapped to anyone but the
owner's own keys. Admin authority governs team membership and the team vault, not
personal vaults.

**Residual risk:** none for personal secrets via the sharing layer. (A
fully compromised *device* of the owner is out of scope here.)

### Sharing is operator-blind

**Threat:** the operator observes a share and tries to read its contents.

**Mitigation:** to share, the sender resolves references, wraps the `DEK` to the
recipient's `UIK` public key (resolved via Key Transparency with TOFU pinning),
Ed25519-signs the envelope, and relays ciphertext through the server. The server
only relays; the recipient unwraps locally. The default on accept is
**create-new, never auto-merge**, suffixing on a slug clash.

**Residual risk:** the operator learns that a share happened and between whom
(the share graph is metadata). Also, a share is a **point-in-time copy**: later
rotation of the source value does *not* auto-propagate to the recipient unless
re-shared. This is an accepted, documented tradeoff, not a bug.

### Device enrollment and adding devices

**Threat:** an attacker tries to enroll a rogue device under a victim's identity,
or to intercept the bootstrap of a second legitimate device.

**Mitigation:**
- *Enroll:* the device generates its own device key, `UIS`, and `PVS`, uploads
  only public keys plus wrapped blobs plus the OPAQUE registration, and publishes
  `UIK` to the Key Transparency log.
- *Multi-device:* a new device generates its own key (the private half never
  leaves it). An **existing trusted device** verifies a short authenticated code
  out of band, signs the new device into the Ed25519 sigchain, and wraps `UIS`
  to it. Without an existing trusted device to perform that signing and wrapping,
  a new device cannot join — the server cannot do it because it has no seeds.

**Residual risk:** the short authenticated code must actually be checked by the
human; skipping that check undermines the binding. This is a UX-enforced step.

### The reality of revocation

**Threat:** a member is removed; the expectation is that they can no longer read
team secrets.

**Mitigation:** **ACL removal alone is NOT revocation** — we state this plainly.
Real revocation rotates the team seed to the surviving members (cost
`O(survivors)`), lazily re-wraps `DEK`s, and rotates the upstream value at the
provider. After this, removed parties are absent from all future wraps.

**Residual risk (honest):** cryptography cannot un-leak plaintext that the
removed party already saw. Anything they decrypted before removal is, from a
crypto standpoint, already out. That is why revocation must be paired with
**upstream key rotation** at the provider. We do not claim retroactive secrecy.

### Rotation of a value

**Threat:** a value needs to change (suspected exposure, routine hygiene).

**Mitigation:** rotation generates a fresh `DEK`, wraps it only to *current*
readers, drops removed parties, and garbage-collects old versions.

**Residual risk (honest):** again, crypto cannot un-leak already-seen plaintext.
Rotation protects future versions and must be paired with rotating the actual
upstream key when the goal is to invalidate a leaked credential.

### Team join

**Threat:** efficiently granting a new member access to existing team history
without leaking to them more than intended, and without re-encrypting everything.

**Mitigation:** an existing member wraps the team seed to the new member's `UIK`
**once** (`O(1)`), granting access to history under that team key. The `UIK`'s
single job is to unwrap a small set of seeds, which keeps identity operations
`O(devices + memberships)` rather than `O(secrets)`.

**Residual risk:** by design, joining grants access to the team's history under
that seed; scope membership deliberately.

### Self-hosting

**Threat:** running your own server changes who you have to trust.

**Mitigation:** the design assumes the server is untrusted for confidentiality
regardless of who runs it. Self-hosting therefore does not weaken the value- or
key-confidentiality guarantees; it changes only *who can see metadata* and *who
controls availability* — and a self-hoster controls their own metadata. Key
Transparency self-audit works in a self-hosted deployment, with gossip witnesses
strengthening anti-equivocation when they ship.

### Key-compromise blast radius

**Threat:** a single key is compromised — how much is exposed?

The key ladder is built to bound this:

| Compromised key | Blast radius |
| --- | --- |
| A per-item `DEK` | Just that one secret/version. |
| `PVK` / `PVS` | The owner's personal vault only; never anything shared to others (`PVS` is hard-excluded from sharing). |
| A team key / Org-Team Seed | That team's secrets — which is why revocation rotates it. |
| `UIK` | The seeds it is authorized to unwrap. Identity rotation costs `O(devices + memberships)`, not `O(secrets)`, by design. |
| A device key (`DK`) | What that device can unwrap; the device can be removed from the sigchain. |
| Passphrase **alone** | Not sufficient if the optional `SecretKey` second factor is in use: `AK = HKDF(MasterKEK XOR HKDF(SecretKey))`, so a stolen server blob plus a weak passphrase is not brute-forceable without `SecretKey`. |

**Residual risk (honest):** there is **no forward secrecy at rest** (see
non-goals). A compromised long-term key is retroactive over the data it can
reach.

---

## The agent-exfiltration limit

This is the most important limit to understand, and it is one we cannot fully
close. It deserves its own section precisely because it is tempting to overclaim.

`lockit` keeps secret **values** out of the agent's eyes throughout normal
orchestration:

- All agent-facing output — `list`, `status`, `run --dry-run`, the chooser —
  emits only slugs, schemas, field names, tags, and `hasValue` booleans. Never a
  value, not even a masked one.
- The resolver is strict 0/1/N and never guesses. Ambiguity is a hard,
  structured error with a value-free numbered chooser; the agent cannot resolve
  it by picking a value.
- On `lockit run`, values are decrypted in memory only, set as env vars (or
  materialized as a `0600` tmpfs file for file-type secrets) for the child
  process's lifetime, masked in the child's stdout/stderr, written nowhere on
  disk, and shredded on exit. The agent orchestrates; values flow from the vault
  to the child process and never enter the model context or the transcript.

**The honest limit:** a child process inevitably **holds the real value — it is
using it.** A rogue or confused agent that can run arbitrary commands could
direct the child (or another command) to print, copy, or transmit that value.
**Containment is not omnipotence.** `lockit` makes the *easy* leaks hard and the
*invisible* leaks visible; it cannot make exfiltration impossible while still
letting programs use their secrets.

**Mitigations (in order of importance):**

1. **Human-gated admission (the biggest).** A project can only use a secret that
   was admitted to its project world, and every admission requires human
   confirmation plus local auth (Touch ID / OS password / biometric on macOS via
   LocalAuthentication, falling back to the OS keychain or a passphrase prompt).
   The agent can request admission but cannot satisfy the proof-of-presence gate.
   Auth happens once at admission; a batch admit shows all requested keys in one
   confirmation box under a single auth. So an agent cannot silently pull new
   secrets into its blast radius — a human sees and approves the exact set.
2. **Audit log.** Admissions and uses are recorded, so exfiltration attempts and
   unexpected access leave a trail.
3. **Egress warnings via a plugin hook.** The Claude Code plugin's hooks add
   guardrails — for example, warning when a raw secret looks like it is about to
   be written into a file or a command. This catches the common accidental-leak
   path. See the plugin docs under [`../plugin/`](../plugin/).

These mitigations shrink the practical attack surface dramatically but do not
eliminate the fundamental fact that a program using a secret can mishandle it.

---

## Honest non-goals

These are deliberate limits. They are documented, not hidden.

### No forward secrecy at rest

A leaked long-term key is **retroactive** over the data it can reach. This is
inherent to durable, random-access encrypted storage: the data must remain
decryptable by current readers at any time, so we cannot ratchet keys forward
the way a messaging protocol does. Messaging-style ratchets were considered and
rejected for exactly this reason. We minimize blast radius through the key ladder
(above) rather than claiming forward secrecy we cannot provide.

### Metadata is visible to a server operator

When the optional server is used, the operator can see metadata: names (slugs,
schemas, field names, tags), sizes, version counts, timestamps, public keys, and
the who-shares-with-whom graph. **Values and private keys are never visible.**
If metadata exposure matters for your context, self-host (so you control the
metadata) and scope what you sync.

### No account recovery in this version

If you lose your passphrase **and** all of your devices, your data **cannot be
recovered**. There is no backdoor and no operator master key that
could restore it — which is precisely what makes the operator unable to decrypt
your data in the first place. This is the recovery trilemma: you cannot
simultaneously have a no-backdoor system, loss-proof recovery, and no extra
trusted party. This version chooses no-backdoor and no-extra-trust, and therefore
does not offer recovery. **Keep more than one enrolled device and store your
passphrase safely.** Recovery is future work and is simply not part of this
version.

### Node cannot guarantee zeroing secrets from memory

Because the runtime is garbage-collected, `lockit` **cannot promise** that a
plaintext secret is wiped from memory at a precise moment. We minimize plaintext
lifetime — decrypt in memory only, hold for the child's lifetime, shred temp
files, and avoid persisting — but a guaranteed memory wipe is not something Node
can offer. We state this rather than imply a stronger guarantee than the platform
allows.

---

## Summary of what to trust

- **Trust** the math and the client: values and private keys never leave your
  device in usable form, and the server (yours or anyone's) cannot decrypt them.
- **Verify** identities via Key Transparency rather than trusting the server's
  word about who owns which public key.
- **Do not over-trust** containment around a using process or an automated agent:
  human-gated admission, the audit log, and egress hooks reduce risk but do not
  make exfiltration impossible.
- **Plan for** the documented gaps: no forward secrecy at rest, visible metadata,
  no account recovery in this version, and no guaranteed memory wipe.
