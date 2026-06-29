# 1. Language: TypeScript on Node

## Status

Accepted

## Context

**lockit** is a developer-facing CLI that doubles as the interface used by AI
coding agents. It ships a security-critical cryptographic core, an optional
self-hosted sync server, and a Claude Code plugin. We need a single language
that:

- runs well as a command-line tool in the environments developers and agents
  already inhabit;
- has mature cryptographic libraries we can lean on rather than reimplement;
- supports a strongly-typed, well-tested codebase across several packages;
- lets the CLI, server, and plugin share code without a language boundary.

The plugin target (Claude Code) and the broader Node tooling ecosystem also
weigh heavily: the plugin depends on the `lockit` CLI, and the npm ecosystem
carries the audited crypto primitives we intend to use.

## Decision

Implement the entire project in **TypeScript on Node**, in **strict mode**.

The recommended cryptographic libraries are all available on npm and inform
this choice: `@hpke/core`, `@hpke/dhkem-x25519`, `@hpke/chacha20poly1305`,
`libsodium-wrappers-sumo`, `sodium-native`, `hash-wasm`, `argon2`,
`@serenity-kit/opaque`, `@noble/curves`, `@noble/ciphers`, `@noble/hashes`,
`age-encryption`, and `@transparency-dev/merkle`.

## Consequences

**Positive**

- One language across `packages/crypto`, `packages/core`, `packages/cli`,
  `packages/server`, and `plugin/`; shared types flow end to end.
- Strict TypeScript gives us compile-time guarantees that matter most in the
  security-critical `crypto` and `core` packages.
- Direct access to a large set of audited, modern crypto libraries.
- Natural fit for the Node-based CLI and the Claude Code plugin that wraps it.

**Negative / honest tradeoffs**

- Node cannot guarantee zeroing secrets from memory because of garbage
  collection. We minimize plaintext lifetime but cannot promise a wipe. This
  limitation is documented and accepted; see
  [ADR 0004](0004-orgmesh-zero-knowledge-crypto.md) and
  [ADR 0007](0007-project-world-sandbox-human-gated-admission.md).
- A managed runtime is heavier than a compiled static binary, and distribution
  carries the Node toolchain's footprint.

## Alternatives considered

- **Rust or Go** — produce single static binaries and offer stronger memory
  control (helpful for secret zeroing). Rejected for v1 because the Claude Code
  plugin ecosystem, the npm crypto libraries we want, and shared types across
  CLI/server/plugin all align on the Node/TypeScript ecosystem. The memory-zeroing
  benefit does not outweigh the cost of splitting the codebase across languages.
