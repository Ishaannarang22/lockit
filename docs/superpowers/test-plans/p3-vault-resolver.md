# P3: Core Store + Sets/Slots Vault Model — Test Plan

**Phase Status:** NOT YET BUILT — these tests are authored with the feature, ready for TDD implementation.

**Scope:** Unit and integration tests for the encrypted global store of Secrets, value-free project vault of Slots, schema registry, strict 0/1/N resolver, per-environment axis, local resolution cache, and DEK-indirection persistence.

**Test Layers:** Unit (store ops, resolver logic, slot validation, cache) and integration (round-trip seal/open, vault+store coherence).

---

## 1. Secret Model & Types

| Feature              | Behavior to test                                                               | Input / command                                                                                                                                                                                                                                    | Expected output                                                         | Exit code | Test layer |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- | ---------- |
| Secret structure     | Creates Secret with slug, schema, aka[], fields[], versions[], tags[], localId | `new Secret({ slug: "supabase/acme", schema: "supabase", aka: ["sb-acme"], fields: [{ key: "SUPABASE_URL", type: "env", hasValue: true }], versions: [{ id: "v1", current: true, createdAt: "2026-06-18T..." }], tags: ["prod"], localId: "m1" })` | Secret object with all properties correctly set, localId present        | 0         | unit       |
| Field type env       | Secret field with type "env" stores and preserves type                         | `secret.fields[0] = { key: "API_KEY", type: "env", hasValue: true }`                                                                                                                                                                               | field.type === "env" after roundtrip                                    | 0         | unit       |
| Field type file      | Secret field with type "file" stores and preserves type                        | `secret.fields[0] = { key: "SERVICE_ACCOUNT_JSON", type: "file", hasValue: true }`                                                                                                                                                                 | field.type === "file" after roundtrip                                   | 0         | unit       |
| Multiple field types | One Secret can have both env and file fields                                   | `fields: [{ key: "API_URL", type: "env", ... }, { key: "CERT", type: "file", ... }]`                                                                                                                                                               | Both fields present and types preserved                                 | 0         | unit       |
| hasValue flag        | hasValue reflects presence of sealed value                                     | `Field { hasValue: true }` vs `{ hasValue: false }`                                                                                                                                                                                                | Consumers see hasValue without seeing the actual value                  | 0         | unit       |
| Version identity     | Each Version has unique id, createdAt timestamp, current flag                  | `versions: [{ id: "abc123", current: true, createdAt: "2026-06-18T10:00:00Z" }]`                                                                                                                                                                   | Versions list maintains history; only one marked current=true at a time | 0         | unit       |

---

## 2. Slot Model & Validation

| Feature                     | Behavior to test                                              | Input / command                                                                                         | Expected output                                | Exit code | Test layer |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- | ---------- |
| Pinned slot with string to  | Accepts slot with string `to` referencing exact slug          | `{ schema: "openai", bind: "pinned", to: "openai/primary", inject: { "API_KEY": "OPENAI_API_KEY" } }`   | Slot created; to === "openai/primary" (string) | 0         | unit       |
| Open slot with null to      | Accepts slot with null `to` for schema-based matching         | `{ schema: "supabase", bind: "open", to: null, inject: { "URL": "SUPABASE_URL" } }`                     | Slot created; to === null                      | 0         | unit       |
| Env-map to                  | Accepts slot with env→slug map for per-environment resolution | `{ schema: "openai", bind: "pinned", to: { dev: "openai/dev", prod: "openai/prod" }, inject: { ... } }` | Slot created; to is an object with env keys    | 0         | unit       |
| Invalid schema empty string | Rejects slot with empty schema                                | `{ schema: "", bind: "pinned", to: "slug", inject: {} }`                                                | Throws validation error mentioning schema      | 1         | unit       |
| Invalid bind value          | Rejects slot with bind not "pinned" or "open"                 | `{ schema: "openai", bind: "closed", to: "slug", inject: {} }`                                          | Throws error mentioning valid bind values      | 1         | unit       |
| Invalid inject keys         | Rejects slot with non-string inject keys                      | `{ ..., inject: { 123: "VAR_NAME" } }`                                                                  | Throws validation error for inject structure   | 1         | unit       |
| Missing required field      | Rejects slot missing schema                                   | `{ bind: "pinned", to: "slug", inject: {} }`                                                            | Throws error naming missing schema             | 1         | unit       |
| Slot with empty inject      | Accepts slot with empty inject map                            | `{ schema: "openai", bind: "open", to: null, inject: {} }`                                              | Slot created; inject is {}                     | 0         | unit       |

---

## 3. Vault File Operations

