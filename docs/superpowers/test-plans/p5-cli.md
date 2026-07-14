# P5 CLI Test Plan

> **Phase status:** Not yet built. This document defines the exhaustive test suite that will be authored just-in-time as P5 is implemented, following the project's test-driven development discipline.

**Phase scope:** Build the `lockit` binary — the universal command surface over `@lockit/core` that lets humans and agents add, organize, link, resolve, and inject secrets, where every agent-facing output is value-free and no secret value ever passes through argv, output, or an agent's context.

**Test layers:** Unit tests (IO seams, renderers, error mappings) and integration tests (spawning the real compiled binary in isolated temp directories with controlled stdio).

**Key invariants tested:**

1. Values never come from argv (shell history safe)
2. Values never appear in output (agent-safe)
3. Resolution is strict 0/1/N (never guesses)
4. Sandbox admission is gated by human auth
5. Unique inject-name invariant enforced at link time
6. Exit codes are stable and scriptable

---

## Secret Commands

### Feature: `secret add` / `secret set`

| Behavior to test                                      | Input / command                                                                            | Expected output                                                               | Exit code | Test layer          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------- | ------------------- |
| Creates a new secret with single field                | `echo "sk-123456" \| lockit secret add openai/dev OPENAI_API_KEY`                              | `Secret added: openai/dev (openai)` or similar confirmation (value-free)      | 0         | integration         |
| Creates a new secret with multiple fields             | Prompt sequence for `lockit secret add supabase/prod`: project_url, anon_key, service_role_key | Confirmation listing schema + field keys (no values)                          | 0         | integration         |
| Rejects value supplied via argv                       | `lockit secret add openai/dev OPENAI_API_KEY=sk-123456`                                        | Error message: "secret values must be provided via prompt or stdin, not argv" | 1         | integration         |
| Rejects `--no-input` without stdin                    | `lockit secret add openai/dev OPENAI_API_KEY --no-input < /dev/null`                           | Error: "no input mode requires a value on stdin"                              | 1         | integration         |
| Correctly reads value from stdin in `--no-input` mode | `echo "sk-test" \| lockit secret add test/api MY_KEY --no-input`                               | Confirmation, no echoing of "sk-test" in output                               | 0         | integration         |
| Updates an existing secret (replaces all fields)      | After adding openai/dev, `echo "sk-new" \| lockit secret set openai/dev OPENAI_API_KEY`        | Confirmation of update; `version` incremented in metadata                     | 0         | integration         |
| Rejects creation with empty slug                      | `echo "value" \| lockit secret add "" API_KEY`                                                 | Error: "slug is required and must be non-empty"                               | 1         | unit                |
| Rejects creation with invalid schema inference        | `echo "value" \| lockit secret add myslug/key MYKEY` and schema is unknown                     | Either auto-accepts unknown schema or prompts for schema confirmation         | 0 or 2    | unit                |
| Prompts for hidden input when TTY (not piped)         | Simulate TTY input: `lockit secret add test/key MY_KEY` with terminal interaction              | Prompt appears, value not echoed to stdout/stderr                             | 0         | unit (with IO mock) |
| Stores value encrypted in vault                       | After `secret add openai/dev`, verify value is not readable as plaintext                   | `lockit ls openai/dev --json` shows `hasValue: true`, not the value itself        | 0         | integration         |
| Records timestamp and version metadata                | After add, metadata includes `createdAt`, `version`                                        | Metadata is present and parseable                                             | 0         | integration         |

---

### Feature: `secret ls`

| Behavior to test                            | Input / command                                                             | Expected output                                                                                                                | Exit code | Test layer  |
| ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------- |
| Lists all secrets value-free                | After adding openai/dev and supabase/prod, `lockit secret ls`                   | Output shows: `openai/dev (openai)`, `supabase/prod (supabase)` with field keys and `hasValue: true`, no values                | 0         | integration |
| Lists secrets in `--json` format value-free | `lockit secret ls --json`                                                       | Valid JSON with `secrets[]` array; each secret has slug, schema, fields[]{key, type, hasValue}, tags, version; no field values | 0         | integration |
| Filters by schema                           | After adding openai/dev and supabase/prod, `lockit secret ls --schema supabase` | Output includes only supabase/prod                                                                                             | 0         | integration |
| Filters by tag                              | After adding secrets with tags, `lockit secret ls --tag prod`                   | Output includes only secrets tagged `prod`                                                                                     | 0         | integration |
| Combined schema + tag filter                | `lockit secret ls --schema openai --tag dev`                                    | Output intersects both filters                                                                                                 | 0         | integration |
| Empty result for no matches                 | `lockit secret ls --schema nonexistent`                                         | Output: "no secrets found" or similar (empty list in `--json`)                                                                 | 0         | integration |
| Returns zero with empty store               | On a fresh vault, `lockit secret ls`                                            | Output: "no secrets found" or empty list                                                                                       | 0         | integration |

