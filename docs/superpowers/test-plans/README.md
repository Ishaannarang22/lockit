# Test plans (future phases)

Test blueprints for phases that are **not yet built**. Following the project's
just-in-time TDD, the executable tests are written _with_ each feature; these
documents enumerate every feature → input → expected output → exit code so those
tests can be written and activated the moment a phase lands.

Tests for **built** phases are real and run in CI — unit tests as `*.test.ts`
beside the source, and black-box tests as `e2e/*.e2e.test.ts` (which spawn the
real `lockit` binary in disposable sandbox HOMEs via `pnpm test:e2e`).

| Phase                                             | Plan                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| P2 — Crypto envelope & keys (X25519/HPKE/Ed25519) | [p2-crypto-envelope.md](p2-crypto-envelope.md)                   |
| P3 — Vault, Slots & the 0/1/N resolver            | [p3-vault-resolver.md](p3-vault-resolver.md)                     |
| P4 — Sandbox, admission & the unlock model        | [p4-sandbox-admission-unlock.md](p4-sandbox-admission-unlock.md) |
| P5 — Full CLI surface                             | [p5-cli.md](p5-cli.md)                                           |