| Feature                     | Behavior to test                               | Input / command                                                                                                                 | Expected output                                                | Exit code | Test layer  |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------- | ----------- |
| Create vault on first write | Creates .kv/vault.json when none exists        | `vault.addSlot({ schema: "openai", bind: "pinned", to: "openai/main", inject: { "API_KEY": "OPENAI_API_KEY" } }); vault.save()` | .kv/vault.json created with valid JSON; file contains one slot | 0         | integration |
| Read existing vault         | Loads existing .kv/vault.json                  | Existing .kv/vault.json with 2 slots                                                                                            | `vault.listSlots()` returns array with 2 slots                 | 0         | integration |
| Add slot to vault           | Appends new slot to vault                      | `vault.addSlot(newSlot); vault.save()`                                                                                          | Slot appears in `listSlots()` at end of array                  | 0         | integration |
| Remove slot from vault      | Deletes slot by index or identity              | `vault.removeSlot(0); vault.save()`                                                                                             | Slot gone from `listSlots()`; .kv/vault.json updated           | 0         | integration |
| List all slots              | Returns all slots in order                     | `vault.listSlots()` with 3 slots in vault                                                                                       | Returns array of 3 slots with correct order                    | 0         | unit        |
| Update existing slot        | Modifies slot in-place                         | `vault.updateSlot(0, { ...slot, bind: "open" }); vault.save()`                                                                  | Slot at index 0 updated in memory and persisted                | 0         | integration |
| Preserve slot order         | Slot order maintained across read/write cycles | Save vault with slots [A, B, C], close, reload                                                                                  | `listSlots()` returns [A, B, C] in same order                  | 0         | integration |
| Reject malformed JSON       | Errors when .kv/vault.json is invalid JSON     | .kv/vault.json contains `{ "slots": [unclosed`                                                                                  | Throws parse error or validation error                         | 1         | integration |
| Empty vault on missing file | Returns empty vault when .kv/vault.json absent | No .kv/vault.json file exists                                                                                                   | `vault.listSlots()` returns []                                 | 0         | integration |

---

## 4. Inject Map Normalization & Duplicate Detection

| Feature                                               | Behavior to test                                                 | Input / command                                                              | Expected output                                                               | Exit code | Test layer |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ---------- |
| Flatten single-name mapping                           | Converts `{ fieldKey: "ENV_VAR" }` to set                        | `flattenInject({ "API_KEY": "OPENAI_API_KEY" })`                             | Returns Set containing "OPENAI_API_KEY"                                       | 0         | unit       |
| Flatten one-value-many-names                          | Converts `{ fieldKey: ["VAR1", "VAR2"] }` to set                 | `flattenInject({ "API_KEY": ["KEY", "OPENAI_KEY"] })`                        | Returns Set with both "KEY" and "OPENAI_KEY"                                  | 0         | unit       |
| Handle mixed entries                                  | Processes both string and array inject entries                   | `flattenInject({ "URL": "SUPABASE_URL", "KEY": ["API_KEY", "SECRET_KEY"] })` | Returns Set with all three var names                                          | 0         | unit       |
| Empty inject map                                      | Returns empty set for empty inject                               | `flattenInject({})`                                                          | Returns empty Set                                                             | 0         | unit       |
| Collect across slots                                  | Unions inject names from all vault slots                         | 3 slots with injects; total 5 unique env vars                                | `getAllInjectNames(vault)` returns Set of 5 names                             | 0         | unit       |
| Detect duplicates across slots                        | Reports env-var name repeated in different slots                 | Slot 1: `{ "URL": "SUPABASE_URL" }`, Slot 2: `{ "KEY": "SUPABASE_URL" }`     | `checkDuplicates()` returns `DuplicateInjectName` error naming "SUPABASE_URL" | 0         | unit       |
| Detect duplicates within field                        | Reports same env-var twice in one field's array                  | `{ "KEY": ["OPENAI_API_KEY", "OPENAI_API_KEY"] }`                            | `checkDuplicates()` returns error for duplicate within field                  | 0         | unit       |
| Allow same field in different slots if different vars | Permits `URL` field in 2 slots if they inject different env vars | Slot 1: `{ "URL": "SB_URL" }`, Slot 2: `{ "URL": "PG_URL" }`                 | No error; both slots allowed                                                  | 0         | unit       |

---

## 5. Unique-Inject-Name Invariant Enforcement

| Feature                     | Behavior to test                                                      | Input / command                                                                                                | Expected output                                                                           | Exit code | Test layer  |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- | ----------- |
| Reject duplicate on add     | Rejects addSlot if inject duplicates existing var                     | Vault has slot with `{ "KEY": "OPENAI_API_KEY" }`; add new slot with `{ "API": "OPENAI_API_KEY" }`             | Throws `DuplicateInjectName` error                                                        | 1         | integration |
| Reject duplicate on update  | Rejects updateSlot if new inject duplicates existing var              | Vault has slot with `{ "KEY": "OPENAI_API_KEY" }`; update other slot's inject to `{ "KEY": "OPENAI_API_KEY" }` | Throws `DuplicateInjectName` error                                                        | 1         | integration |
| Structured error report     | DuplicateInjectName includes offending var name and conflicting slots | Duplicate detected on "OPENAI_API_KEY" between slots 0 and 1                                                   | Error includes: `{ varName: "OPENAI_API_KEY", slots: [0, 1], message: "..." }`            | 0         | unit        |
| Error message for human fix | Error describes which env var and which slots conflict                | Same as above                                                                                                  | Error message human-readable, e.g., "Env var 'OPENAI_API_KEY' is already bound in slot 0" | 0         | unit        |
| Cross-vault isolation       | Same env var allowed in different vault files (different projects)    | Project A vault has `OPENAI_API_KEY`, Project B vault has `OPENAI_API_KEY`                                     | Both allowed; invariant is per-vault                                                      | 0         | integration |

