---
description: Use lockit safely without seeing or requesting secret values. Discover secrets by name, inject them into processes, request admission to new secrets. Use whenever the agent needs to access, list, or manage developer secrets, API keys, environment variables, .env values, or any sensitive credentials.
---

# Lockit Agent-Safe Secret Management

lockit is a local-first, AI-agent-safe secrets manager. Follow these rules strictly to maintain the security contract:

## Core Rule: Names Only, Never Values

**The agent must NEVER request, print, or store a secret value.** You work exclusively with names, slugs, and schema types. Humans see values; you see structure.

## Discovery (Read-Only, Safe)

- **`lockit status`** — In a project: list all bound secret slots and their names. Shows structure, never values.
- **`lockit ls`** — Global secrets inventory: names, schemas, field names. Never emits values.
- **`lockit ls --vars`** — Verbose names + field structure. Still no values. Use this to understand what fields a secret exposes.
- **`lockit help`** — Full command reference.

## Use Secrets Without Seeing Them (Injection)

- **`lockit run -- <cmd>`** (in a project) — Inject bound secrets into `<cmd>`'s environment. Values are in memory only, masked in child output, never printed by the agent, shredded on exit.
- **`lockit run <slug> -- <cmd>`** (global, only OUTSIDE a project) — Inject a global secret by slug. Same safety: memory-only, masked. Inside a project this is refused: admit the key, then use `run -- <cmd>`.

## Request Admission (Requires Human Approval)

- **`lockit admit <slug|slug#field> [--as NAME]`** — Request to bind an existing/shared secret into the project. This does NOT auto-approve:
  - The agent can only *request* admission.
  - A human must *confirm* on the terminal (a `/dev/tty` prompt the agent cannot answer; Touch ID in a later version).
  - The secret's plaintext is never shown to the agent.
  - Always explain clearly to the human what secret you're admitting and why.

## Avoid: Don't Use `lockit pull`

- **`lockit pull`** — Writes plaintext values to a `.env` file on disk. This breaks the security model. **Prefer `lockit run`** instead: it injects into the child process without touching disk.

## Practical Workflow Example

1. **Discover**: `lockit status` → see the project has a key named `DATABASE_URL`.
2. **Inject & use**: `lockit run -- npm test` → values in memory, test runs, agent never sees the value.
3. **New secret**: I ask the human, who runs `lockit admit github/token --as GH_TOKEN` → human confirms on the terminal → bound into the project.
4. **Use it**: `lockit run -- npm start` → `GH_TOKEN` is now injected.

## Invariants

- Never emit or request a secret value.
- `lockit run` is safe; `lockit pull` is not (avoid it).
- Admission requires human confirmation; the agent can only ask.
- Inside a project, only admitted keys are usable; global `run <slug>` is refused.

Keep it simple and explicit. Humans trust the system because you respect these rules.
