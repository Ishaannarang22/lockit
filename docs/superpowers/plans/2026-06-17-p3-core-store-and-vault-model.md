# Core Store + Sets/Slots Vault Model Implementation Plan (Intended)

> Status: INTENDED — scope-level. Expand into bite-sized failing-test-first TDD steps just-in-time, aligned with the repo state at that time. Plan #1 (docs/superpowers/plans/2026-06-17-p0-scaffold-and-crypto-foundations.md) is the worked example of the target granularity.

**Goal:** Build `packages/core`'s data layer — the encrypted global store of Secrets (typed field-bags keyed by slug), the value-free project vault of Slots, the built-in schema registry, the strict 0/1/N resolver, the per-environment axis, and the gitignored local resolution cache — so secrets are set once and referenced everywhere without ever copying a value.

**Depends on:** Plan #1 (`@kv/crypto` at-rest seal: `sealWithPassphrase` / `openWithPassphrase`, the versioned sealed-blob format). Asymmetric/sharing crypto (Plan #2/#7) is NOT required here. The project-world sandbox + human-gated admission (next plan) builds on top of this layer and is out of scope.

**Packages touched:** `packages/core` (new package, depends on `@kv/crypto`). No CLI, no plugin, no server.

## Scope — what this subsystem builds

- The **global store**: a collection of **Secrets** — typed field-bags `{ slug, schema, aka[], fields[], versions[], tags[], localId }`, where each field is `{ key, type: "env" | "file", hasValue }` plus a sealed value. Persisted **at rest** under a random **DEK** (itself kept wrapped under the passphrase-derived AK — see the DEK-indirection bullet below); opened in memory by unwrapping the DEK.
- **Store keyed by slug, never by env-var name** — so `supabase/acme` and `supabase/blog` can both carry a `SUPABASE_URL` field with zero collision. This is the central invariant the whole layer exists to guarantee structurally.
- The **project vault** (`./.kv/vault.json`): a committed, **value-free** list of **Slots** `{ schema, bind: "pinned" | "open", to: slug | { env: slug } | null, inject: { fieldKey -> ENV_VAR_NAME | ENV_VAR_NAME[] } }`. Read/write as plain JSON — it contains no secret material.
- The **built-in schema registry** (field shapes for known providers, e.g. `openai`, `supabase`, `gcp-service-account`) plus acceptance of **free-string** schemas for unknown providers. Powers completeness checks and field-key/env-var autocomplete; never constrains or blocks storing a Secret.
- The **strict 0/1/N resolver**: maps a slot to a concrete Secret for a selected environment. Exact slug wins for pinned; exactly one schema match resolves (and reports the chosen slug); zero is `MISSING` (pinned) or `OPEN_UNFILLED` (open); N>1 is a structured, **value-free** `AMBIGUOUS` error with a numbered chooser. **Never guesses, no label heuristics.**
- **References, not copies**: slots hold a reference (slug or "any of schema X"), never a value. Single source of truth in the store.
- The **per-environment axis**: an optional secondary axis; a slot's `to` may be a plain slug (same in all contexts) or an env→slug map. The resolver runs per selected environment.
- The **unique-inject-name invariant**: within one vault, the union of all injected env-var names must be unique; a duplicate is a **hard error** at link time (and re-checked at dry-run by a later plan).
- The **local resolution cache** (`./.kv/local.json`, **gitignored**): records how each **open** slot was filled on this machine — **slugs only, never values**. Deleting it simply re-resolves next run.
- **DEK indirection for the unlock model** (see [ADR-0009](../../adr/0009-local-unlock-model.md) and the [unlock-model spec](../specs/2026-06-17-local-unlock-model-design.md)): the store payload is sealed under a **random DEK**, and the DEK is persisted **wrapped under the passphrase-derived AK** via `@kv/crypto.wrapKey` / `unwrapKey` — not sealed directly under the passphrase. This indirection is what lets P4 cache the DEK in a Touch-ID-gated keychain (passphrase once, then fingerprint) and re-key the unlock path without re-encrypting the store.

## Files / modules to create or modify — concrete paths + one-line responsibility