---

## 6. Built-in Schema Registry

| Feature                           | Behavior to test                                                   | Input / command                                      | Expected output                                                                                 | Exit code | Test layer  |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------- | ----------- |
| Lookup openai schema              | Registry returns field shapes for openai                           | `lookupSchema("openai")`                             | `{ fields: [{ key: "OPENAI_API_KEY", type: "env" }, ...] }`                                     | 0         | unit        |
| Lookup supabase schema            | Registry returns field shapes for supabase                         | `lookupSchema("supabase")`                           | `{ fields: [{ key: "SUPABASE_URL", type: "env" }, { key: "SUPABASE_KEY", type: "env" }, ...] }` | 0         | unit        |
| Lookup gcp-service-account schema | Registry returns field shapes for GCP                              | `lookupSchema("gcp-service-account")`                | `{ fields: [{ key: "SERVICE_ACCOUNT_JSON", type: "file" }, ...] }`                              | 0         | unit        |
| Unknown schema fallback           | Returns undefined for unknown provider (free string)               | `lookupSchema("custom-provider-xyz")`                | Returns `undefined`                                                                             | 0         | unit        |
| Schema shape includes field keys  | Schema object lists expected field keys                            | `lookupSchema("openai").fields`                      | Array of objects with `.key` property for each field                                            | 0         | unit        |
| Schema shape includes field types | Schema object includes type ("env" or "file") for each field       | `lookupSchema("supabase").fields[0]`                 | Has `.type` property with value "env" or "file"                                                 | 0         | unit        |
| Completeness check advisory only  | Missing fields reported as advisory, not blocking                  | Secret missing an optional field per schema          | `checkCompletion(secret, schema)` returns warnings array; no exception thrown                   | 0         | unit        |
| Completeness never blocks store   | A Secret with fewer fields than schema can be stored               | Schema expects 5 fields; Secret has 3                | Secret added to store successfully                                                              | 0         | integration |
| Case-sensitive lookup             | Schema name lookup is case-sensitive                               | `lookupSchema("OpenAI")` vs `lookupSchema("openai")` | "OpenAI" returns undefined; "openai" returns schema                                             | 0         | unit        |
| Registry seed includes built-ins  | Registry at minimum includes openai, supabase, gcp-service-account | `Object.keys(registry.all()).length >= 3`            | At least 3 built-in schemas present                                                             | 0         | unit        |

---

## 7. Strict 0/1/N Resolver — Pinned Slots

| Feature                          | Behavior to test                                  | Input / command                                                                           | Expected output                                                                          | Exit code | Test layer |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- | ---------- |
| Exact slug resolution            | Resolves pinned slot with exact slug match        | Slot: `{ to: "openai/prod" }`; Store has `openai/prod`                                    | `resolve()` returns `{ kind: "resolved", slug: "openai/prod", autoFilled: false }`       | 0         | unit       |
| Resolved includes slug           | Resolved result surfaced with slug for visibility | Resolve pinned slot                                                                       | Result has `.slug` field showing which secret was chosen                                 | 0         | unit       |
| Resolve via aka alias            | Renamed slot resolves through aka list            | Store has secret with slug "openai/primary", aka: ["openai/old"]; Slot to: "openai/old"   | `resolve()` returns `{ kind: "resolved", slug: "openai/primary", ... }` (canonical slug) | 0         | unit       |
| Missing pinned slug              | Returns missing when pinned slug not in store     | Slot to: "openai/backup"; Store lacks "openai/backup" (even with similar slugs)           | `resolve()` returns `{ kind: "missing", wanted: "openai/backup" }`                       | 0         | unit       |
| Never guess similar slug         | Does not resolve to similar-named slug            | Slot to: "openai/prod"; Store has "openai/product" and "openai/pro" but not "openai/prod" | Returns `missing`, not a guess                                                           | 0         | unit       |
| Per-environment pinned           | Env-map to resolves per-env                       | Slot to: `{ dev: "openai/dev", prod: "openai/prod" }` resolver called with env="dev"      | Returns resolved to "openai/dev"                                                         | 0         | unit       |
| Per-environment wrong env in map | Falls through to missing if env not in to map     | Slot to: `{ dev: "openai/dev" }`, resolver called with env="staging"                      | Returns missing (staging not in map)                                                     | 0         | unit       |
| Resolved never includes values   | Resolved result contains no secret field values   | Resolved pinned slot                                                                      | Result has slug, schema, tags only; no field values present                              | 0         | unit       |

---

## 8. Strict 0/1/N Resolver — Open Slots