---

### Feature: `secret rotate`

| Behavior to test                                   | Input / command                                                                                    | Expected output                                            | Exit code | Test layer  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------- | ----------- |
| Rotates a singleton secret's value                 | After adding openai/dev with sk-123, `echo "sk-456" \| lockit secret rotate openai/dev OPENAI_API_KEY` | Confirmation shows version incremented, no value in output | 0         | integration |
| Rotates a multi-field secret (one field at a time) | For supabase/prod, `echo "new_key" \| lockit secret rotate supabase/prod SUPABASE_ANON_KEY`            | Confirms the one field rotated; other fields unchanged     | 0         | integration |
| Rejects rotation of non-existent secret            | `echo "value" \| lockit secret rotate nonexistent/key MY_KEY`                                          | Error: "secret not found: nonexistent/key"                 | 1         | integration |
| Rejects rotation of non-existent field             | For openai/dev (OPENAI_API_KEY), `echo "v" \| lockit secret rotate openai/dev WRONG_FIELD`             | Error: "field WRONG_FIELD not found in schema openai"      | 1         | integration |
| Value not echoed in output                         | Rotate openai/dev, `lockit secret ls` output does not contain the new rotated value                    | Output only shows `hasValue: true`                         | 0         | integration |

---

### Feature: `secret rename`

| Behavior to test                      | Input / command                                                                             | Expected output                                          | Exit code | Test layer  |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------- | ----------- |
| Renames a secret slug                 | After adding openai/dev, `lockit secret rename openai/dev openai/production`                    | Confirmation; old slug in `aka` list                     | 0         | integration |
| Old slug resolves through `aka`       | After renaming openai/dev → openai/production, a slot pinned to `openai/dev` still resolves | `lockit status` shows the slot resolved to openai/production | 0         | integration |
| Rejects rename to an existing slug    | After adding openai/dev and openai/prod, `lockit secret rename openai/dev openai/prod`          | Error: "slug already exists"                             | 1         | integration |
| Rejects rename of non-existent secret | `lockit secret rename nonexistent/key new/key`                                                  | Error: "secret not found"                                | 1         | integration |
| Records multiple renames in `aka`     | Rename openai/dev → openai/v1, then openai/v1 → openai/final                                | `aka` list contains both old slugs                       | 0         | integration |

---

### Feature: `secret rm`

| Behavior to test                         | Input / command                                                                                     | Expected output                                                        | Exit code | Test layer                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------- | --------------------------- |
| Removes a secret with `--yes` flag       | After adding openai/dev, `lockit secret rm openai/dev --yes`                                            | Confirmation: "secret removed: openai/dev"; `lockit ls` no longer lists it | 0         | integration                 |
| Prompts for confirmation without `--yes` | `lockit secret rm openai/dev` with TTY confirming "yes"                                                 | Secret removed                                                         | 0         | integration (with TTY mock) |
| Aborts removal if user declines          | `lockit secret rm openai/dev` with TTY user entering "no"                                               | Secret remains; output: "removal cancelled" or similar                 | 1         | integration (with TTY mock) |
| Rejects removal of non-existent secret   | `lockit secret rm nonexistent/key --yes`                                                                | Error: "secret not found"                                              | 1         | integration                 |
| Breaks slots pinned to removed secret    | After linking a pinned slot to openai/dev then removing it, `lockit status` shows the slot as "missing" | Slot status shows `kind: "missing"`                                    | 1         | integration                 |

---

## Slot / Link Commands

### Feature: `link` (declare a slot)

| Behavior to test                                           | Input / command                                                                               | Expected output                                                       | Exit code | Test layer  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------- | ----------- |
| Links a pinned slot                                        | `lockit link openai/dev openai OPENAI_API_KEY`                                                    | Confirmation: "slot linked"; `.lockit/vault.json` updated                 | 0         | integration |
| Links an open slot                                         | `lockit link openai (no slug) OPENAI_API_KEY`                                                     | Slot created with `bind: "open"`                                      | 0         | integration |
| Multi-field slot: one inject key maps to multiple env vars | `lockit link supabase/prod supabase 'SUPABASE_URL -> NEXT_PUBLIC_SUPABASE_URL,VITE_SUPABASE_URL'` | `.lockit/vault.json` records the mapping; no values in output             | 0         | integration |
| Enforces unique inject-name invariant                      | After linking OPENAI_API_KEY → MY_KEY, linking again with the same target env-var name fails  | Error: "duplicate inject name: MY_KEY"                                | 1         | integration |
| Rejects link to non-existent schema                        | `lockit link unknown/key UNKNOWN_SCHEMA UNKNOWN_FIELD`                                            | Error or warning: schema not recognized (behavior depends on policy)  | varies    | integration |
| `link --set` chains admission + fill                       | `lockit link openai/dev openai --set OPENAI_API_KEY` (user confirms admission + auth)             | Slot linked and filled in one gesture; local resolution cache updated | 0         | integration |
| Updates inject mapping without unlinking                   | `lockit link openai/dev openai --force OPENAI_API_KEY -> DIFFERENT_ENV_VAR`                       | Old mapping replaced; output confirms update                          | 0         | integration |

