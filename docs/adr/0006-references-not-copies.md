# 6. References, not copies

## Status

Accepted

## Context

A project needs many secrets, and the same secret is often needed by many
projects. The straightforward implementation copies each value into each
project that uses it. But copies drift: when a key rotates, every copy must be
found and updated, and stale copies become a liability. The product's premise is
that you set a key **once** and reuse it everywhere with zero copy-paste, which
only holds if there is a single source of truth.

This decision builds directly on the [Sets + Slots](0003-sets-and-slots-data-model.md)
model, where the committed project vault is value-free.

## Decision

A project vault stores **references, not copies**. The value-free
[Slots](0003-sets-and-slots-data-model.md) point at secrets in the global store
by slug (pinned) or by schema (open). There is a single source of truth: rotate
a value once and all consumers update.

**Opt-in bundling** is available for standalone or offline projects that need
their values embedded rather than referenced.

## Consequences

**Positive**

- Single source of truth: rotate once, and every project referencing the secret
  picks up the new value on next resolution.
- No stale copies scattered across projects.
- The committed vault stays value-free and safe to share, since it holds
  references only.
- Standalone and offline projects are still supported via opt-in bundling.

**Negative / honest tradeoffs**

- A referencing project depends on the global store (or a bundle) being present
  at resolution time; a bare clone is not self-contained until resolved or
  bundled.
- Bundling re-introduces copy semantics for those projects that opt in, with the
  usual drift caveats — an explicit, deliberate tradeoff for offline use.
- Crypto-level sharing of a secret is a point-in-time copy at the recipient;
  later rotation does not auto-propagate unless re-shared (see
  [ADR 0004](0004-orgmesh-zero-knowledge-crypto.md)).

## Alternatives considered

- **Copy values into each project vault** — self-contained per project, but it
  drifts on rotation and scatters secrets, defeating the set-once-reuse-everywhere
  premise. Rejected as the default; offered only as opt-in bundling.