| Feature                             | Behavior to test                                                             | Input / command                                                                         | Expected output                                                                                         | Exit code | Test layer |
| ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| Zero candidates → open-unfilled     | Open slot with no matching schema returns open-unfilled                      | Slot: `{ schema: "stripe", bind: "open", to: null }`; Store empty                       | `resolve()` returns `{ kind: "open-unfilled", schema: "stripe" }`                                       | 0         | unit       |
| Exactly one candidate → auto-filled | Exactly one secret of matching schema returns resolved with autoFilled: true | Slot: `{ schema: "openai", bind: "open", to: null }`; Store has one openai secret       | `resolve()` returns `{ kind: "resolved", slug: "openai/main", autoFilled: true }`                       | 0         | unit       |
| Auto-fill reports chosen slug       | Resolved open slot includes the slug that was auto-filled                    | Auto-fill scenario                                                                      | Result `.slug` field shows which slug was chosen                                                        | 0         | unit       |
| N > 1 candidates → ambiguous        | Multiple secrets of matching schema returns ambiguous                        | Slot: `{ schema: "openai", bind: "open" }`; Store has "openai/main" and "openai/backup" | `resolve()` returns `{ kind: "ambiguous", candidates: [...] }`                                          | 0         | unit       |
| Ambiguous candidate list value-free | Candidates list includes slug, schema, tags only; no values                  | Ambiguous result with 3 candidates                                                      | Each candidate is `{ slug, schema, tags }` with no field values                                         | 0         | unit       |
| Ambiguous candidates numbered       | Candidate list allows user numbering for chooser                             | Ambiguous with 3 candidates                                                             | Candidates are in stable order; can be presented as [0] openai/main, [1] openai/backup, [2] openai/test | 0         | unit       |

---

## 9. Resolver Discriminated Result Types

| Feature                       | Behavior to test                                                       | Input / command                                                                     | Expected output                                                       | Exit code | Test layer |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------- | ---------- |
| Resolved kind discrimination  | Result with kind: "resolved" can be pattern-matched                    | `const res = resolve(...); if (res.kind === "resolved") { const slug = res.slug; }` | TypeScript narrows to resolved type; .slug and .autoFilled accessible | 0         | unit       |
| Missing kind discrimination   | Result with kind: "missing" can be pattern-matched                     | `if (res.kind === "missing") { const wanted = res.wanted; }`                        | TypeScript narrows to missing type; .wanted accessible                | 0         | unit       |
| Missing includes wanted slug  | missing result has wanted field                                        | Missing result                                                                      | `.wanted` contains the slug that was not found                        | 0         | unit       |
| Open-unfilled discrimination  | Result with kind: "open-unfilled" can be pattern-matched               | `if (res.kind === "open-unfilled") { const schema = res.schema; }`                  | TypeScript narrows; .schema accessible                                | 0         | unit       |
| Open-unfilled includes schema | open-unfilled result has schema field                                  | Open-unfilled result                                                                | `.schema` contains the schema name with no candidates                 | 0         | unit       |
| Ambiguous discrimination      | Result with kind: "ambiguous" can be pattern-matched                   | `if (res.kind === "ambiguous") { const candidates = res.candidates; }`              | TypeScript narrows to ambiguous type; .candidates accessible          | 0         | unit       |
| Ambiguous includes candidates | ambiguous result has candidates array                                  | Ambiguous result                                                                    | `.candidates` is array of `{ slug, schema, tags }`                    | 0         | unit       |
| No exceptions thrown          | All outcomes are success results (discriminated union, not exceptions) | Call resolve() with any slot/store combo                                            | No exception thrown; always returns discriminated result              | 0         | unit       |

---

## 10. Per-Environment Resolution Axis

| Feature                                  | Behavior to test                                                | Input / command                                                                          | Expected output                                                        | Exit code | Test layer |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------- | ---------- |
| String to same in all envs               | Slot with string to behaves identically across environments     | Slot to: "openai/primary"; resolve with env="dev" and env="prod"                         | Both resolve to same slug                                              | 0         | unit       |
| Env-map to different per env             | Slot with env→slug map resolves to different slugs per env      | Slot to: `{ dev: "openai/dev", prod: "openai/prod" }`                                    | resolve(env="dev") → "openai/dev", resolve(env="prod") → "openai/prod" | 0         | unit       |
| Env parameter required for env-map       | Missing env parameter when slot has env-map to                  | Slot to: `{ dev: "...", prod: "..." }`, call resolve without env                         | Throws error or assumes default environment                            | 1         | unit       |
| Default env to dev                       | If env parameter not provided, defaults to "dev"                | Slot to: "slug", resolve() called without env                                            | Resolves as if env="dev" was passed                                    | 0         | unit       |
| Per-env 0/1/N independent                | Each environment has independent 0/1/N resolution               | Slot schema "openai", open. env="dev" has 1 secret, env="prod" has 2 secrets             | dev → resolved, prod → ambiguous (per-env analysis)                    | 0         | unit       |
| Ambiguous in one env resolved in another | Different outcomes per environment                              | Slot schema "stripe", open. dev has 1 stripe secret, prod has 0                          | dev → resolved, prod → open-unfilled                                   | 0         | unit       |
| Missing in prod resolved in dev          | Pinned slot to env-map might resolve in dev but missing in prod | Slot to: `{ dev: "openai/dev", prod: "openai/prod" }`; Store has dev but not prod secret | dev → resolved, prod → missing                                         | 0         | unit       |
| Per-env selection optional               | Caller may provide env or not; defaults gracefully              | `resolve(slot, store)` vs `resolve(slot, store, "prod")`                                 | Both work; default to "dev" when env omitted                           | 0         | unit       |