---

### Feature: `unlink` (remove a slot)

| Behavior to test                    | Input / command                                                   | Expected output                        | Exit code | Test layer  |
| ----------------------------------- | ----------------------------------------------------------------- | -------------------------------------- | --------- | ----------- |
| Removes a slot                      | After linking openai, `lockit unlink openai OPENAI_API_KEY`           | Confirmation; `.lockit/vault.json` updated | 0         | integration |
| Rejects unlink of non-existent slot | `lockit unlink nonexistent FIELD`                                     | Error: "slot not found"                | 1         | integration |
| Unlink does not remove the secret   | After unlinking openai, `lockit ls openai/dev` still shows the secret | Secret remains in global store         | 0         | integration |

---

### Feature: `slot add` (declare a requirement)

| Behavior to test                       | Input / command                                                                      | Expected output                                            | Exit code | Test layer  |
| -------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------- | ----------- |
| Creates an open requirement            | `lockit slot add openai OPENAI_API_KEY`                                                  | Slot created with `bind: "open"`, no binding to a slug yet | 0         | integration |
| Is equivalent to `link` without a slug | `lockit slot add supabase SUPABASE_URL` behavior matches `lockit link supabase SUPABASE_URL` | Both create the same vault structure                       | 0         | unit        |

---

## Resolution & Injection

### Feature: `status` (onboarding diff)

| Behavior to test                                               | Input / command                                                                              | Expected output                                                                                                                                                                  | Exit code | Test layer  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| Reports "ok" for pinned slot with matching secret              | Link openai/dev, add secret openai/dev, `lockit status`                                          | Slot status: `ok: schema=openai, resolvedTo=openai/dev`                                                                                                                          | 0         | integration |
| Reports "missing" for pinned slot with absent secret           | Link openai/dev but don't add it, `lockit status`                                                | Slot status: `missing: schema=openai, pinnedTo=openai/dev`                                                                                                                       | 1         | integration |
| Reports "open-unfilled" for open slot with no candidates       | Link openai (open) but no openai secrets exist, `lockit status`                                  | Slot status: `open-unfilled: schema=openai`                                                                                                                                      | 1         | integration |
| Reports "ok" with resolved-to for open slot with one candidate | Link openai (open), add exactly one secret with schema openai (e.g. openai/dev), `lockit status` | Slot status: `ok: schema=openai, resolvedTo=openai/dev`                                                                                                                          | 0         | integration |
| Reports "ambiguous" for open slot with >1 candidate            | Link openai (open), add openai/dev and openai/prod, `lockit status`                              | Slot status: `ambiguous: schema=openai, candidates: [{index:0, slug:openai/dev, schema:openai, tags:[]}, {index:1, slug:openai/prod, tags:[...]}]` (value-free numbered chooser) | 1         | integration |
| Respects `--env` filter                                        | Add secrets with per-environment variants, `lockit status --env prod`                            | Only slots/secrets for `prod` environment listed                                                                                                                                 | 0         | integration |
| `--json` output is value-free                                  | `lockit status --json`                                                                           | Valid JSON with slots[]array; no plaintext values in any field                                                                                                                   | 0         | integration |
| Returns non-zero exit when any slot unresolved                 | Vault with one missing, one ok, one ambiguous, `lockit status`                                   | Exit code 1; output lists all statuses                                                                                                                                           | 1         | integration |
| Returns zero exit when all slots ok                            | All slots pinned and matching secrets exist, `lockit status`                                     | Exit code 0                                                                                                                                                                      | 0         | integration |

---

### Feature: `run` (inject and execute)

