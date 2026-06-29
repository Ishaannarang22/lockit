# 8. No account recovery in v1

## Status

Accepted

## Context

**lockit** uses true zero-knowledge encryption: all encryption and decryption is
client-side, and there is no operator master key (see
[ADR 0004](0004-orgmesh-zero-knowledge-crypto.md)). A direct and unavoidable
consequence is the **recovery trilemma**: you cannot have all three of

1. **no backdoor**,
2. **loss-proof** (recoverable even if the user loses everything), and
3. **zero extra trust** (no third party who could be compelled or breached).

Any recovery mechanism that survives total loss of passphrase and devices must
weaken one of these. We had to decide honestly what v1 offers.

## Decision

**Account recovery is not included in this version.** If you lose your
passphrase **and** all your devices, your data cannot be recovered. This is an
intentional, documented limitation of true zero-knowledge encryption, and it is
stated plainly in user-facing docs rather than hidden.

This is a plain limitation of the current version. Account recovery is future
work beyond v1.

Note that the multi-device flow (see
[ADR 0004](0004-orgmesh-zero-knowledge-crypto.md)) already provides resilience
in the common case: as long as you retain **at least one** enrolled device or
your passphrase, you keep access and can enroll new devices. The unrecoverable
case is the total-loss case specifically.

## Consequences

**Positive**

- Preserves the core guarantee: no backdoor and no extra trusted party who
  could be compelled or breached. The server operator genuinely cannot help
  recover, because they hold no key material.
- Honest and simple: the limitation is documented up front, so users can plan
  (keep a second device, safeguard the passphrase).

**Negative / honest tradeoffs**

- Total loss of passphrase **and** all devices means **permanent** data loss.
  There is no escape hatch in v1.
- Users must take responsibility for retaining at least one recovery path
  (a device or the passphrase); the product cannot do it for them without
  breaking the trilemma.

## Alternatives considered

- **Operator-held recovery key / backdoor** — would make data loss-proof, but at
  the cost of a master key that could be compelled or breached. Rejected; it
  contradicts [ADR 0004](0004-orgmesh-zero-knowledge-crypto.md).
- **Recovery via a trusted third party** — re-introduces extra trust and a
  compellable/breachable party. Rejected for v1.
- **Ship some recovery scheme now anyway** — premature; recovery designs that
  respect the trilemma (for example user-controlled offline recovery material)
  deserve dedicated design and are deferred to future work beyond v1.