---

## 11. Local Resolution Cache

| Feature                            | Behavior to test                                                     | Input / command                                                                                                  | Expected output                                                                                            | Exit code | Test layer  |
| ---------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| Create cache on first write        | Creates .kv/local.json when none exists                              | `cache.recordFill({ slot, schema: "openai", slug: "openai/main", env: "dev", resolvedAt: "..." }); cache.save()` | .kv/local.json created with valid JSON                                                                     | 0         | integration |
| Read existing cache                | Loads existing .kv/local.json                                        | .kv/local.json exists with 1 cache entry                                                                         | `cache.listEntries()` returns array with 1 entry                                                           | 0         | integration |
| Record open-slot fill              | Cache records schema, slug, env, resolvedAt (no value)               | Record fill for open slot resolving to "openai/main" in "dev" env                                                | Cache entry: `{ slotId, schema: "openai", slug: "openai/main", env: "dev", resolvedAt: "2026-06-18T..." }` | 0         | integration |
| Cache records slugs only           | No field values stored in .kv/local.json                             | Record fill with secret containing field values                                                                  | Cache contains slug only; no field values on disk                                                          | 0         | integration |
| Return cached resolution           | Caching same slot+env returns previous fill without re-resolving     | Record A then query cache for same slot+env                                                                      | Returns cached entry with same slug                                                                        | 0         | integration |
| Delete cache entry on slot removal | When slot removed from vault, its cache entry is deleted/invalidated | Remove slot 0 from vault                                                                                         | Cache no longer has entry for slot 0                                                                       | 0         | integration |
| Update cache on re-fill            | Requesting re-fill for same slot+env updates resolvedAt              | Initial fill at T1; re-fill at T2                                                                                | `resolvedAt` updated to T2                                                                                 | 0         | integration |
| Reject malformed cache JSON        | Errors when .kv/local.json is invalid JSON                           | .kv/local.json contains `{ "entries": [unclosed`                                                                 | Throws parse error                                                                                         | 1         | integration |

---

## 12. Local Cache Self-Healing & Stale Entries

| Feature                           | Behavior to test                                                              | Input / command                                                                                     | Expected output                                                   | Exit code | Test layer  |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------- | ----------- |
| Ignore stale cached slug          | If cached slug no longer in store, entry is ignored (not used)                | Cache has entry: slug "openai/old"; Store no longer has "openai/old"                                | Cache miss (no error); re-resolves                                | 0         | unit        |
| Treat stale as miss               | Stale cache entry acts like cache miss, not error                             | Same as above                                                                                       | Triggers re-resolution; returns re-resolved result                | 0         | unit        |
| Re-resolve on stale               | When slug deleted from store, cached entry for it doesn't block re-resolution | Remove "openai/old" from store; resolve slot that was cached to "openai/old"                        | Resolver re-runs and resolves to new slug or missing              | 0         | unit        |
| Lazy stale cleanup                | Stale entry not deleted from disk immediately                                 | Cache entry for deleted slug remains in .kv/local.json after load                                   | Entry stays until next explicit cleanup or expiry                 | 0         | integration |
| Aka still resolves cached entries | Old alias (aka) can still resolve cached entry for renamed secret             | Secret renamed from "openai/old" to "openai/primary" (old in aka); cache has entry for "openai/old" | Cache lookup via aka returns entry; resolver picks canonical slug | 0         | integration |

---

## 13. Slot Lookup with Aka Resolution

| Feature                          | Behavior to test                                                 | Input / command                                                                             | Expected output                                                      | Exit code | Test layer  |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------- | ----------- |
| Lookup by primary slug           | Store.get(slug) returns secret by primary slug                   | `store.get("openai/primary")`                                                               | Returns secret with slug "openai/primary"                            | 0         | unit        |
| Lookup by aka alias              | Store.get(aka) returns same secret as primary slug               | Secret with slug "openai/primary", aka: ["openai/old"]; `store.get("openai/old")`           | Returns same secret (canonical slug "openai/primary")                | 0         | unit        |
| Rename adds to aka               | Renaming secret moves old slug to aka                            | `store.rename("openai/primary", "openai/main")`                                             | Secret now slug: "openai/main", aka: ["openai/primary"]              | 0         | unit        |
| Lookup fails if never existed    | Store.get(nonexistent) returns undefined or throws               | `store.get("nonexistent")`                                                                  | Returns undefined or throws NotFound                                 | 0         | unit        |
| Aka applies to pinned resolution | Pinned slot resolves via aka alias                               | Slot to: "openai/old"; Secret renamed to "openai/primary" with aka: ["openai/old"]          | Pinned resolver matches via aka; returns canonical "openai/primary"  | 0         | unit        |
| Aka applies to open cache        | Open slot cache entry references old slug which has been renamed | Cache entry slug: "openai/old"; Secret renamed to "openai/primary" with aka: ["openai/old"] | Cache lookup finds renamed secret via aka                            | 0         | integration |
| Aka history accumulated          | Multiple renames build up aka list                               | Rename "openai/primary" → "openai/main" → "openai/prod"                                     | Final aka includes both old names: ["openai/primary", "openai/main"] | 0         | unit        |

