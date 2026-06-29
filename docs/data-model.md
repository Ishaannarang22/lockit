# Data Model: Sets + Slots

This document specifies the `lockit` data model: how secrets are stored, how
projects declare what they need, and how the two are connected at run time
without ever copying a value.

The model exists to solve one structural problem: developers waste enormous
amounts of time hunting for and copy-pasting API keys across projects and
prototypes, and those copies leak into `.env` files, shell history, AI-agent
transcripts, and casual channels. With Sets + Slots you **set a key once and
reuse it everywhere by reference**, and an AI agent can drive your tools
without ever seeing a value.

Related docs:

- [`./architecture.md`](./architecture.md) — package layout and where this model lives (`packages/core`).
- [`./threat-model.md`](./threat-model.md) — the project-world sandbox, human-gated admission, and agent-safety guarantees.
- [`./security-crypto.md`](./security-crypto.md) — how values are encrypted at rest and shared end-to-end (OrgMesh).
- The `lockit` commands that operate on this model are listed in the CLI surface section below; a full standalone command reference is forthcoming.

---

## 1. Overview and vocabulary

There are two halves to the model, and keeping them separate is the whole idea.

| Concept | Holds values? | Committed to git? | Lives in |
| --- | --- | --- | --- |
| **Global store** | **Yes** (encrypted at rest) | **No** — local to your machine / synced E2E | `packages/core` store |
| **Project vault** | **No** — value-free requirements only | **Yes** — `./.lockit/vault.json` | the project repo |
| **Local resolution cache** | No — records *which* secret fills an open slot | **No** — gitignored `./.lockit/local.json` | the project, per machine |

- A **Secret** is the unit stored in the global store: a typed bag of one or
  more **fields**, identified by a portable human **slug** and tagged with a
  **schema**.
- A **Slot** is a requirement declared by a project vault: "this project needs
  a secret of schema X, injected under these env-var names."
- The **resolver** connects slots to secrets at run time, strictly and without
  guessing.

The store is keyed by **slug**, never by env-var name. This is the central
design choice: `supabase/acme` and `supabase/blog` can both contain a field
named `SUPABASE_URL` with zero collision, because they are distinct secrets
addressed by distinct slugs.

---

## 2. The Secret

A Secret is a **typed field-bag**. The smallest Secret has one field (a single
OpenAI key); a larger one groups several fields that always travel together (a
Supabase backend: URL + anon key + service-role key).

### 2.1 Identity: slug, schema, aka

- **`slug`** — the portable human identifier, e.g. `openai/dev`,
  `supabase/acme`. This is the stable address you use everywhere. Slugs are
  conventionally `provider/qualifier`, but any string is allowed.
- **`schema`** — what *kind* of secret this is, e.g. `openai`, `supabase`.
  Used for completeness checks, autocomplete, and slot matching. Comes from the
  built-in registry (§3) or is a free string for unknown providers.
- **`aka`** — an alias list that makes a Secret **rename-safe**. If you rename
  `openai/main` to `openai/dev`, the old slug stays in `aka` so existing
  pinned references keep resolving.
- **`localId`** — a machine-local convenience handle only. It is **never
  committed** and never used as a portable identifier.

### 2.2 Fields

Each field has a key (the logical name used in the inject map), a value, and a
**type**:

- **`type: "env"`** — a plain string value. At run time it is injected as the
  value of an environment variable.
- **`type: "file"`** — the value is file *contents*. At run time the contents
  are materialized to a temporary file (see §9), and the env var the field maps
  to receives the **path** to that file rather than the contents.

### 2.3 Versions

A Secret carries **versions**. The current version holds the live value;
previous versions are retained for history and rollback. Rotation creates a new
version (see [`./security-crypto.md`](./security-crypto.md) for how each version gets a fresh
per-item DEK). Consumers always resolve the current version unless explicitly
pinned otherwise.

### 2.4 JSON shape — singleton Secret (one OpenAI key)

```json
{
  "slug": "openai/dev",
  "schema": "openai",
  "aka": ["openai/main"],
  "fields": [
    {
      "key": "OPENAI_API_KEY",
      "type": "env",
      "hasValue": true
    }
  ],
  "versions": [
    { "id": "v2", "current": true, "createdAt": "2026-06-10T09:00:00Z" },
    { "id": "v1", "current": false, "createdAt": "2026-01-04T12:00:00Z" }
  ],
  "tags": ["personal"]
}
```

> Note: the `value` of each field is **not** shown here and never appears in
> any listing output — only `hasValue: true`. The plaintext lives encrypted in
> the store and is only ever decrypted in memory at `lockit run`. See §11.