| Behavior to test                                                       | Input / command                                                                                                                                                                   | Expected output                                                                                                 | Exit code | Test layer  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| Injects env vars into child                                            | Add openai/dev with OPENAI_API_KEY=sk-test, link pinned slot, `lockit run -- printenv OPENAI_API_KEY`                                                                                 | Child's stdout shows the value (unmasked for the child); `lockit run` capture shows masking applied                 | varies    | integration |
| Does not leak env vars to parent process                               | After `lockit run -- export MY_VAR=value`, parent shell's `echo $MY_VAR` is empty                                                                                                     | Parent environment unchanged                                                                                    | 0         | integration |
| Child does not inherit parent's unrelated vars                         | Set parent env var PARENT_VAR=foo, `lockit run -- printenv PARENT_VAR`                                                                                                                | Child's output is empty (or shows "not found")                                                                  | varies    | integration |
| Resolves pinned slots correctly                                        | Pinned to openai/dev, `lockit run -- printenv OPENAI_API_KEY`                                                                                                                         | Shows the value from openai/dev                                                                                 | varies    | integration |
| Resolves open slots with single candidate                              | Open slot for openai, exactly one secret openai/dev exists, `lockit run -- printenv OPENAI_API_KEY`                                                                                   | Shows value from openai/dev                                                                                     | varies    | integration |
| Aborts run if slot is ambiguous                                        | Open slot for openai, two secrets exist (openai/dev and openai/prod), `lockit run -- printenv`                                                                                        | Error: "ambiguous resolution: choose one" with numbered chooser; no child spawned                               | 1         | integration |
| Aborts run if slot is missing                                          | Pinned slot to nonexistent/key, `lockit run -- printenv`                                                                                                                              | Error: "missing secret: nonexistent/key"; no child spawned                                                      | 1         | integration |
| Aborts run if slot unfilled (open with no candidates)                  | Open slot, zero matching secrets, `lockit run -- printenv`                                                                                                                            | Error: "open slot unfilled: schema=..."; no child spawned                                                       | 1         | integration |
| One-value-many-names: multiple env vars from one field                 | Link supabase/prod with inject map `{SUPABASE_URL -> [NEXT_PUBLIC_SUPABASE_URL, VITE_SUPABASE_URL]}`, `lockit run -- printenv NEXT_PUBLIC_SUPABASE_URL && printenv VITE_SUPABASE_URL` | Both env vars contain the same value                                                                            | varies    | integration |
| Detects duplicate inject-name collision at link time (not at run time) | Attempt to link two slots that both inject MY_KEY, `lockit link ...`                                                                                                                  | Error at link time: "duplicate inject name: MY_KEY"                                                             | 1         | integration |
| Exits with child's exit code                                           | Child command succeeds, `lockit run -- true`                                                                                                                                          | Exit code 0; child exits with 0                                                                                 | 0         | integration |
| Exits with child's exit code (failure case)                            | Child exits with error, `lockit run -- false`                                                                                                                                         | Exit code 1 (or child's code)                                                                                   | 1         | integration |
| Masks child stdout containing the secret value                         | Child does `echo $OPENAI_API_KEY`, `lockit run -- bash -c 'echo "sk-test"'` (with OPENAI_API_KEY=sk-test)                                                                             | `lockit run` output shows `[MASKED]` or similar where the value would be                                            | varies    | integration |
| Masks child stderr containing the secret value                         | Child does `echo "Error: sk-test" >&2`, `lockit run -- bash -c 'echo "Error: sk-test" >&2'`                                                                                           | `lockit run` stderr shows `[MASKED]` or similar                                                                     | varies    | integration |
| Materializes file-type fields to tmpfs                                 | Field with `type: "file"`, `lockit run -- cat $MY_FILE_PATH`                                                                                                                          | Child receives a path in `MY_FILE_PATH`, file is readable and contains the value, temp file is cleaned up after | varies    | integration |
| File-type field path is not in normal env output                       | Ensure file paths do not leak in `lockit run` output listing                                                                                                                          | Output does not show raw filesystem paths                                                                       | varies    | integration |
| Shreds file-type fields on exit                                        | After `lockit run`, verify temp file at the path is gone                                                                                                                              | Temp file removed                                                                                               | 0         | integration |
| Rejects `lockit run` on a fresh vault (no slots)                           | `lockit run -- printenv` with no slots defined                                                                                                                                        | Error or confirmation prompt (policy dependent)                                                                 | varies    | integration |

---

### Feature: `run --dry-run` (agent-safe preview)