---

## 14. Secret Rotation with Versions

| Feature                           | Behavior to test                                             | Input / command                                                           | Expected output                                             | Exit code | Test layer  |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------- | --------- | ----------- |
| Rotate creates new version        | Rotation creates new Version with unique id and current=true | `store.rotate(slug, newValue)`                                            | New version in versions array with unique .id, current=true | 0         | unit        |
| Rotate marks old current false    | Previous version has current set to false                    | Rotate existing secret                                                    | Old version current=false; new version current=true         | 0         | unit        |
| Rotate marks new current          | New version set to current=true                              | Rotate                                                                    | New version .current === true                               | 0         | unit        |
| Consumers resolve current version | Resolver and slots resolve to current version by default     | Secret has 2 versions (old current=false, new current=true)               | Injection/resolution uses current version (newest)          | 0         | integration |
| Versions ordered by createdAt     | Version list maintains chronological order                   | Multiple rotations over time                                              | versions array sorted ascending by createdAt                | 0         | unit        |
| Rotation preserves schema         | Rotating does not change schema                              | Rotate "openai/primary"                                                   | Secret schema unchanged                                     | 0         | unit        |
| Rotation preserves field keys     | Field keys remain same across rotation                       | Secret has fields ["OPENAI_API_KEY", "OPENAI_ORG"]; rotate with new value | Fields array unchanged                                      | 0         | unit        |
| Rotation doesn't update vault     | Rotating secret in store is not reflected in vault.json      | Rotate secret; vault still references same slug                           | vault.json unchanged; slot reference still valid            | 0         | integration |

---

## 15. Secret Tagging

| Feature                   | Behavior to test                                   | Input / command                                                       | Expected output                                    | Exit code | Test layer  |
| ------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | --------- | ----------- |
| Add tag to secret         | Adds tag to secret's tags array                    | `store.addTag(slug, "production")`                                    | Secret.tags includes "production"                  | 0         | unit        |
| Remove tag from secret    | Removes tag from secret's tags array               | `store.removeTag(slug, "staging")`                                    | "staging" no longer in Secret.tags                 | 0         | unit        |
| List by tag               | Lists all secrets with a specific tag              | `store.listByTag("production")`                                       | Returns array of secrets with "production" in tags | 0         | unit        |
| Multiple tags per secret  | One secret can have multiple tags                  | Secret.tags = ["prod", "external", "api"]                             | All three tags present                             | 0         | unit        |
| Duplicate tags idempotent | Adding same tag twice has no duplicate effect      | `addTag(slug, "prod"); addTag(slug, "prod")`                          | tags = ["prod"], not ["prod", "prod"]              | 0         | unit        |
| Tags in ambiguous list    | Ambiguous resolution candidates include tags       | Ambiguous result with 3 candidates                                    | Each candidate has `.tags` array                   | 0         | unit        |
| Tags help disambiguate    | Human uses tags to pick among ambiguous candidates | Ambiguous: [openai/dev "dev", openai/prod "prod"]; human picks by tag | Tags displayed to user for clear choice            | 0         | integration |

---

## 16. Store Round-Trip Seal/Decrypt

| Feature                                    | Behavior to test                                                         | Input / command                                                                        | Expected output                                                               | Exit code | Test layer  |
| ------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ----------- |
| Multiple secrets seal and open identically | Store with 3 secrets seals via passphrase and reopens to identical store | Create store with 3 secrets; seal with passphrase "correct"; open with same passphrase | Reopened store equals original (all slugs, fields, values, tags match)        | 0         | integration |
| Correct passphrase opens successfully      | Sealed store opens with correct passphrase                               | `store.seal(passphrase)` then `store.open(sealedBlob, passphrase)`                     | Opens successfully; store restored                                            | 0         | integration |
| Wrong passphrase fails with error          | Sealed store rejects wrong passphrase                                    | Sealed with "correct"; try open with "wrong"                                           | Throws decryption error (not silent failure); message mentions passphrase     | 1         | integration |
| Ciphertext has no readable field values    | On-disk sealed blob contains no plaintext field values                   | Examine sealed blob bytes                                                              | No field value strings appear in ciphertext (search for API keys, URLs, etc.) | 0         | integration |
| Opened store preserves all field values    | All field values round-trip correctly                                    | Store with 3 secrets, various field values; seal/open                                  | Each field value restored byte-for-byte                                       | 0         | integration |
| Opened store preserves versions            | All versions round-trip with correct current flag                        | Secret with 2 versions (v1 old, v2 current)                                            | Reopened secret has same 2 versions with same current flags                   | 0         | integration |
| Opened store preserves tags                | All tags round-trip                                                      | Secret with tags ["prod", "external"]                                                  | Reopened secret has same tags                                                 | 0         | integration |

---

## 17. Slug-Keyed Collision-Free Storage

