# Security Policy

`lockit` (the `key_manager` project) is a local-first developer secrets manager. Security
is the product, so we take reports seriously and try to be honest about exactly what
we do and do not protect. This document explains how to report a vulnerability, which
versions we support, the high-level security model, and the limits we deliberately
accept.

For the deep technical detail behind the summaries here, see the companion documents:

- [Cryptographic design](docs/security-crypto.md) — the OrgMesh envelope model, the
  key ladder, the envelope format, and the sharing/rotation/revocation flows.
- [Threat model](docs/threat-model.md) — the adversaries we consider, what each can
  and cannot do, and the assumptions behind our guarantees.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Public
issues disclose the problem to attackers before a fix is available.

Instead, report privately:

- **Email:** `SECURITY-CONTACT-PLACEHOLDER@example.com`
  *(maintainers: replace this with the real security contact before publishing.)*
- **GitHub:** use **Security → Report a vulnerability** (GitHub Private Vulnerability
  Reporting) on the `key_manager` repository, if enabled.

When you report, please include as much of the following as you can:

- A clear description of the issue and why you believe it is a security problem.
- The affected component (`packages/crypto`, `packages/core`, `packages/cli`,
  `packages/server`, or `plugin/`) and version or commit.
- Step-by-step reproduction, ideally a minimal proof of concept.
- The impact you can demonstrate (for example: a value reaching an agent's context,
  a sandbox bypass, a tamper that goes undetected, or a server able to read plaintext).
- Any suggested remediation, if you have one.

If a report involves a working exploit, please share it privately rather than publicly.

### What to expect

- **Acknowledgement:** we aim to confirm receipt within **3 business days**.
- **Triage:** an initial assessment (severity and affected versions) within
  **10 business days**.
- **Updates:** we will keep you informed as we investigate and prepare a fix.
- **Fix and disclosure:** we will coordinate a release and a public advisory with you.
  We are happy to credit reporters who wish to be named.

These are targets for a community-run open-source project, not a contractual SLA. We
will always communicate honestly about timelines.

## Supported Versions

`lockit` is pre-1.0 and under active development. Security fixes land on the latest
release line; older pre-1.0 versions are not maintained.

| Version | Supported |
| ------- | --------- |
| Latest `0.x` release | Yes |
| Older `0.x` releases | No — upgrade to the latest |