| Behavior to test                        | Input / command                                                                                   | Expected output                                                  | Exit code | Test layer  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- | ----------- |
| Prints env-var names only (no values)   | After linking openai with OPENAI_API_KEY, `lockit run --dry-run -- echo hello`                        | Output shows `OPENAI_API_KEY` (or similar), not the actual value | 0         | integration |
| Prints one-value-many-names expansion   | Inject map maps SUPABASE_URL to [NEXT_PUBLIC_SUPABASE_URL, VITE_SUPABASE_URL], `lockit run --dry-run` | Output shows all three env-var names                             | 0         | integration |
| Does not decrypt or spawn child         | `lockit run --dry-run -- some-command`                                                                | Child command is never executed; decryption never happens        | 0         | integration |
| Flags duplicate inject-name collisions  | Vault with duplicate inject names (if somehow present), `lockit run --dry-run`                        | Error: "duplicate inject name: X"; does not proceed              | 1         | integration |
| Flags unfilled open slots               | Open slot with no matching secrets, `lockit run --dry-run`                                            | Warning or error: "open slot unfilled: schema=..."               | 1         | integration |
| Flags missing pinned slots              | Pinned to non-existent secret, `lockit run --dry-run`                                                 | Warning or error: "missing secret: slug"                         | 1         | integration |
| Flags ambiguous open slots              | Open slot with multiple candidates, `lockit run --dry-run`                                            | Error or numbered chooser: "ambiguous resolution"                | 1         | integration |
| Returns zero if all slots resolvable    | All slots ok, `lockit run --dry-run`                                                                  | Exit code 0; output shows resolvable env-var names               | 0         | integration |
| Returns non-zero if any slot unresolved | Any slot missing/open-unfilled/ambiguous, `lockit run --dry-run`                                      | Exit code 1                                                      | 1         | integration |
| No values in output                     | Vault contains secrets with values, `lockit run --dry-run --json`                                     | JSON output contains no plaintext values                         | 0         | integration |

---

## Onboarding & Identity

### Feature: `status` (headline diff; also tested above)

Tested under "Resolution & Injection > `status`".

---

### Feature: `whoami`

| Behavior to test                                 | Input / command    | Expected output                                                                                | Exit code | Test layer  |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------- | --------- | ----------- |
| Reports local identity value-free                | `lockit whoami`        | Output shows: local username, machine name, vault location, count of secrets/slots (no values) | 0         | integration |
| Reports in `--json` value-free                   | `lockit whoami --json` | Valid JSON with identity metadata, no secret values                                            | 0         | integration |
| Includes passphrase hint / identity confirmation | `lockit whoami`        | Output may include key fingerprint or derived identity confirmation (no passphrase itself)     | 0         | integration |

---

### Feature: `import-env` (ingest `.env` into store)

| Behavior to test                                 | Input / command                                                                                   | Expected output                                                                | Exit code | Test layer                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- | --------------------------- |
| Parses `.env` file into secrets                  | Create a `.env` with `OPENAI_API_KEY=sk-123` and `SUPABASE_URL=https://...`, `lockit import-env .env` | Confirmation: "imported 2 secrets" (or similar); `lockit ls` lists the new secrets | 0         | integration                 |
| Never echoes imported values                     | `lockit import-env .env` output                                                                       | Output shows only keys/slugs inferred, no values                               | 0         | integration                 |
| Infers slug from var name                        | `OPENAI_API_KEY=...` in `.env` becomes slug `openai/api_key` or similar                           | Slug inference is consistent and logged (value-free)                           | 0         | integration                 |
| Infers schema from var name (if recognized)      | `SUPABASE_URL=...` in `.env`, system recognizes `supabase` schema                                 | Confirms schema inference in output                                            | 0         | integration                 |
| Prompts for schema confirmation for unknown vars | Unknown var like `ACME_TOKEN=...` in `.env`                                                       | Prompts to confirm or supply schema; never echoes value                        | 0         | integration (with TTY mock) |
| Skips or confirms overwriting existing secrets   | `lockit import-env .env` when secrets already exist for the same slugs                                | Prompts "overwrite?" and proceeds conditionally, or error "already exists"     | varies    | integration                 |

---

## Error Handling & Exit Codes

### Feature: Stable exit-code contract

| Behavior to test                             | Input / command                                    | Expected output                            | Exit code                           | Test layer                   |
| -------------------------------------------- | -------------------------------------------------- | ------------------------------------------ | ----------------------------------- | ---------------------------- |
| Success code                                 | Any successful command                             | N/A                                        | 0                                   | unit                         |
| General error code                           | `lockit secret ls --invalid-flag`                      | Error message                              | 2 (or agreed-upon usage error)      | unit                         |
| Missing/not found                            | `lockit ls nonexistent/key`                            | "not found" message                        | 1 (or agreed-upon "not found" code) | unit                         |
| Unresolved slot (missing)                    | `lockit status` with pinned slot to absent secret      | "missing" status                           | 1                                   | unit                         |
| Unresolved slot (open-unfilled)              | `lockit status` with open slot, zero candidates        | "open-unfilled" status                     | 1                                   | unit                         |
| Ambiguous resolution                         | `lockit status` with open slot, multiple candidates    | "ambiguous" error; exit code for ambiguity | 1 (or dedicated code, e.g. 2)       | unit                         |
| Deferred feature (e.g., `share`)             | `lockit share ...`                                     | Structured error: "not available until P3" | 3 (or agreed-upon "deferred" code)  | unit                         |
| Auth failure (local presence auth declined)  | `lockit link --set ...` and user declines Touch ID     | "admission cancelled" or similar           | 1                                   | integration (with auth mock) |
| Admission denied (user cancels confirmation) | `lockit link --set ...` and user declines confirmation | "admission cancelled"                      | 1                                   | integration (with TTY mock)  |