| Feature                         | Behavior to test                                        | Input / command                                                                                                               | Expected output                                                           | Exit code | Test layer |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- | ---------- |
| Store supabase/acme separately  | supabase/acme and supabase/blog both store SUPABASE_URL | Store: supabase/acme with SUPABASE_URL="https://acme.supabase.co", supabase/blog with SUPABASE_URL="https://blog.supabase.co" | Both stored without collision                                             | 0         | unit       |
| Read supabase/acme only         | Reading supabase/acme returns only its SUPABASE_URL     | `store.get("supabase/acme").fields.find(f => f.key === "SUPABASE_URL")`                                                       | Returns acme's URL value, not blog's                                      | 0         | unit       |
| Read supabase/blog only         | Reading supabase/blog returns only its SUPABASE_URL     | `store.get("supabase/blog").fields.find(f => f.key === "SUPABASE_URL")`                                                       | Returns blog's URL value, not acme's                                      | 0         | unit       |
| Field collision impossible      | Cannot have cross-slug field collision by design        | Attempt to resolve SUPABASE_URL without specifying slug                                                                       | Field key alone is ambiguous (0/1/N); must specify slug or schema+context | 0         | unit       |
| Store indexed by slug not field | Store internal index is by slug, not field key          | Store structure                                                                                                               | Lookup is O(1) on slug; field keys are local to Secret                    | 0         | unit       |

---

## 18. Values Never Leak in Listings

| Feature                              | Behavior to test                               | Input / command                                       | Expected output                                                         | Exit code | Test layer |
| ------------------------------------ | ---------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- | --------- | ---------- |
| List output contains slug only       | `store.list()` output includes slug            | `store.list()` with 2 secrets                         | Each entry has `.slug` field                                            | 0         | unit       |
| List output contains schema only     | `store.list()` output includes schema          | Store.list()                                          | Each entry has `.schema` field                                          | 0         | unit       |
| List output contains field keys only | `store.list()` output includes field key names | `store.list()`                                        | Each entry has `.fields` with `.key` only (no values)                   | 0         | unit       |
| List output contains field type only | `store.list()` output includes field type      | `store.list()`                                        | Each entry fields include `.type` ("env" or "file")                     | 0         | unit       |
| List output contains hasValue only   | `store.list()` output includes hasValue flag   | `store.list()`                                        | Each entry fields include `.hasValue`                                   | 0         | unit       |
| List output contains tags            | `store.list()` output includes tags            | `store.list()`                                        | Each entry has `.tags` array                                            | 0         | unit       |
| List never contains field values     | Field values never appear in listing output    | `store.list()` with secrets containing API keys, URLs | No API keys, URLs, or sensitive values in output; agent never sees them | 0         | unit       |
| List never masks values              | No masked strings like [REDACTED] or \*\*\*    | `store.list()`                                        | Output never contains masking placeholders                              | 0         | unit       |
| Ambiguous candidate list value-free  | Resolver ambiguous result has no values        | Ambiguous resolution                                  | Candidates list has slug, schema, tags only                             | 0         | unit       |

---

## 19. References Not Copies Invariant

| Feature                                | Behavior to test                                                            | Input / command                                                                     | Expected output                                               | Exit code | Test layer  |
| -------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- | ----------- |
| Slot stores reference                  | Slot to field holds reference (slug or schema), not a copy of value         | Slot: `{ to: "supabase/acme", ... }`                                                | Slot stores string "supabase/acme", not a copy of secret data | 0         | unit        |
| Rotating secret not reflected in vault | Rotating a secret's value in store doesn't change vault.json                | Secret "supabase/acme" rotated in store; vault has slot referencing "supabase/acme" | vault.json unchanged; file still references same slug         | 0         | integration |
| All slots pick up new version          | All projects/slots referencing a slug resolve to new version after rotation | Slot A and Slot B both to "supabase/acme"; rotate secret                            | Both slots resolve to same new current version                | 0         | integration |
| Value change picked up next run        | Rotating a secret means all slots get the new value on next injection       | Secret rotated; `kv run` re-executes                                                | Injected env vars reflect new rotated value                   | 0         | integration |
| Single source of truth                 | Store is sole authoritative copy; slots are references only                 | Change secret in store                                                              | No vault duplication; all references resolve to single source | 0         | unit        |

---

## 20. DEK Indirection for Unlock Model

| Feature                                   | Behavior to test                                                                                   | Input / command                                          | Expected output                                                                   | Exit code | Test layer  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- | ----------- |
| Store payload sealed under random DEK     | Store plaintext JSON is encrypted with random 32-byte DEK (not passphrase directly)                | `store.seal(passphrase)`                                 | Store ciphertext is sealed under DEK; DEK is random (not derived from passphrase) | 0         | integration |
| DEK wrapped under passphrase-derived AK   | Random DEK is wrapped (key-encrypted) under AK derived from passphrase                             | `store.seal(passphrase)`                                 | On disk: wrapped(DEK under AK) + sealed(store under DEK)                          | 0         | integration |
| DEK persisted wrapped                     | Wrapped DEK stored alongside store payload                                                         | Examine sealed blob format                               | Blob contains wrapped DEK bytes and store ciphertext                              | 0         | integration |
| Load by passphrase derives AK and unwraps | Loading by passphrase re-derives AK from passphrase, unwraps DEK, decrypts store                   | `store.open(blob, passphrase)`                           | Passphrase → derive AK → unwrap DEK → decrypt store → success                     | 0         | integration |
| Load by cached DEK skips passphrase       | P4 feature: if DEK cached in keychain, can open store without entering passphrase                  | Mock cached DEK; call `store.open(blob, cachedDEK: DEK)` | Opens successfully without passphrase; fingerprint/Touch ID auth used             | 0         | integration |
| DEK rotation without re-encrypting store  | Rotating DEK (unwrap old DEK, generate new DEK, re-wrap new DEK) does not re-encrypt store payload | `store.rotateDEK(oldDEK, newPassphrase)`                 | Old store ciphertext remains unchanged; only wrapped DEK bytes change             | 0         | integration |
| New DEK generated on each save            | Each seal operation generates a fresh random DEK (not reused)                                      | Seal store twice with same content and passphrase        | Two saved blobs have different DEK bytes (different randomness)                   | 0         | integration |

