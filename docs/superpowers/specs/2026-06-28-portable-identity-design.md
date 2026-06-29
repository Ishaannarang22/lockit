# Portable Secret Identity + Reference File — Design

**Status:** draft for review
**Date:** 2026-06-28
**Branch:** `feat/portable-identity`
**Scope:** `packages/core` + `packages/cli`. **No server.**

This is **Project 1** of a two-project decomposition that came out of a design
conversation:

- **Project 1 (this doc)** — standardized, project-independent secret identity
  and a value-free *reference file* you can commit, so a teammate who already
  owns the right key gets a working `.env` with no value ever shared.
- **Project 2 (separate cycle)** — the ciphertext-only relay + end-to-end value
  sharing (OrgMesh share / Key Transparency / TOFU / hybrid retention), for the
  case where the teammate does **not** already own the key. Out of scope here.

The commercial / hosted product is out of scope and, per repo policy, is not
described in this repository.

---

## 1. Problem

Today, identity is polluted by *where a secret was imported from*. `lockit
import` (`packages/cli/src/import.ts:43`) defaults a secret's slug to
`slugifyDir(basename(process.cwd()))` — the directory you ran the import in. So
a Pulse API key imported while you are in `plugin-manager/` becomes:

```
slug:   plugin-manager
schema: plugin-manager
ref:    plugin-manager#API_KEY
```

That provenance is baked into the portable identity forever. Two consequences:

1. The reference (`plugin-manager#API_KEY`) is meaningless to anyone else and
   non-portable across your own projects.
2. There is no shared, canonical way to say "the Pulse API key," so a value-free
   file of references cannot auto-resolve against *another person's* store.

## 2. Goal

A secret has a **canonical, origin-independent identity** that means the same
thing to everyone. As a result, you can commit a **value-free reference file**
(`PULSE_API_KEY=@pulse`), a teammate pulls it, and if they already own a key of
that canonical kind it fills their `.env` automatically — **after one
batch-admission (one Touch ID), never zero.** No value crosses the wire; each
person binds *their own* key.

## 3. The three names (the core distinction)

The word "name" hides three different things. Only one is standardized:

| Name | Example | Owned by | Standardize? |
| --- | --- | --- | --- |
| **Slug** = `provider/qualifier` | `pulse/test` | provider canonical, qualifier personal | **provider half only** |
| **Injected env-var name** | `PULSE_API_KEY` | the consuming app | no — lives in the reference, per-project |
| **Field key** | `API_KEY` | the secret's schema | via registry (canonical) |