A centralized test table pins each outcome to its stable code.

---

### Feature: `share` (deferred stub)

| Behavior to test                         | Input / command                                 | Expected output                                                                         | Exit code                       | Test layer  |
| ---------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------- | ----------- |
| Returns structured "not available" error | `lockit share openai/dev --to alice@example.com`    | Error message: "sharing is not available until Plan P3" (structured, machine-parseable) | 3 (or documented deferred code) | unit        |
| Does not touch the store                 | After `lockit share ...` error, store is unmodified | `lockit ls` unchanged                                                                       | 0 (after error)                 | integration |

---

## Value Input Discipline

### Feature: Hidden prompt (TTY input)

| Behavior to test                   | Input / command                                            | Expected output                            | Exit code | Test layer     |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------ | --------- | -------------- |
| Prompts for hidden input in TTY    | `lockit secret add test/key MY_KEY` in interactive terminal    | Prompt appears; input is not echoed        | 0         | unit (IO mock) |
| Reads value from stdin if not TTY  | `echo "value" \| lockit secret add test/key MY_KEY`            | Command succeeds; value is read from stdin | 0         | integration    |
| Degrades to stdin if `--no-input`  | `echo "value" \| lockit secret add --no-input test/key MY_KEY` | Value read from stdin                      | 0         | integration    |
| Rejects `--no-input` without stdin | `lockit secret add --no-input test/key MY_KEY < /dev/null`     | Error: "no input mode requires stdin"      | 1         | integration    |

---

## Value-Free Rendering

### Feature: Human and `--json` output

| Behavior to test                       | Input / command                       | Expected output                                                              | Exit code | Test layer  |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- | --------- | ----------- |
| `ls` human output contains no values   | `lockit secret ls` with stored secrets    | Output shows slugs, schemas, field keys, `hasValue: true`, no values         | 0         | integration |
| `ls --json` contains no values         | `lockit secret ls --json`                 | Valid JSON; no plaintext values anywhere                                     | 0         | integration |
| Status human output contains no values | `lockit status`                           | Output shows slot statuses, schemas, resolved slugs; no values               | 0         | integration |
| Status `--json` contains no values     | `lockit status --json`                    | Valid JSON; no plaintext values anywhere                                     | 0         | integration |
| Ambiguous chooser is value-free        | `lockit status` with ambiguous resolution | Numbered list: `0) openai/dev (openai), 1) openai/prod (openai)` — no values | 0         | integration |

---

## Output Masking at `run`

### Feature: Masking chokepoint

| Behavior to test                                         | Input / command                                                               | Expected output                                                | Exit code | Test layer  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | --------- | ----------- |
| Masks plaintext value in child stdout                    | Child does `echo $SECRET_VALUE`, `lockit run -- bash -c 'echo $SECRET_VALUE'`     | `lockit run` output shows masked token (e.g. `[MASKED]` or `***`)  | varies    | integration |
| Masks plaintext value in child stderr                    | Child does `echo "Error: $SECRET_VALUE" >&2`                                  | `lockit run` stderr shows masked token                             | varies    | integration |
| Does not double-mask                                     | Child prints `[MASKED]` legitimately, `lockit run -- echo "[MASKED]"`             | Output appears (not masked again) or consistent masking policy | varies    | integration |
| Masks multi-line output containing value                 | Child outputs multi-line, with secret on one line                             | That line is masked; other lines unchanged                     | varies    | integration |
| Respects honest limits: does not mask transformed values | Child base64-encodes the secret, `lockit run -- bash -c 'echo $SECRET \| base64'` | Transformed value is not masked (documented as a limit)        | varies    | integration |
| Zero masked output if child never references env var     | Child does `echo hello`, `lockit run -- echo hello`                               | Output: `hello`, no masking applied                            | varies    | integration |

---

## Global Flags & Options

### Feature: `--env` (per-environment projection)

| Behavior to test                         | Input / command                                             | Expected output                             | Exit code | Test layer  |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- | --------- | ----------- |
| Filters secrets by environment tag       | Secrets tagged with `env:prod`, `lockit secret ls --env prod`   | Output includes only prod-tagged secrets    | 0         | integration |
| Filters vault slots by environment       | Vault with per-environment slots, `lockit status --env staging` | Status shows only staging-scoped slots      | 0         | integration |
| Injects only environment-matching fields | Slot specifies per-env field bindings, `lockit run --env prod`  | Child receives only prod-environment values | varies    | integration |