---

## 21. Env-Type Field Handling

| Feature                                  | Behavior to test                                                         | Input / command                                                                     | Expected output                                    | Exit code | Test layer  |
| ---------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------- | --------- | ----------- |
| Env-type field stores string             | An env-type field in a Secret stores a string value (e.g., API key, URL) | Field: `{ key: "OPENAI_API_KEY", type: "env", hasValue: true }` with value "sk-..." | Value stored as string; can be injected as env var | 0         | unit        |
| Env-type preserves type across seal/open | Env-type field type is not changed by seal/open round-trip               | Seal/open secret with env-type field                                                | Reopened field has type: "env" (not "file")        | 0         | integration |
| Env-type hasValue reflects presence      | hasValue flag for env field reflects whether value is set                | `{ type: "env", hasValue: true }` vs `{ type: "env", hasValue: false }`             | Agent sees hasValue; cannot see actual value       | 0         | unit        |
| Multiple env-type fields in one secret   | One Secret can have multiple env-type fields                             | Secret with fields: [API_KEY, ORG_ID, BASE_URL] all type="env"                      | All stored and retrieved independently             | 0         | unit        |

---

## 22. File-Type Field Handling

| Feature                                     | Behavior to test                                                                   | Input / command                                                                                       | Expected output                                                     | Exit code | Test layer  |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- | ----------- |
| File-type field stores content              | A file-type field stores content value (e.g., JSON config, certificate)            | Field: `{ key: "SERVICE_ACCOUNT_JSON", type: "file", hasValue: true }` with value "{ \"type\": \"..." | Content stored (bytes or string); can be materialized to file later | 0         | unit        |
| File-type preserves type across seal/open   | File-type field type is not changed by seal/open round-trip                        | Seal/open secret with file-type field                                                                 | Reopened field has type: "file" (not "env")                         | 0         | integration |
| File-type hasValue reflects presence        | hasValue flag for file field reflects whether content is set                       | `{ type: "file", hasValue: true }` vs `{ type: "file", hasValue: false }`                             | Agent sees hasValue; cannot see actual content                      | 0         | unit        |
| GCP-service-account schema recognizes file  | Schema registry for gcp-service-account includes SERVICE_ACCOUNT_JSON as file-type | `lookupSchema("gcp-service-account").fields`                                                          | Includes field { key: "SERVICE_ACCOUNT_JSON", type: "file" }        | 0         | unit        |
| Env and file-type coexist                   | One Secret can have both env-type and file-type fields                             | Secret with fields: [SERVICE_ACCOUNT_JSON (file), GCP_PROJECT_ID (env)]                               | Both stored; types preserved across seal/open                       | 0         | integration |
| File-type fields not materialized this plan | P3 stores file fields but does not materialize to tmpfs (that's P4 + CLI)          | Secret with file-type field; store and retrieve                                                       | Field stored and retrieved; no tmpfs file written by core layer     | 0         | unit        |

---

## Summary

**Total Behaviors to Test:** 164 across 22 features

**Coverage by Test Layer:**

- **Unit tests (~110 behaviors):** Slot validation, schema registry, resolver logic, inject flattening, discriminated results, cache self-healing, slug lookup, tagging, listing output, DEK indirection logic
- **Integration tests (~54 behaviors):** Vault file I/O, store seal/open round-trips, cache persistence, per-environment resolution, reference tracking, version rotation

**Critical Security Properties to Verify:**

1. Field values never leak into agent-visible output (invariant #1 in CLAUDE.md)
2. No field values appear in on-disk ciphertext (zero-knowledge at rest)
3. Wrong passphrase definitively fails (authentication integrity)
4. Slug-keyed collision-free storage (core data model invariant)
5. References not copies (single source of truth)
6. Unique inject names (no silent shadowing across slots)
7. Strict 0/1/N resolver (no guessing; ambiguity is explicit)

**Open Questions / Deferred:**

- Exact stable slot identity for cache keying (synthesized slot id vs. ordinal)
- Disk location of encrypted global store blob (OS config dir path TBD)
- Per-field DEKs vs. single DEK (deferred to later key-ladder plan)
- Aka lookups in open-slot cache entries (covered here, confirmed resolvable)
