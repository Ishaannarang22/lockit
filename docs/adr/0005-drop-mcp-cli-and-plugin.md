# 5. Drop MCP; CLI and plugin instead

## Status

Accepted

## Context

**kv** must be usable by AI agents, not just humans. One obvious path is to ship
an MCP (Model Context Protocol) server so AI hosts can call kv as a set of
tools. But the security model of this product lives in the way secrets are
admitted and injected, not in any particular transport. We had to decide where
the agent interface belongs for v1.

Key observations:

- Security lives in the CLI, not in MCP. The admission gating, sandbox, and
  in-memory injection are enforced by `kv` regardless of who calls it.
- The CLI is universal: **any** shell-capable agent can use it.
- A Claude Code skill is essentially sugar over the CLI.

## Decision

**Drop MCP from v1.** The `kv` CLI is the single universal interface for both
humans and agents. Agent ergonomics are delivered through the
[`plugin/`](0002-monorepo-package-layout.md) — a Claude Code skill plus hooks —
which is a thin layer over the CLI and depends on it.

The one reason to add MCP later would be to reach AI hosts that cannot run a
shell. If added, it would be an **optional thin adapter over `core`**, not a
core dependency.

## Consequences

**Positive**

- A single surface to secure, test, and audit: the CLI. The agent-safety
  properties (see [ADR 0007](0007-project-world-sandbox-human-gated-admission.md))
  hold for every caller automatically.
- Immediate reach: any shell-capable agent works today, with no protocol
  adapter to maintain.
- The Claude Code plugin stays thin — skill plus guardrail hooks over the CLI —
  rather than reimplementing logic.

**Negative / honest tradeoffs**

- AI hosts that **cannot** run a shell are not reachable in v1.
- Agents that prefer structured tool schemas over shell invocation get a
  slightly less native experience until an MCP adapter exists.

## Alternatives considered

- **Ship MCP as the primary agent interface in v1** — would split the security
  surface across two transports and risk drift between them, while the CLI
  already reaches almost every agent. Rejected.
- **Ship both MCP and CLI from day one** — doubles the maintenance and audit
  burden for marginal v1 benefit. Deferred: MCP may come later as an optional
  thin adapter over `core` if shell-less hosts become important.
