---
name: lockit-agent-safe
description: Use lockit safely without seeing or requesting secret values. Discover secrets by name, inject them into processes, request admission, and share or receive encrypted secret copies. Use whenever the agent needs developer secrets, API keys, environment variables, .env values, encrypted sharing, or sensitive credentials.
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

## Use Secrets Without Seeing Them

- **`lockit run -- <cmd>`** (in a project) — Inject bound secrets into `<cmd>`'s environment. Values are in memory only, masked in child output, never printed by the agent, shredded on exit.
- **`lockit run <slug> -- <cmd>`** (global, only OUTSIDE a project) — Inject a global secret by slug. Same safety: memory-only, masked. Inside a project this is refused: admit the key, then use `run -- <cmd>`.

## Request Admission (Requires Human Approval)

- **`lockit admit <slug|slug#field> [--as NAME]`** — Request to bind an existing/shared secret into the project. This does NOT auto-approve:
  - The agent can only *request* admission.
  - A human must *confirm* on the terminal (a `/dev/tty` prompt the agent cannot answer; Touch ID in a later version).
  - The secret's plaintext is never shown to the agent.
  - Always explain clearly to the human what secret you're admitting and why.

## Share Secrets End-to-End Encrypted

Sharing uses public identities and ciphertext artifacts. You may help run these commands, move public identity files, or move encrypted share files, but you must never ask for, print, or inspect secret values or private identity material.

- **`lockit identity [--out <file>]`** — Create or show this device's public sharing identity. This is public key material only; private sharing keys stay sealed in `LOCKIT_HOME`.
- **`lockit identity register <username> [--relay <url>]`** — Register this device's public identity on a relay. The relay stores public keys only.
- **`lockit identity whois <username> [--relay <url>]`** — Resolve a username to a public identity id. Value-free.
- **`lockit share <slug> --to <public-identity.json|@username> [--out <file>] [--relay <url>]`** — Encrypt and sign a point-in-time copy of one stored secret for a recipient. `@username` sends via the relay; a file identity with no flags prints ciphertext, never plaintext.
- **`lockit accept <share-file> [--as <slug>]`** — Decrypt a share addressed to this device and create a new local copy. Existing slugs are never overwritten; lockit suffixes instead.
- **`lockit receive [--relay <url>]`** — Fetch encrypted shares addressed to this device from a relay, accept each one, and delete accepted relay messages.
- **`lockit relay [set <url> | reset]`** — Show or change the relay in use. Relay commands default to the shared public relay; precedence is `--relay` flag, then `LOCKIT_RELAY`, then `relay set`, then the public default. The public relay sleeps when idle and can take up to a minute to wake.

Important limits:

- A share is a point-in-time copy. Later rotation of the sender's secret does not auto-propagate; re-share after rotation when the recipient needs the new value.
- The relay cannot decrypt share contents, but it can see metadata such as usernames, recipient identity ids, timing, and message sizes.
- Receiving a share only adds it to the local global store. To use it in a project, request `lockit admit <slug>` and wait for human approval.

## Avoid: Don't Use `lockit pull`

- **`lockit pull`** — Writes plaintext values to a `.env` file on disk. This breaks the security model. **Prefer `lockit run`** instead: it injects into the child process without touching disk.

## Practical Workflow Example

1. **Discover**: `lockit status` → see the project has a key named `DATABASE_URL`.
2. **Inject & use**: `lockit run -- npm test` → values in memory, test runs, agent never sees the value.
3. **New secret**: I ask the human, who runs `lockit admit github/token --as GH_TOKEN` → human confirms on the terminal → bound into the project.
4. **Use it**: `lockit run -- npm start` → `GH_TOKEN` is now injected.

## Sharing Workflow Example

1. Recipient publishes a public identity: `lockit identity --out bob.lockit-id.json`, or registers a username with `lockit identity register bob` (public relay by default).
2. Sender shares without exposing the value: `lockit share openai/dev --to bob.lockit-id.json --out openai-dev.lockit-share` or `lockit share openai/dev --to @bob`.
3. Recipient accepts: `lockit accept openai-dev.lockit-share` or `lockit receive`.
4. Recipient admits the received slug into a project before project use: `lockit admit openai/dev`.

## Invariants

- Never emit or request a secret value.
- `lockit run` is safe; `lockit pull` is not (avoid it).
- Admission requires human confirmation; the agent can only ask.
- Inside a project, only admitted keys are usable; global `run <slug>` is refused.
- Sharing artifacts and relay messages are ciphertext; private identities and secret values must never enter the transcript.

Keep it simple and explicit. Humans trust the system because you respect these rules.