- The **`provider`** segment of the slug is the canonical, shared token (the
  same word `pulse` in everyone's store, ideally from the registry, §5).
- The **`qualifier`** stays personal, so you can hold `pulse/test` and
  `pulse/prod` without collision. It is never required for a match.
- **Provenance** (the importing directory) is **not** identity — it becomes a
  **tag** (`source:plugin-manager`), §6.

## 4. What already exists vs. what changes

Grounded in the current code:

- `model/secret.ts` — `Secret { slug, schema, aka, fields, versions, tags }`
  already exists, including `tags`. **No model change needed** to demote
  provenance to a tag.
- `store/resolve.ts` — `resolveVar(name)` matches a bare env-var key across all
  secrets (0/1/N) or an exact `bundle#KEY`. This is **field-key** matching.
- `cli/import.ts` — defaults slug to the CWD (the bug above).

Changes this project makes:

1. **Import** stops using the CWD as identity; derives a canonical provider
   identity and records provenance as a tag (§6).
2. A **registry** provides the canonical provider vocabulary, built-in and
   user/team-extensible (§5).
3. **Export/import of a value-free reference file** keyed by the canonical
   provider token (§7), with resolution binding on that token — **not** on the
   bare env-var name, to keep the strict resolver unambiguous (§8).
4. **One-time batch admission** gates the first resolve of a pulled file (§9).

## 5. Canonical identity & registry (built-in + extensible)

A **registry entry** for a provider declares:

```jsonc
{
  "provider": "pulse",                 // canonical token (== slug provider segment, == schema)
  "fields": ["API_KEY"],               // canonical field keys
  "env": { "API_KEY": ["PULSE_API_KEY"] }, // conventional env-var name(s) apps expect
  "match": ["PULSE_API_KEY", "PULSE_KEY"]  // raw env names recognized on import (optional)
}
```

- **Built-in registry** ships common providers (the data model already
  references `openai`, `supabase`). Curated, predictable.
- **User/team-extensible** (Option B, chosen): a local registry file
  (e.g. `~/.lockit/registry.json`) and, optionally, a project-level file, let
  internal services like `pulse` become first-class canonical providers so they
  get the same auto-fill. Merge order: project > user > built-in.
- **Unknown providers still work** as free-string providers (today's behavior);
  they just are not "blessed" with `match`/`env` hints.

The registry is **value-free metadata** and is safe to commit/share.

## 6. Import change: identity from registry, provenance to a tag

`lockit import [path] [--as <slug>]`:

- If `--as <slug>` is given, honor it (explicit identity).
- Otherwise, derive the **canonical provider** per variable via the registry's
  `match` hints (e.g. a `PULSE_API_KEY=` line → provider `pulse`, field
  `API_KEY`). Slug defaults to the bare provider (`pulse`); the qualifier is
  added only to disambiguate an existing same-provider secret.
- **Never** default the slug to the CWD.
- Record where it came from as a **tag**: `source:<cwd-basename>`. Provenance is
  discoverable (`lockit ls --tag source:plugin-manager`) but never identity.
- Variables with no registry match fall back to a free-string provider derived
  from the variable, **not** the CWD; ambiguous/unmatched cases are reported so
  the human can `--as` them. The resolver never guesses.

## 7. The portable reference file

The shareable artifact is **value-free** and `.env`-shaped (Option A: keep the
structured vault as source of truth; this is the friendly surface):

```dotenv
# safe to commit — references, not secrets
PULSE_API_KEY=@pulse
SUPABASE_URL=@supabase/acme
```

- **`lockit export [--out <path>]`** writes `ENV_NAME=@<ref>` for each resolved
  binding, where `<ref>` is the **canonical provider** (or full slug for a
  pinned one). It writes **no values**.
- **`lockit import` / resolve** reads `ENV_NAME=@<ref>` lines: each `@<ref>` is
  resolved against the local store, and the result fills `ENV_NAME`.

**Litmus invariant (hard):** any line whose right-hand side is a *real value*
must never be produced by `export` nor written to a committable file. `export`
emits only `@<ref>` tokens. A test asserts no value ever appears in export
output.

## 8. Resolution of a reference

Resolving `@<ref>` is strict **0/1/N**, binding on the canonical token:

| `@<ref>` form | Match rule | Result |
| --- | --- | --- |
| `@pulse` (provider only) | secrets whose provider/schema == `pulse` | 0 → unfilled; 1 → fill (and print chosen slug); N → `AMBIGUOUS` chooser (value-free) |
| `@pulse/test` (full slug) | exact slug (or `aka`) | 0 → missing; 1 → fill |

- Binding is on the **canonical provider token**, **not** the bare env-var name.
  This is the key correction: matching on `API_KEY` alone would be ambiguous the
  moment two providers both expose `API_KEY`.
- N>1 is a hard `AMBIGUOUS` error with a numbered, value-free chooser
  (slug/schema/tags only), consistent with the existing resolver contract. An
  agent cannot resolve it by guessing.
- Auto-fill is "auto-fill but tell me": the chosen slug is printed.

## 9. First-use admission (one Touch ID, not zero)

A pulled reference file must not silently bind the recipient's real keys — a
cloned/public repo could otherwise declare references for `aws`, `stripe`,
`openai` and harvest them on the next run.

- On first resolve of references not yet admitted to this project, present a
  **single batch-admission box** listing the canonical providers requested
  ("Pulse, Supabase — Admit all"), gated by **one local auth** (Touch ID / OS
  password).
- After admission, resolution is automatic on later runs (no re-auth by
  default), per the existing admission model.
- **Zero-gate auto-binding is explicitly rejected** (it reopens the exfiltration
  vector the sandbox exists to close). This honors invariants 2 and 3.

## 10. Invariants & honest limits

Upheld:

- Value-free reference file (litmus, §7); references not copies; single source
  of truth.
- Strict 0/1/N resolver; never guesses (§8).
- Admission requires human confirmation + local auth (§9).
- Agent-safe surface: only slugs/schemas/field-names/tags/`hasValue` ever
  printed; never a value.
- No server; resolution is local and lazy.

Honest limits (documented, not hidden):

- A shared reference file still requires one admission on first use — "no setup"
  becomes "one Touch ID, once," never truly zero. This is deliberate.
- Cross-person auto-fill only works when both people use the **same canonical
  provider token**. The registry is what makes that agreement reliable; an
  internal service that isn't in any registry must be added to the user/team
  registry first.
- This project shares **references only**. Sharing an actual value to someone
  who lacks the key is Project 2 (the relay) and is out of scope here.

## 11. Out of scope

- The ciphertext-only relay, Key Transparency, TOFU, HPKE value sharing
  (Project 2).
- Multi-device sync and team membership.
- Any hosted / commercial / multi-tenant concern (private, not in this repo).

## 12. Testing strategy (TDD, small increments)

Failing test first for each:

1. **Registry resolution** — provider lookup; merge order project > user >
   built-in; unknown → free-string fallback.
2. **Import identity** — importing in `plugin-manager/` with a `PULSE_API_KEY`
   line yields slug `pulse` (not `plugin-manager`) and a `source:plugin-manager`
   tag. Regression test against the CWD-pollution bug.
3. **Export is value-free** (security-critical) — export output contains only
   `@<ref>` tokens; assert no stored value ever appears.
4. **Reference resolution** — `@pulse` resolves 0/1/N correctly; full-slug
   exact; `AMBIGUOUS` is a value-free chooser.
5. **Batch admission gate** — first resolve of un-admitted references prompts one
   batch box + one auth; later runs do not re-prompt; un-admitted references
   never auto-bind.
6. **E2E round-trip** — import a `.env`, export references, resolve them in a
   fresh HOME that owns its own same-provider secret → correct `.env`, no value
   in the committed file.
