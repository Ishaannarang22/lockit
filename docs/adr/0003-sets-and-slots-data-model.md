# 3. The "Sets + Slots" data model

## Status

Accepted

## Context

Developers waste large amounts of time hunting for and copy-pasting API keys
across projects and prototypes. A naive secrets store keyed by environment
variable name collides immediately: two Supabase backends both want a variable
named `SUPABASE_URL`, but they hold different values. We need a model that:

- lets a key be set **once** and reused across many projects with zero
  copy-paste;
- structurally avoids env-var name collisions between unrelated secrets;
- distinguishes the **value** (a secret) from a project's **requirement** for a
  value;
- is safe to commit to a project, value-free, so agents and teammates can read
  the shape of a project without ever seeing a secret;
- never silently guesses which secret to use.

## Decision

Adopt the **Sets + Slots** model.

**Global store holds Secrets.** A **Secret** is a typed bag of one or more
**Fields**, identified by a portable human **Slug** (for example `openai/dev`,
`supabase/acme`) plus a **Schema** (for example `openai`, `supabase`). A
singleton such as one OpenAI key is a Set with **one** field; a Supabase
backend is a Set with **three** fields (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`).

The store is keyed by **Slug, not by env-var name**. Therefore `supabase/acme`
and `supabase/blog` can both contain a field named `SUPABASE_URL` with zero
collision — this is the central problem the model solves, structurally. Secrets
are rename-safe via an `aka` alias list. A `localId` is a machine-local
convenience only and is **never committed**.

**Schemas** come from a built-in registry of known providers (with field shapes
for completeness checks and autocomplete) **plus** free strings for unknown
providers.

**Project vault** (committed, e.g. `./.lockit/vault.json`) is **value-free**: a
list of **Slots** (requirements). A slot is
`{ schema, bind: pinned|open, to: slug-or-null, inject: { fieldKey -> EXACT_ENV_VAR_NAME } }`.

- **pinned** means it must be exactly that slug (genuinely shared
  infrastructure).
- **open** means any secret of this schema that the developer supplies locally
  (per-developer or per-project backends).

A local resolution cache (gitignored, e.g. `./.lockit/local.json`) records how
**open** slots are filled on **this** machine.

**One-value-many-names.** The `inject` map lets any field map to any env-var
name, and multiple names can map to one field (for example `SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, and `VITE_SUPABASE_URL`). **Invariant:** the union
of injected env-var names within a single vault must be unique; a duplicate is a
**hard error** at link time and at `run --dry-run`.

**Field types.** A field is `type=env` (a string injected as an env var) or
`type=file` (contents materialized to a temp file on tmpfs with `0600`
permissions; an env var points to the path; shredded on process exit). The
canonical example is a Google service-account JSON consumed via
`GOOGLE_APPLICATION_CREDENTIALS`.

**Per-environment** (dev/staging/prod) is in scope for v1 as an optional
secondary environment axis; the default is single-context, and you opt in when
needed.

**Strict 0/1/N resolver.** The resolver never guesses: an exact slug is used;
exactly one match resolves; more than one match is a hard structured
**ambiguous** error with a value-free numbered chooser; zero is missing or
open-unfilled. There are no label heuristics that could silently pick a wrong
value.

## Consequences

**Positive**

- Set a key once, reuse it everywhere — the primary time-saver.
- Collisions between same-named fields in different secrets are impossible by
  construction, because the store is keyed by slug.
- The committed vault is value-free, so it is safe for agents, teammates, and
  version control to read.
- The strict resolver makes wrong-value selection a hard, visible error rather
  than a silent mistake.
- File-type secrets and per-environment support cover real-world needs (service
  accounts, dev/staging/prod) within one model.

**Negative / honest tradeoffs**

- The model is richer than a flat `.env` file; users must learn slugs, schemas,
  pinned vs open, and the inject map.
- Ambiguity surfaces as an error the user must resolve via the chooser rather
  than being auto-decided — deliberate, but it adds a step.
- The uniqueness invariant on injected env-var names can reject otherwise valid
  vaults until the conflict is fixed.

## Alternatives considered

- **Key the store by env-var name** — simplest, but it collides the moment two
  secrets share a variable name, which is exactly the central pain. Rejected.
- **Heuristic label matching to auto-pick a secret** — convenient, but it can
  silently inject the wrong value, an unacceptable risk for a secrets manager.
  Rejected in favor of the strict 0/1/N resolver.
- **Copying values into each project** — see
  [ADR 0006](0006-references-not-copies.md); rejected in favor of references.