---

### Feature: `--json` (structured machine output)

| Behavior to test                | Input / command                                        | Expected output                                                                 | Exit code | Test layer  |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- | --------- | ----------- |
| All commands support `--json`   | `lockit ls --json`, `lockit status --json`, `lockit whoami --json` | Valid JSON in each case                                                         | 0         | unit        |
| Schema is stable and documented | Multiple runs of `--json`                              | Output schema does not change between runs (or carries a `schemaVersion` field) | 0         | unit        |
| `--json` output is value-free   | Any `--json` command with secrets                      | No plaintext values in output                                                   | 0         | integration |

---

### Feature: `--no-input`

| Behavior to test                         | Input / command                                                             | Expected output                       | Exit code | Test layer  |
| ---------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------- | --------- | ----------- |
| Reads value from stdin, rejects TTY      | `echo "value" \| lockit secret add --no-input test/key MY_KEY`                  | Command succeeds; no prompt           | 0         | integration |
| Fails if stdin is a TTY and `--no-input` | `lockit secret add --no-input test/key MY_KEY` (interactive terminal, no stdin) | Error: "no input mode requires stdin" | 1         | integration |

---

## Sandbox Admission (integration with `@lockit/core`)

### Feature: Admission gating

| Behavior to test                                     | Input / command                                                                 | Expected output                                                                 | Exit code | Test layer                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- | ---------------------------- |
| `link --set` chains admission + fill                 | `lockit link openai/dev openai --set OPENAI_API_KEY` with user confirming admission | Admission confirmed, slot filled, local cache updated                           | 0         | integration (with auth mock) |
| Admission requires human confirmation + local auth   | `lockit link --set ...`                                                             | System prompts for confirmation (show secret slug/schema) + Touch ID / password | varies    | integration                  |
| Batch admission shows all keys in one box            | Multiple `link --set` in sequence or batch form                                 | One confirmation box lists all keys; one auth satisfies all                     | 0         | integration (with auth mock) |
| Re-auth policy: default no re-auth on later `lockit run` | After admission, `lockit run` multiple times                                        | Only first `link --set` triggers auth; `lockit run` does not re-auth                | 0         | integration                  |

---

## Router & Command Dispatch

### Feature: Command routing

| Behavior to test                                | Input / command                                                         | Expected output                                                   | Exit code | Test layer |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- | --------- | ---------- |
| Recognizes valid commands                       | `lockit secret add`, `lockit secret ls`, `lockit link`, `lockit status`, `lockit run`, etc. | Dispatch succeeds (command runs or fails appropriately)           | varies    | unit       |
| Rejects unknown commands                        | `lockit unknown-command`                                                    | Error: "unknown command: unknown-command"                         | 2         | unit       |
| Provides a help/usage message                   | `lockit --help` or `lockit -h`                                                  | Usage text listing all commands                                   | 0         | unit       |
| Supports abbreviated verb forms (if applicable) | `lockit secret add` vs `lockit add` (if both are supported)                     | Both forms dispatch correctly (or error clearly if not supported) | 0 or 2    | unit       |

---

## Integration: Admission Workflow

### Feature: Sandbox + CLI together

| Behavior to test                      | Input / command                                                                 | Expected output                                                            | Exit code | Test layer  |
| ------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- | ----------- |
| Slot binds to project world           | After admitting openai/dev into project, `lockit run` uses only the admitted secret | Child receives the value; other secrets in global store are inaccessible   | varies    | integration |
| Project world is isolated             | Two projects, each admits a different openai secret, `lockit run` in each project   | Each project receives only its admitted secret                             | varies    | integration |
| Trying to use unadmitted secret fails | Vault slot requires a secret that has not been admitted, `lockit run`               | Error: "secret not admitted to this project" (or similar); no value leaked | 1         | integration |

---

## Integration: Deterministic Build & Test

### Feature: Reproducible `lockit` binary

| Behavior to test                | Input / command           | Expected output                  | Exit code | Test layer |
| ------------------------------- | ------------------------- | -------------------------------- | --------- | ---------- |
| Binary builds deterministically | `pnpm -r build` run twice | Binary hash is identical         | 0         | CI         |
| All tests pass in CI            | CI runs `pnpm -r test`    | No failures                      | 0         | CI         |
| Typecheck passes strict mode    | `pnpm -r typecheck`       | No TS errors                     | 0         | CI         |
| Lint passes                     | `pnpm -r lint`            | No eslint or prettier violations | 0         | CI         |