### 2.5 JSON shape — multi-field Set (a Supabase backend)

```json
{
  "slug": "supabase/acme",
  "schema": "supabase",
  "aka": [],
  "fields": [
    { "key": "SUPABASE_URL", "type": "env", "hasValue": true },
    { "key": "SUPABASE_ANON_KEY", "type": "env", "hasValue": true },
    { "key": "SUPABASE_SERVICE_ROLE_KEY", "type": "env", "hasValue": true }
  ],
  "versions": [
    { "id": "v1", "current": true, "createdAt": "2026-03-01T08:30:00Z" }
  ],
  "tags": ["acme", "backend"]
}
```

---

## 3. Schemas: built-in registry plus free strings

A **schema** describes the expected shape of a Secret of a given kind.

- The **built-in registry** ships field shapes for known providers (e.g.
  `openai` expects `OPENAI_API_KEY`; `supabase` expects `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). The registry powers:
  - **completeness checks** — warn if a `supabase` Secret is missing
    `SUPABASE_SERVICE_ROLE_KEY`;
  - **autocomplete** — suggest field keys and env-var names when you create a
    Secret or wire up a slot.
- **Free strings** — any schema name not in the registry is accepted as a plain
  string. Unknown providers work immediately; you simply do not get the
  registry's completeness hints for them.

A schema is a convenience and a matching key. It never constrains values and
never blocks you from storing a Secret.

---

## 4. The project vault: slots

The project vault (`./.lockit/vault.json`) is **value-free**. It is a committed
list of **slots** — declared requirements — and nothing else. Cloning a repo
never grants access to any secret; it only tells `lockit` what the project needs.

A slot has this shape:

```json
{
  "schema": "supabase",
  "bind": "pinned",
  "to": "supabase/acme",
  "inject": {
    "SUPABASE_URL": "SUPABASE_URL",
    "SUPABASE_ANON_KEY": "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY": "SUPABASE_SERVICE_ROLE_KEY"
  }
}
```

### 4.1 `bind`: pinned vs open

- **`bind: "pinned"`** — the slot must resolve to *exactly* the slug named in
  `to`. Use this for genuinely shared infrastructure that every developer and
  environment must use (e.g. a single shared staging database).
- **`bind: "open"`** — the slot accepts any secret of the declared `schema`
  that the developer supplies locally. `to` is `null`. Use this for
  per-developer or per-project backends, where each person brings their own
  secret of the right kind.

### 4.2 The `inject` map

`inject` maps each **field key** to the **exact environment-variable name**
the child process should see. This decouples your storage naming from each
project's expected env vars.

- **One value, many names.** A single field can be projected under several env
  names by listing them — for example a Supabase URL exposed to a frontend
  framework:

  ```json
  "inject": {
    "SUPABASE_URL": ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"]
  }
  ```

- **Unique-inject-name invariant.** Within a single vault, the **union of all
  injected env-var names must be unique**. Two slots (or two entries) producing
  the same env var is a **hard error** — caught at link time and again at
  `lockit run --dry-run`. This prevents one secret from silently shadowing another.

---

## 5. References, not copies

A slot stores a **reference** (`to: slug`, or "any of schema X"), never a copy
of the value. There is exactly one source of truth — the Secret in the global
store.

- **Rotate once, everyone updates.** Change the value in the store and every
  project that references it picks up the new version on its next `lockit run`. No
  hunting through `.env` files.
- **Opt-in bundling.** For a standalone or offline project that must carry its
  own secrets, you can opt in to **bundling**: an explicit, deliberate
  materialization of the referenced values into the project. This is the
  exception, not the default, precisely because it breaks the
  single-source-of-truth guarantee. (Bundles are encrypted; see
  [`./security-crypto.md`](./security-crypto.md).)

---

## 6. The strict 0/1/N resolver

Resolution maps a slot to a concrete Secret. The resolver **never guesses** and
uses **no label heuristics** that could silently pick the wrong value.

For a given slot, the resolver counts the candidate Secrets:

| Match count | Pinned slot | Open slot |
| --- | --- | --- |
| **Exact slug** (`to`) | Used directly. | n/a (open slots have no `to`). |
| **0 matches** | **Missing** — the pinned slug does not exist. | **Open-unfilled** — you must supply a secret of this schema. |
| **1 match** | (covered by exact slug) | **Resolves** to that single secret, and the chosen slug is **printed** ("auto-fill but tell me"). |
| **N matches** (N > 1) | n/a | **Hard `AMBIGUOUS` error** with a value-free, numbered chooser. |

- An **exact slug** always wins for pinned slots.
- For open slots, **exactly one** candidate resolves cleanly and tells you what
  it chose.
- **More than one** candidate is a structured `AMBIGUOUS` error — never a coin
  flip. The chooser lists slugs, schemas, and tags only (never values), so a
  human (or an agent surfacing the error to a human) can disambiguate.
- **Zero** candidates is reported as missing (pinned) or open-unfilled (open).

This strictness is what makes the model safe for AI agents: an ambiguous
situation is an error the model **cannot** resolve by guessing.

---

## 7. The per-environment axis

Per-environment (`dev` / `staging` / `prod`) is **in scope for v1** as an
**optional secondary axis**.

- The default is **single-context**: most projects need no environment axis at
  all, and you should not opt in until you do.
- When you opt in, a slot can resolve to different Secrets per environment. The
  active environment is selected at run time (e.g. `lockit run --env prod -- ...`).

```json
{
  "schema": "supabase",
  "bind": "pinned",
  "to": {
    "dev": "supabase/acme-dev",
    "staging": "supabase/acme-staging",
    "prod": "supabase/acme-prod"
  },
  "inject": { "SUPABASE_URL": "SUPABASE_URL" }
}
```

A slot with a plain string `to` (no environment map) behaves identically in all
contexts. The 0/1/N resolver (§6) applies per selected environment.

---

## 8. File-based secrets

A field is either `type: "env"` (a string injected as an env var) or
`type: "file"` (contents materialized to a file). File-type fields are **in
scope for v1**.

Canonical example: a Google service-account JSON consumed via
`GOOGLE_APPLICATION_CREDENTIALS`.

```json
{
  "slug": "gcp/analytics",
  "schema": "gcp-service-account",
  "aka": [],
  "fields": [
    { "key": "SERVICE_ACCOUNT_JSON", "type": "file", "hasValue": true }
  ],
  "versions": [{ "id": "v1", "current": true }],
  "tags": ["gcp"]
}
```

The slot maps the file field to the env var that should hold its **path**:

```json
{
  "schema": "gcp-service-account",
  "bind": "pinned",
  "to": "gcp/analytics",
  "inject": { "SERVICE_ACCOUNT_JSON": "GOOGLE_APPLICATION_CREDENTIALS" }
}
```

At `lockit run` (§9), the contents are written to a temp file on tmpfs with `0600`
permissions, `GOOGLE_APPLICATION_CREDENTIALS` is set to that path, and the file
is shredded when the child process exits.

---

## 9. Injection at run time (`lockit run`)

`lockit run` is the only path that touches plaintext, and it is deliberately
ephemeral. In summary, it:

1. resolves every slot (§6) for the selected environment (§7);
2. decrypts only the needed values **in memory**;
3. spawns the child process with the resolved env vars set for its lifetime;
4. for `type: "file"` fields, materializes a tmpfs file (`0600`), points the
   env var at the path;
5. **masks** all secret values in the child's stdout/stderr;
6. writes nothing to disk; **shreds** temp files on exit.

`lockit run --dry-run` is the **agent-safe verification primitive**: it prints the
env-var **names** that will be set (values masked) and flags duplicate inject
names (§4.2), unfilled open slots, and ambiguous resolution — without running
anything or revealing a value. See [`./threat-model.md`](./threat-model.md) for the
full agent-safety model and honest limits.

---

## 10. The local resolution cache

Open slots (§4.1) are filled per machine. The **local resolution cache**
(`./.lockit/local.json`, **gitignored**) records how each open slot was filled on
*this* machine, so you are not re-prompted every run.

```json
{
  "version": 1,
  "resolutions": [
    {
      "slot": { "schema": "supabase", "bind": "open" },
      "resolvedTo": "supabase/blog",
      "env": "dev",
      "resolvedAt": "2026-06-15T18:22:00Z"
    }
  ]
}
```

The cache holds **slugs only**, never values. It is a convenience record of
*which* secret fills *which* open slot — deleting it simply means the next run
re-resolves (and, where ambiguous, re-prompts).

---

## 11. Values never leak into listings or agent context

Every model-facing surface — `lockit list`, `lockit status`, `lockit run --dry-run`, and
the ambiguity chooser — emits **only** slugs, schemas, field keys, tags, and
`hasValue` booleans. Never a value, not even masked. Values flow from the store
to the child process **in memory** and never enter an agent's context or the
transcript. See [`./threat-model.md`](./threat-model.md) for the full guarantees and
the honestly-documented limits (a child process inevitably holds the value it
uses).

---

## 12. Canonical scenarios

How the model handles each headline use case:

| Scenario | How the model handles it |
| --- | --- |
| **One OpenAI key everywhere** | Store one Secret `openai/dev` (schema `openai`, one `env` field). Every project declares a slot `{ schema: "openai", bind: "open" or pinned to "openai/dev", inject: { OPENAI_API_KEY: "OPENAI_API_KEY" } }`. Set once, referenced everywhere; rotate once and all projects pick it up. |
| **Two different Supabases** | Store `supabase/acme` and `supabase/blog`, both schema `supabase`, each with its own `SUPABASE_URL` etc. The store is keyed by slug, so the identical field names **never collide**. |
| **Two projects sharing one Supabase** | Both project vaults declare a **pinned** slot `to: "supabase/acme"`. Both reference the same Secret — one source of truth; rotating `supabase/acme` updates both projects. |
| **Disambiguation** | A project has an **open** `supabase` slot and the store has both `supabase/acme` and `supabase/blog`. The resolver returns a hard `AMBIGUOUS` error with a numbered, value-free chooser (slug/schema/tags). The developer picks; the choice is written to the local cache (§10). |
| **Injection** | `lockit run` resolves slots, decrypts in memory, sets exact env-var names from the `inject` map (env values inline; file values via a tmpfs path), masks output, and shreds on exit. `--dry-run` previews the names safely. |
| **Sharing** | A Secret is shared to another device or teammate **encrypted end-to-end** (see [`./security-crypto.md`](./security-crypto.md)). The recipient gets the referenced Secret into their store by slug; their project vaults then resolve against it exactly as yours do. A share is a point-in-time copy — later rotation does not auto-propagate unless re-shared. |
| **New-developer onboarding** | Clone the repo: the committed vault declares slots but holds **no values**. The new developer fills **open** slots with their own secrets (or is granted **pinned** shared infrastructure via sharing) and runs `lockit status` / `lockit run`. Resolution is **lazy** — it triggers at run/status, never on clone. |

---

## 13. CLI surface that operates on this model

The subset of the `lockit` command line that reads or writes the data model. (Full
reference, flags, and output formats will live in a dedicated CLI reference (forthcoming).)

**Secrets in the global store**

- `lockit set <slug> [--schema <name>] [FIELD=VALUE ...]` — create or update a
  Secret; supports `--file FIELD=<path>` for `type: "file"` fields.
- `lockit get <slug>` — show a Secret's structure (slugs, schema, field keys,
  `hasValue`) — never values.
- `lockit list [--schema <name>] [--tag <tag>]` — list Secrets; value-free output.
- `lockit rm <slug>` — remove a Secret.
- `lockit rename <old-slug> <new-slug>` — rename, recording the old slug in `aka`.
- `lockit rotate <slug>` — create a new version of a Secret's value(s).
- `lockit tag <slug> <tag> ...` / `lockit untag <slug> <tag> ...` — manage tags.

**Schemas**

- `lockit schema list` — show built-in registry schemas and their field shapes.
- `lockit schema show <name>` — show expected fields for a schema.

**Project vault and slots**

- `lockit init` — create `./.lockit/vault.json` for the current project.
- `lockit link <schema> [--pinned <slug> | --open] [--inject FIELD=ENV_VAR ...]` —
  add or update a slot. Enforces the unique-inject-name invariant (§4.2).
- `lockit unlink <schema|slot-id>` — remove a slot.
- `lockit vault show` — show the vault's slots (value-free).

**Resolution, environments, and running**

- `lockit status [--env <name>]` — lazily resolve all slots and report each as
  resolved / missing / open-unfilled / ambiguous (value-free).
- `lockit use <schema> <slug> [--env <name>]` — fill an **open** slot for this
  machine; written to the local cache (§10).
- `lockit run [--env <name>] [--dry-run] -- <command> ...` — inject and run (§9);
  `--dry-run` previews env-var names and flags duplicates, unfilled open slots,
  and ambiguity.

**Sharing (P3/P4 — see [`./security-crypto.md`](./security-crypto.md))**

- `lockit share <slug> --to <recipient>` — share a Secret end-to-end encrypted.
- `lockit bundle [--out <path>]` — opt-in materialize referenced values into a
  bundle for a standalone/offline project (§5).

---

## 14. Limitations (stated honestly)

- **No account recovery in this version.** `lockit` uses true zero-knowledge
  encryption. If you lose your passphrase **and** all your devices, your data
  **cannot** be recovered — there is no backdoor. This is an
  intentional, documented limitation. Keep a device and your passphrase safe.
- **A share is a point-in-time copy.** Re-share after rotation if a recipient
  must stay current.
- **Bundling breaks single-source-of-truth** by design — use it only for
  genuinely standalone or offline projects.

See [`./security-crypto.md`](./security-crypto.md) and [`./threat-model.md`](./threat-model.md) for the
full set of honest non-goals.