- `packages/core/package.json` — new `@kv/core` workspace package depending on `@kv/crypto`.
- `packages/core/tsconfig.json` — extends `tsconfig.base.json`; `outDir dist`, `rootDir src`.
- `packages/core/src/index.ts` — public API barrel for the core data layer.
- `packages/core/src/model/secret.ts` — `Secret`, `Field`, `Version` types + constructors/validators (slug/schema/field-key shape).
- `packages/core/src/model/slot.ts` — `Slot`, `Bind`, `InjectMap`, env-map `to` types + slot validation.
- `packages/core/src/store/store.ts` — in-memory `GlobalStore`: add/get/list/remove/rename(aka)/rotate/tag, slug-keyed indexing, slug+aka lookup.
- `packages/core/src/store/store-codec.ts` — serialize/deserialize the store's plaintext JSON (the bytes that get sealed); version field for forward-compat.
- `packages/core/src/store/store-persist.ts` — `saveStore`/`loadStore`: seal the codec bytes under a random **DEK** and persist the DEK **wrapped under the passphrase-derived AK** (`@kv/crypto.wrapKey`/`unwrapKey`); the only at-rest path. (Opening by passphrase re-derives AK → unwraps DEK → decrypts; opening by a cached DEK skips the passphrase — see P4.)
- `packages/core/src/vault/vault.ts` — read/write `./.kv/vault.json`; add/remove/list slots; enforce unique-inject-name on mutation.
- `packages/core/src/vault/inject.ts` — normalize an `inject` map to a flat env-var-name set; the unique-inject-name checker (returns structured duplicate error).
- `packages/core/src/schema/registry.ts` — built-in schema registry (provider → expected field shapes), `lookupSchema`, free-string fallback, completeness check.
- `packages/core/src/resolve/resolver.ts` — the strict 0/1/N resolver; per-environment selection; returns a discriminated `Resolution` result.
- `packages/core/src/resolve/errors.ts` — structured resolver outcomes/errors (`Missing`, `OpenUnfilled`, `Ambiguous` with value-free candidate list).
- `packages/core/src/cache/local-cache.ts` — read/write `./.kv/local.json`; record/lookup open-slot fills (slugs only), per environment.
- `packages/core/src/paths.ts` — resolve `./.kv/` paths for vault and local cache; helper to ensure `local.json` is gitignored.
- Colocated `*.test.ts` next to each source module (TDD).

## Key components & responsibilities

**Secret model.** A `Secret` is a typed field-bag. Field values are sealed; the model surface exposes only structure + `hasValue`. Illustrative shapes:

```ts
type FieldType = "env" | "file";
interface Field {
  key: string;
  type: FieldType;
  hasValue: boolean;
}
interface Version {
  id: string;
  current: boolean;
  createdAt: string;
}
interface Secret {
  slug: string; // portable identity, e.g. "supabase/acme"
  schema: string; // registry name or free string
  aka: string[]; // rename-safe aliases
  fields: Field[];
  versions: Version[];
  tags: string[];
  localId?: string; // machine-local only, never committed/portable
}
```

**Global store.** Slug-keyed map with lookup that also consults `aka` (so renamed slugs keep resolving). `rename` moves the old slug into `aka`; `rotate` appends a new current `Version`. Listing output is strictly value-free.

**At-rest persistence.** `store-codec` turns the store (including sealed field values) into deterministic JSON bytes; `store-persist` seals those bytes under a random **DEK** (`@kv/crypto` AEAD) and stores the DEK **wrapped under the passphrase-derived AK** (`wrapKey`/`unwrapKey`). Loading re-derives AK from the passphrase (or reads a cached DEK — see P4), unwraps the DEK, and decrypts. Core never reimplements crypto — it only calls `@kv/crypto` primitives.

**Vault + inject.** The vault is plain committed JSON. `inject.ts` flattens `{ fieldKey -> name | name[] }` to a set of env-var names; on any slot add/update the union across all slots must stay unique, else a structured `DuplicateInjectName` hard error naming the colliding env var.

```ts
type To = string | Record<string, string> | null; // slug | {env: slug} | open
interface Slot {
  schema: string;
  bind: "pinned" | "open";
  to: To;
  inject: Record<string, string | string[]>;
}
```

**Schema registry.** `lookupSchema(name)` returns built-in field shapes or `undefined` (free string). A completeness check reports missing expected fields as advisory only — never blocks.

**Resolver.** Pure function `resolve(slot, store, env?)` returning a discriminated result:

```ts
type Resolution =
  | { kind: "resolved"; slug: string; autoFilled: boolean }
  | { kind: "missing"; wanted: string } // pinned slug absent
  | { kind: "open-unfilled"; schema: string } // open, 0 candidates
  | { kind: "ambiguous"; candidates: { slug: string; schema: string; tags: string[] }[] };
```

Pinned: pick `to` (per-env if `to` is a map) via slug+aka exact match → `resolved` or `missing`. Open: count store Secrets of the slot's schema → 0 `open-unfilled`, 1 `resolved` with `autoFilled: true` (chosen slug surfaced), N `ambiguous` (value-free candidates). The local cache, if it pins an open slot to a still-valid slug, short-circuits to `resolved`.

**Local cache.** Records `{ slot-identity, resolvedTo: slug, env, resolvedAt }`; slugs only. Stale entries (slug no longer in store) are ignored and re-resolved.

## Tests that prove it — emphasizing security properties

- **Store round-trip (at-rest seal):** a store with several Secrets seals via `sealWithPassphrase` and reopens to an identical store with the correct passphrase; the on-disk blob is ciphertext (no field value appears in the bytes) and the **wrong passphrase fails to open** — zero-knowledge at rest.
- **Slug-keyed, no collision:** adding `supabase/acme` and `supabase/blog`, each with a `SUPABASE_URL` field, yields two independent Secrets; reading either returns its own field set with zero cross-talk — collision is impossible by construction.
- **Values never leak into listings:** `list`/`get` output contains only slug, schema, field keys, `type`, `hasValue`, tags — asserted to contain **no field value**, not even masked — the agent-never-sees-a-value property at the model surface.
- **Resolver 0/1/N — pinned:** exact-slug `to` resolves; renamed slug still resolves via `aka`; absent pinned slug returns `missing` (never a guess at a similar slug).
- **Resolver 0/1/N — open:** 0 candidates → `open-unfilled`; exactly 1 → `resolved` with `autoFilled: true` and the chosen slug reported ("auto-fill but tell me"); **N>1 → structured `ambiguous`** whose candidate list carries slug/schema/tags only and **no values** — an agent cannot break the tie by guessing.
- **Duplicate-inject-name hard error:** adding a slot whose inject map (across one-value-many-names and across other slots) repeats an env-var name throws a structured `DuplicateInjectName` naming the offending var — one secret can never silently shadow another.
- **Per-environment selection:** a slot with an env→slug `to` map resolves to different Secrets for `dev` vs `prod`; a plain-string `to` resolves identically across all environments; the 0/1/N rules apply per selected environment.
- **env-type vs file-type field handling:** a `type: "env"` field and a `type: "file"` field both round-trip through store seal/open preserving their `type`; the model distinguishes them so a later plan can inject env values inline vs materialize file contents to a path (no run-time materialization in this plan — only that the distinction is faithfully stored and surfaced).
- **Local cache is value-free and self-healing:** a recorded open-slot fill is slugs-only on disk; deleting the cache forces re-resolution; a cached slug no longer in the store is ignored rather than resolving to a dangling reference.
- **References-not-copies:** rotating a Secret's value in the store changes nothing in any vault file; a slot still references the same slug and resolves to the new current version — single source of truth.

## Out of scope / deferred

- The project-world sandbox, human-gated admission, and local presence auth (next plan).
- `kv run` injection, env materialization, tmpfs file writing, output masking, `--dry-run` (CLI plan) — this plan only stores the env/file distinction, it does not materialize anything.
- All CLI commands and their output formatting; the Claude plugin.
- Asymmetric/envelope/HPKE crypto, signatures, sharing, and bundling (`kv share` / `kv bundle`) — later plans.
- Production Argon2id parameter tuning (flagged in Plan #1).
- The optional self-hosted server and any sync.

## Open questions

- Stable slot identity for cache keying when a vault has multiple open slots of the same schema — synthesize a slot id, or key by `(schema, ordinal)`?
- Where the encrypted global-store blob lives on disk (OS config dir path) and whether per-field DEKs are introduced here or deferred until the key-ladder plan; this plan assumes a single at-rest seal over the whole store.
- Whether `aka` lookups should also apply to open-slot cache entries (a cached fill whose slug was later renamed).
- Exact built-in registry seed list and field shapes beyond `openai` / `supabase` / `gcp-service-account`.