We follow [semantic versioning](https://semver.org/). Once `1.x` ships, this table
will be updated to state the supported major lines.

## Security Model and Zero-Knowledge Guarantee

`lockit` is **local-first** and built around **client-side envelope encryption**. The two
problems it exists to solve shape the model:

1. Stop secrets from leaking into AI-agent context and transcripts, shell history,
   `.env` files, and casual channels.
2. Let you set a key once and reuse it everywhere without copy-paste.

### Zero-knowledge end-to-end encryption

All encryption and decryption happen **client-side**. The optional self-hosted server
is a dumb, append-only encrypted store-and-relay: it moves and stores ciphertext and
never holds the keys to read it.

The server stores **only**: ciphertext and version history, **public** keys,
never-unwrapped wrapped key material, salts, the OPAQUE login record, the Key
Transparency log and per-user signature chains, and access-control metadata. It
**never** stores any passphrase, private key, seed, data-encryption key (DEK), or
plaintext, and **there is no operator master key.** A server operator — including you,
when self-hosting — cannot decrypt your secrets.

Keys derive from a passphrase through a client-only key ladder (Argon2id → MasterKEK →
AccountKey, with an optional locally generated second factor), and values are sealed
with per-item DEKs that are wrapped per authorized reader. See
[docs/security-crypto.md](docs/security-crypto.md) for the full key hierarchy and the
HPKE/AEAD/signature primitives.

### Agent-safe by construction

A project can only use secrets that have been **admitted** to its project world (a
sandbox). The global store is the protected source; the AI agent can never pull from
it directly — it can only *request* admission. Every admission requires **human
confirmation plus local presence auth** (Touch ID, OS password, or biometric) that the
agent cannot satisfy.

All agent-facing output (`list`, `status`, `--dry-run`, the ambiguity chooser) emits
only slugs, schemas, field names, tags, and `hasValue` booleans — **never a value, not
even masked.** During `lockit run`, values are decrypted in memory, injected into the child
process's environment for its lifetime, masked in the child's stdout/stderr, and shredded
on exit; nothing is written to disk. The model orchestrates; values flow from the vault
to the child process and never enter the model's context or the transcript.

## Scope

In scope for security reports:

- **`packages/crypto`** — envelope encryption, the key hierarchy, HPKE, signatures, and
  zero-knowledge primitives.
- **`packages/core`** — the vault and encrypted at-rest store, and the project-world
  sandbox and human-gated admission gating.
- **`packages/cli`** — the `lockit` binary, including injection (`lockit run`) and the
  agent-safe output guarantees.
- **`packages/server`** — the optional self-hosted sync/sharing relay, Key
  Transparency, and OPAQUE login.
- **`plugin/`** — the Claude Code plugin (skill and guardrail hooks).

Examples of issues we especially want to hear about:

- Any path by which an AI agent obtains a secret **value** through normal `lockit` output.
- Any way to bypass the project-world sandbox or the human-gated admission flow.
- Any way the optional server could read plaintext or unwrap key material.
- Tampering with an encrypted artifact (for example the recipient set) that goes
  undetected.
- Sender impersonation that injects a forged shared secret.
- Duplicate or colliding env-var injection that is not caught at link time or
  `lockit run --dry-run`.

## Honest Non-Goals and Limitations

We would rather be honest about our boundaries than imply protection we do not provide.
The following are **deliberate, accepted limitations**, not bugs. Reports that simply
restate them will be closed with a pointer here; reports that *defeat a guarantee we do
claim* are very welcome.

### No account recovery in this version

This is true zero-knowledge encryption: **if you lose your passphrase and all of your
devices, your data cannot be recovered.** There is no backdoor and no operator master key. This follows from the recovery trilemma — you cannot simultaneously have
no backdoor, loss-proof recovery, and zero extra trust. Account recovery is simply not
part of this version of the product. Protect your passphrase and keep more than one
enrolled device.

### No forward secrecy at rest

A leaked long-term key is **retroactive** over the data it can reach. This is inherent
to durable, random-access encrypted storage (you must be able to decrypt old data at any
time), which is why messaging-style ratchets were rejected for this use case. Rotating a
value seals new versions to current readers only, but **crypto cannot un-leak plaintext
that was already read** — pair rotation with rotating the underlying upstream key.

### Metadata is visible to a server operator

When you use the optional self-hosted server, **values are never exposed, but metadata
is**: secret names/slugs, sizes, version counts, timestamps, and the who-shares-with-whom
graph are visible to whoever operates the server. End-to-end encryption protects contents,
not the shape of the traffic.

### The agent-exfiltration limit

A child process that *uses* a secret inevitably *holds* its real value — that is the
point of injecting it. So a rogue or confused agent could still exfiltrate a value
**through a command it actually runs**. Containment is not omnipotence. Our mitigations
reduce, but do not eliminate, this risk: human-gated admission (the strongest control),
an audit log, and egress warnings via a plugin hook (for example, warning before a raw
secret is written into a file or command). Treat any agent that can run arbitrary
commands as capable of misusing the secrets it has been given.

### The Node memory-zeroing limit

We minimize the lifetime of plaintext in memory, but **Node.js cannot guarantee that a
secret is wiped from memory** because of garbage collection and string immutability. We
cannot promise a reliable secure-erase of in-process plaintext.

### ACL removal is not revocation

Removing someone from an access list does **not**, on its own, revoke their access to
data they could already read. True revocation rotates the team seed to the survivors,
lazily re-wraps the affected DEKs, and rotates the upstream value. See
[docs/security-crypto.md](docs/security-crypto.md) for the revocation flow, and
[docs/threat-model.md](docs/threat-model.md) for how this bounds an insider's reach.

## Responsible Disclosure

We ask that you:

- Give us a reasonable opportunity to investigate and fix the issue before any public
  disclosure. **90 days** is a good default; we will work with you if a fix needs more
  time, and we welcome earlier coordinated disclosure once a fix is available.
- Avoid privacy violations, data destruction, and any disruption to other users while
  testing — work only against your own installation and data.
- Do not exfiltrate more data than is necessary to demonstrate the issue, and delete any
  data you obtained during testing.

In return, we will:

- Investigate every good-faith report and keep you informed.
- Not pursue or support legal action against researchers who follow this policy and act
  in good faith.
- Credit you in the advisory if you would like to be named.

Thank you for helping keep lockit and its users safe.