---

## Threat Model Compliance

### Feature: No value ever reaches agent context

| Behavior to test                                   | Input / command                                                     | Expected output                                                               | Exit code | Test layer  |
| -------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ----------- |
| `ls` output safe for agent                         | Agent reads `lockit ls --json`, parses it                               | Output contains only slugs, schemas, field keys, `hasValue`, tags — no values | 0         | integration |
| `status` output safe for agent                     | Agent reads `lockit status --json`                                      | Output shows slot statuses, schemas, ambiguous chooser — no values            | 0         | integration |
| `--dry-run` output safe for agent                  | Agent reads `lockit run --dry-run --json`                               | Output shows env-var names only — no values                                   | 0         | integration |
| `run` output safe for agent (child streams masked) | Child outputs a secret value, agent captures `lockit run` stdout/stderr | Output shows masked value, not plaintext                                      | varies    | integration |

---

## Test Infrastructure

### Feature: `spawn-lockit` integration harness

| Behavior to test                          | Input / command                                        | Expected output                                         | Exit code | Test layer  |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- | --------- | ----------- |
| Spawns real compiled binary               | `spawn-lockit(["secret", "add", ...], { stdin: "value" })` | Binary actually runs; does not mock or stub the command | varies    | integration |
| Captures stdout/stderr/exit code          | Spawn a command, extract results                       | `{ stdout, stderr, exitCode }` available to test        | 0         | integration |
| Provides isolated temp HOME + project dir | Each test spawns with its own HOME + `.lockit/`            | No cross-test contamination                             | 0         | integration |
| Feeds stdin to binary                     | `spawn-lockit(cmd, { stdin: "my-value" })`                 | Binary reads from stdin as expected                     | 0         | integration |
| Isolates TTY detection                    | Can mock `isStdinTTY` for prompt tests                 | Tests can simulate both TTY and non-TTY                 | 0         | unit        |

---

## Security Constraints (Invariants)

Each invariant below is tested as a dedicated suite:

### Invariant 1: Agent never emits a secret value

- `ls --json` output contains no values
- `status --json` output contains no values
- `--dry-run --json` output contains no values
- Ambiguous chooser is value-free (numbered list only)
- (Tested throughout "Value-Free Rendering" and "Output Masking at `run`")

### Invariant 2: Project-world sandbox is real

- Slots can only reference admitted secrets
- Admission is gated by human confirmation + local auth
- Trying to use unadmitted secret fails
- (Tested under "Sandbox Admission" and "Integration: Admission Workflow")

### Invariant 3: Admission requires human auth

- `link --set` chains confirmation + Touch ID
- Batch admission shows all keys in one box
- Re-auth policy is clear and testable
- (Tested under "Sandbox Admission")

### Invariant 4: References, not copies

- Renaming a slug (and recording in `aka`) preserves all slot resolution
- Rotating a secret updates all consumers automatically
- (Tested under "`secret rename`" and "`secret rotate`")

### Invariant 5: Unique-inject-name invariant

- Duplicate inject name is rejected at link time
- Duplicate inject name is flagged at `--dry-run`
- (Tested under "`link`" and "`run --dry-run`")

### Invariant 6: `crypto` stays pure (not tested in CLI layer, owned by `@lockit/crypto`)

- N/A for CLI tests; crypto is tested separately

### Invariant 7: Resolver never guesses

- Pinned slots use exact slug
- Open slots with 0 candidates = error (open-unfilled)
- Open slots with 1 candidate = auto-resolve (ok)
- Open slots with N>1 candidates = error (ambiguous) with numbered chooser
- (Tested under "`status`" and "`run`")

### Invariant 8: Server only holds ciphertext (not tested in CLI layer, owned by `@lockit/server`)

- N/A for CLI tests; server is tested separately

---

## Notes on Test Granularity

- **Unit tests** validate individual functions (IO seams, render logic, error mapping) with mocked IO.
- **Integration tests** spawn the real compiled `lockit` binary, drive it with real stdin/stdout/stderr, and verify behavior end-to-end.
- **TTY/interactive tests** use an IO mock to simulate terminal prompts without requiring a real terminal.
- **Auth-gated tests** mock the local presence auth (Touch ID / password) to test admission workflows.
- **Masking tests** verify the chokepoint by injecting known values and confirming they are masked in output.

---

## CI & Coverage

- All tests must pass in CI (`pnpm -r test`).
- Typecheck, lint, and build must also pass.
- Coverage target: 80%+ for `packages/cli` (especially security-critical paths like value input, rendering, masking, resolver).
- Deterministic build: binary hash identical across runs.
- Each test is hermetic: temp dirs, isolated HOME, no side effects.
