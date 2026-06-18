# P4 Test Plan: Sandbox, Admission, Unlock & Injection

**Status:** Blueprint for just-in-time TDD implementation of P4 (not yet built).

**Scope:** Phase 4 delivers the project-world sandbox, human-gated admission flow with pluggable AuthProvider, the `kv run` in-memory injection engine with masking and file materialization, the audit log, the unlock/keychain cache model, and the agent-safe listing surface.

**Depends on:** P0 (crypto at-rest), P1 (sealed envelope, key wrap), P3 (store, vault model, strict resolver).

**Key invariants proven by these tests:**

1. The agent cannot bypass admission; human fingerprint is structurally required.
2. Auth is mandatory and called exactly once per batch admission.
3. Refusal admits nothing; no slug enters project-world on failed auth.
4. Injection isolation: values confined to child process env, never parent, never disk.
5. Sandbox is enforced at run time: only admitted slugs are decrypted.
6. Output masking: every secret value in child stdout/stderr is replaced before terminal/capture.
7. File materialization: file-type secrets materialize to `0600` tmpfs, shredded after child exit.
8. No plaintext written to disk during injection (except materialized `0600` file).
9. Dry-run contains NO values; only env-var names, flags for duplicates, unfilled slots, ambiguity.
10. Audit entries recorded; all value-free (slugs/metadata only).
11. Agent-safe listing never leaks a value; projection is slug/schema/fieldKeys/tags/hasValue/admitted only.
12. Unlock cache: passphrase once, then Touch ID per-session (smooth), or per-use for agent-initiated (fingerprint every time).
13. Auto-lock on sleep, idle timeout, or explicit `kv lock`.
14. Off-device fallback: SSH passphrase prompt, CI `KV_PASSPHRASE` env var (deliberately weaker).

---

## 1. Project-World Admitted Set

### Feature: Project-world admitted set persistence

| Feature         | Behavior to test                                      | Input / command                                                | Expected output                                   | Exit code | Test layer |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- | --------- | ---------- |
| **Persistence** | Loads admitted slugs from `.kv/admitted.json` on init | `ProjectWorld.load(kvHome)` on new store                       | Empty Set, no error                               | N/A       | unit       |
| **Persistence** | Saves new admitted slugs to gitignored state file     | `projectWorld.admit(['openai/dev'])`, then load in new process | Same admitted set in new process                  | N/A       | unit       |
| **Persistence** | Reads from empty state returns empty set              | `.kv/admitted.json` missing                                    | `admitted.size === 0`                             | N/A       | unit       |
| **Persistence** | Persists across multiple process invocations          | `admit()` in P1, load in P2                                    | P2 sees same set as P1 wrote                      | N/A       | e2e        |
| **Persistence** | File created in correct directory                     | `ProjectWorld.load(kvHome)` with custom `$KV_HOME`             | `.kv/admitted.json` at `${KV_HOME}/admitted.json` | N/A       | unit       |

### Feature: Project-world membership query

| Feature   | Behavior to test                               | Input / command                                                                | Expected output | Exit code | Test layer |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------------ | --------------- | --------- | ---------- |
| **Query** | `has()` returns true for admitted slug         | After `admit(['openai/dev'])`, call `has('openai/dev')`                        | `true`          | N/A       | unit       |
| **Query** | `has()` returns false for non-admitted slug    | Empty or different set, call `has('supabase/prod')`                            | `false`         | N/A       | unit       |
| **Query** | `has()` is case-sensitive                      | After `admit(['openai/dev'])`, call `has('OPENAI/DEV')` or `has('OpenAI/Dev')` | `false`         | N/A       | unit       |
| **Query** | Empty project world returns false for any slug | New ProjectWorld, call `has()` on any slug                                     | `false`         | N/A       | unit       |

### Feature: Project-world admit operation

| Feature   | Behavior to test                      | Input / command                                                                               | Expected output                              | Exit code | Test layer |
| --------- | ------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- | --------- | ---------- |
| **Admit** | Adds single slug to admitted set      | `projectWorld.admit(['openai/dev'])`                                                          | `has('openai/dev')` returns true             | N/A       | unit       |
| **Admit** | Adds multiple slugs atomically        | `projectWorld.admit(['openai/dev', 'supabase/prod', 'gcp/service-account'])`                  | All three present in set, one disk write     | N/A       | unit       |
| **Admit** | No duplicate if slug already admitted | After first `admit(['openai/dev'])`, call again with same slug                                | Set size = 1 (not 2)                         | N/A       | unit       |
| **Admit** | Persists to disk synchronously        | Call `admit()`, immediately read file on disk                                                 | Admitted slug present in `.kv/admitted.json` | N/A       | unit       |
| **Admit** | Rejects invalid slug format           | `projectWorld.admit(['INVALID_UPPERCASE', 'no spaces', 'bad/slug/with/slash/start//double'])` | Throw `InvalidSlug` error, no admission      | N/A       | unit       |

---

## 2. AuthProvider & Admission Flow

### Feature: AuthProvider interface and contract

| Feature       | Behavior to test                                          | Input / command                                                                  | Expected output                                                                  | Exit code | Test layer |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------- | ---------- |
| **Interface** | `authenticate()` accepts AuthRequest with reason and keys | Create `AuthRequest { reason: 'Admit to acme-web', keys: [...] }`, call provider | Provider invoked with request                                                    | N/A       | unit       |
| **Interface** | `authenticate()` returns AuthResult with ok and method    | Any successful auth                                                              | `{ ok: boolean, method: 'touchid' \| 'os-password' \| 'passphrase' \| 'mock' }`  | N/A       | unit       |
| **Interface** | method field is one of allowed values                     | Mock with method="mock", TouchID with "touchid"                                  | Exact match on return value                                                      | N/A       | unit       |
| **Interface** | `authenticate()` is async                                 | Call provider, check return type                                                 | Returns Promise<AuthResult>                                                      | N/A       | unit       |
| **Interface** | AuthRequest keys are value-free (no secret values)        | Build ConfirmationItem list for admission                                        | Keys list contains slug, schema, fieldKeys, hasValue only; zero plaintext values | N/A       | unit       |

### Feature: Mock AuthProvider for tests

| Feature  | Behavior to test                                         | Input / command                                                                   | Expected output                                                                    | Exit code | Test layer |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------- | ---------- |
| **Mock** | Can be configured to allow                               | `new MockAuthProvider({ allow: true })`                                           | Returns `{ ok: true, method: 'mock' }`                                             | N/A       | unit       |
| **Mock** | Can be configured to deny                                | `new MockAuthProvider({ allow: false })`                                          | Returns `{ ok: false, method: 'mock' }`                                            | N/A       | unit       |
| **Mock** | Tracks call count for assertions                         | Create provider, call `authenticate()` N times, assert `provider.callCount === N` | Call count accurate                                                                | N/A       | unit       |
| **Mock** | Deny-configured mock cannot admit (agent-safe invariant) | Set agent to use deny-mock, attempt admission of any slug                         | `projectWorld.has(slug)` returns false; no slug admitted despite injection attempt | N/A       | unit       |
| **Mock** | Asserts authenticate() called exactly once per batch     | Admit 3 slugs, check mock.callCount                                               | `callCount === 1` (not 3)                                                          | N/A       | unit       |

### Feature: Admission flow orchestration

| Feature  | Behavior to test                                         | Input / command                                                                       | Expected output                                                                          | Exit code | Test layer |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- | ---------- |
| **Flow** | Accepts list of secret slugs to admit                    | `admission.admit(store, projectWorld, authProvider, ['openai/dev', 'supabase/prod'])` | Proceeds to build confirmation                                                           | N/A       | unit       |
| **Flow** | Builds ConfirmationItem list (value-free)                | Input: 2 secrets with multiple fields                                                 | ConfirmationItem[] with slug, schema, fieldKeys, hasValue; zero plaintext values         | N/A       | unit       |
| **Flow** | Calls AuthProvider.authenticate() exactly once per batch | Admit 5 slugs, mock tracks calls                                                      | `mock.callCount === 1`                                                                   | N/A       | unit       |
| **Flow** | All N slugs admitted atomically on auth success          | Auth returns ok=true, 5 slugs in request                                              | All 5 slugs in projectWorld.admitted; single atomic write to disk                        | N/A       | unit       |
| **Flow** | No slugs admitted if auth fails                          | Auth returns ok=false, call admission.admit()                                         | No slug enters projectWorld; `projectWorld.has(anySlug)` returns false for all requested | N/A       | unit       |
| **Flow** | Audit entry recorded on successful admission             | Call admission.admit() with ok=true auth                                              | Audit log contains entry with action='admit', slugs, method                              | N/A       | unit       |
| **Flow** | Audit entry recorded on refused admission                | Call admission.admit() with ok=false auth                                             | Audit log contains entry with action='refused', slugs, no method field                   | N/A       | unit       |
| **Flow** | Agent using mock-deny provider cannot admit any slugs    | Admission flow with deny-mock provider, any request                                   | No slug admitted; projectWorld remains empty; refused audit entry recorded               | N/A       | unit       |

---

## 3. Injection Engine & Output Masking

### Feature: Injection engine resolution

| Feature        | Behavior to test                                               | Input / command                                                               | Expected output                                                                   | Exit code | Test layer |
| -------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------- | ---------- |
| **Resolution** | Resolves each slot for selected environment                    | Vault with 3 slots, all pinned or open                                        | All slots resolved or error (missing/ambiguous)                                   | N/A       | unit       |
| **Resolution** | Uses strict 0/1/N resolver (from Plan #3)                      | Pinned slot to 'openai/dev'; open slot for schema 'supabase' with 1 candidate | Returns resolved (not guessing) for both                                          | N/A       | unit       |
| **Resolution** | Intersects resolved secrets against project-world admitted set | Resolver returns 'openai/dev'; admitted = ['supabase/prod']                   | Error: slug not admitted                                                          | N/A       | unit       |
| **Resolution** | Rejects if resolved secret slug not in admitted set            | Slot resolves to 'openai/dev', not in projectWorld                            | Hard error before decryption                                                      | 1         | unit       |
| **Resolution** | Decrypts only needed secrets in memory                         | Request 2 secrets from store with 5 total                                     | Only decrypt 2; others not touched; plaintext never on disk                       | N/A       | unit       |
| **Resolution** | Plaintext never written to disk during resolution              | Inject run completes, inspect /tmp and `.kv/`                                 | No plaintext files; only encrypted store.json and materialized 0600 file (if any) | N/A       | e2e        |

### Feature: Injection engine env-var mapping

| Feature     | Behavior to test                                    | Input / command                                                | Expected output                                          | Exit code | Test layer |
| ----------- | --------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- | --------- | ---------- |
| **Mapping** | Maps env-type fields to environment variables       | Secret with OPENAI_API_KEY (env-type), AZURE_TENANT (env-type) | Child process has env vars set                           | N/A       | unit       |
| **Mapping** | Uses exact env-var names from inject map            | Vault slot with inject { OPENAI_API_KEY: 'MY_CUSTOM_NAME' }    | Child env has MY_CUSTOM_NAME, not OPENAI_API_KEY         | N/A       | unit       |
| **Mapping** | Sets env vars for child process only (not parent)   | Parent process.env before inject, child echo inside run        | Child receives vars; parent.env unchanged                | N/A       | e2e        |
| **Mapping** | Parent process.env remains unchanged                | `process.env.OPENAI_API_KEY` before and after kv run           | Before: undefined; After: still undefined (not polluted) | N/A       | e2e        |
| **Mapping** | Child receives all mapped vars                      | Inject 3 env vars for child, child prints all                  | All 3 env vars present and correct                       | N/A       | e2e        |
| **Mapping** | Multiple fields can map to same name via inject map | Inject map: { FIELD_A: 'ENV_NAME', FIELD_B: 'ENV_NAME' }       | Hard error: duplicate inject name (not silent overwrite) | N/A       | unit       |

### Feature: Output masking stream transform

| Feature     | Behavior to test                                  | Input / command                                                 | Expected output                                | Exit code | Test layer |
| ----------- | ------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- | --------- | ---------- |
| **Masking** | Masks exact substring matches of secret values    | Child: `echo $SECRET_VALUE` where value='secretpassword'        | Output shows `***` instead of 'secretpassword' | 0         | e2e        |
| **Masking** | Masks values in child stdout                      | Child: `echo "value is: $SECRET"` to stdout                     | Captured stdout has `***` where value was      | N/A       | e2e        |
| **Masking** | Masks values in child stderr                      | Child: `echo "error: $SECRET" >&2` to stderr                    | Captured stderr has `***` where value was      | N/A       | e2e        |
| **Masking** | Replaces with fixed mask token (not the value)    | Inject multiple secrets, all printed                            | Each replaced with consistent `***` token      | N/A       | e2e        |
| **Masking** | Raw secret value never appears in captured output | Inject SECRET='my-secret-key', child prints it                  | Output scan finds no 'my-secret-key' substring | N/A       | e2e        |
| **Masking** | Masks across stream chunk boundaries              | Secret split across two write() calls (50 bytes, then 50 bytes) | Entire secret masked even if split             | N/A       | unit       |
| **Masking** | Masked value is deterministic per secret          | Same secret printed twice                                       | Both occurrences replaced with `***`           | N/A       | e2e        |
| **Masking** | Longest-first masking (substring protection)      | Inject SECRET_A='abc', SECRET_B='abcdef' (contains A)           | Entire 'abcdef' masked, not accidentally split | N/A       | unit       |

### Feature: Output masking effectiveness limits

| Feature    | Behavior to test                                      | Input / command                                   | Expected output       | Exit code                                                | Test layer |
| ---------- | ----------------------------------------------------- | ------------------------------------------------- | --------------------- | -------------------------------------------------------- | ---------- | --- |
| **Limits** | Documents that transformed values may not be masked   | Child: `echo "$SECRET"                            | base64`               | Output: base64(masked_or_original) — documented honestly | N/A        | doc |
| **Limits** | Documents honest limit: child could defeat masking    | Child: `echo "$SECRET"                            | tr a-z A-Z`           | Output: transformed secret — documented in code comment  | N/A        | doc |
| **Limits** | Documents v1 guarantee: exact-substring + cross-chunk | Test code includes comment on buffering guarantee | Documented in mask.ts | N/A                                                      | doc        |

---

## 4. File Materialization & Shred

### Feature: Injection engine file materialize

| Feature         | Behavior to test                                       | Input / command                                                 | Expected output                                            | Exit code | Test layer |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- | --------- | ---------- |
| **Materialize** | Materializes file-type fields to tmpfs temp file       | Secret with SERVICE_ACCOUNT_JSON (file-type), inject into child | Temp file created on tmpfs (or OS temp dir)                | N/A       | e2e        |
| **Materialize** | Temp file has 0600 permissions (owner read/write only) | After materialization, check file mode                          | `-rw-------` (0600)                                        | N/A       | e2e        |
| **Materialize** | Env var points at file path (not contents)             | Child: `env \| grep SERVICE_ACCOUNT`, value is path not content | Env var is `/tmp/kv-XXXXX` or similar path                 | N/A       | e2e        |
| **Materialize** | Child process can read temp file during execution      | Child: `cat $SERVICE_ACCOUNT_FILE`                              | Child can open and read file; content matches secret value | N/A       | e2e        |
| **Materialize** | Multiple file fields create separate temp files        | Inject 2 file-type secrets                                      | Two distinct temp files created; two env vars set          | N/A       | e2e        |
| **Materialize** | Temp files are cleaned up after child exit             | Child exits, ls /tmp for kv-\* files                            | Temp file no longer exists                                 | N/A       | e2e        |

### Feature: Injection engine file shred on exit

| Feature   | Behavior to test                                       | Input / command                                          | Expected output                                      | Exit code | Test layer |
| --------- | ------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------- | --------- | ---------- |
| **Shred** | Shreds temp file on normal child exit                  | Child runs and exits with code 0                         | Temp file deleted from disk                          | N/A       | e2e        |
| **Shred** | Shreds temp file on child error/non-zero exit          | Child runs and exits with code 127                       | Temp file deleted from disk                          | 127       | e2e        |
| **Shred** | Shreds on SIGTERM/SIGINT signal                        | Child receives SIGTERM mid-run                           | Temp file deleted after cleanup                      | N/A       | e2e        |
| **Shred** | File does not exist on disk after shred                | Verify with `ls` or `stat` after shred                   | File not found (ENOENT)                              | N/A       | e2e        |
| **Shred** | Shred is actually deletion (not just unlink-then-leak) | Shredded file path cannot be recovered by forensic tools | File content unreadable (deleted, not just unlinked) | N/A       | doc        |
| **Shred** | All temp files shredded even if one shred fails        | Inject 3 file secrets; simulate shred failure on #2      | All 3 deleted (error does not prevent others)        | N/A       | unit       |

---

## 5. Dry-Run

### Feature: Dry-run output format

| Feature    | Behavior to test                          | Input / command                                                 | Expected output                                            | Exit code | Test layer |
| ---------- | ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | --------- | ---------- |
| **Format** | Lists env-var names that would be set     | Vault: 3 slots injecting OPENAI_KEY, SUPABASE_URL, GCP_PROJECT  | Output lists these 3 names                                 | 0         | unit       |
| **Format** | Values are masked or absent entirely      | Dry-run output for secrets with values                          | No plaintext value strings appear                          | 0         | unit       |
| **Format** | Flags duplicate inject names as error     | Vault: two slots both inject MY_SECRET                          | Error message names MY_SECRET as duplicated                | 1         | unit       |
| **Format** | Flags unfilled open slots as error        | Vault: open slot for 'database' schema, no store secret matches | Error message: "unfilled open slot: database"              | 1         | unit       |
| **Format** | Flags ambiguous resolution as error       | Vault: open slot for 'database', 3 store secrets match          | Error lists 3 candidates with slug/schema/tags, value-free | 1         | unit       |
| **Format** | Does not run the child command            | `kv run --dry-run my-secret -- echo test`                       | No child spawned; output is dry-run report only            | 0         | unit       |
| **Format** | Does not decrypt any values               | Call dry-run, no passphrase/auth required                       | Succeeds without accessing keychain/passphrase             | 0         | unit       |
| **Format** | No secret value appears in dry-run output | Scan full output for any secret substring                       | Zero plaintext secret bytes in output                      | 0         | e2e        |

### Feature: Dry-run duplicate inject name detection

| Feature       | Behavior to test                                 | Input / command                                                          | Expected output                                       | Exit code | Test layer |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------- | --------- | ---------- |
| **Detection** | Detects when two slots inject same env-var name  | Vault.json: slot1 maps OPENAI_KEY to ENV_A, slot2 maps DATABASE to ENV_A | Error: "duplicate inject name: ENV_A"                 | 1         | unit       |
| **Detection** | Reports which env-var name is duplicated         | Same setup                                                               | Error message includes "ENV_A"                        | 1         | unit       |
| **Detection** | Reports which slots are involved                 | Same setup                                                               | Error message identifies both slots (by schema or id) | 1         | unit       |
| **Detection** | Is a hard error (does not guess last-write-wins) | Ambiguous injection, report as error not silent override                 | Exits 1, does not continue                            | 1         | unit       |

### Feature: Dry-run unfilled open slot detection

| Feature       | Behavior to test                                  | Input / command                                                         | Expected output                                                             | Exit code | Test layer |
| ------------- | ------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- | ---------- |
| **Detection** | Detects open slot with no matching secrets        | Vault: open slot schema='database', store has no 'database' secrets     | Error: "open slot unfilled: schema 'database'"                              | 1         | unit       |
| **Detection** | Detects open slot with no local resolution choice | Vault: open slot, no cached choice in local.json, zero store candidates | Error mentions slot schema and how to fill                                  | 1         | unit       |
| **Detection** | Reports schema of unfilled slot                   | Error message                                                           | Includes schema name (e.g., 'database')                                     | 1         | unit       |
| **Detection** | Indicates how to fill (kv use, kv status, etc.)   | Error message                                                           | Suggests next step or command (e.g., "run 'kv use database supabase/prod'") | 1         | unit       |

### Feature: Dry-run ambiguous resolution detection

| Feature       | Behavior to test                               | Input / command                                                              | Expected output                                                                         | Exit code | Test layer |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------- | ---------- |
| **Detection** | Detects when open slot matches N>1 secrets     | Vault: open slot schema='supabase', store has supabase/dev and supabase/prod | Error: "ambiguous: schema 'supabase'"                                                   | 1         | unit       |
| **Detection** | Lists matching secrets with slug, schema, tags | Error output                                                                 | Shows: "1. supabase/dev [supabase] tags: dev", "2. supabase/prod [supabase] tags: prod" | 1         | unit       |
| **Detection** | Value-free chooser (no values shown)           | Candidate list in error                                                      | Lists slug, schema, tags only; zero field values                                        | 1         | unit       |
| **Detection** | Suggests how to disambiguate                   | Error message                                                                | Recommends: "run 'kv use supabase <slug>' to choose"                                    | 1         | unit       |

---

## 6. Audit Log

### Feature: Audit log append operation

| Feature    | Behavior to test                            | Input / command                                                                      | Expected output                                  | Exit code | Test layer |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ | --------- | ---------- |
| **Append** | Appends admission entry to audit log        | Call `auditLog.record('admit', projectId, ['openai/dev'], 'touchid')`                | Entry written to `.kv/audit.log`                 | N/A       | unit       |
| **Append** | Appends use entry to audit log              | Call `auditLog.record('use', projectId, ['openai/dev', 'supabase/prod'], 'touchid')` | Entry written with action='use'                  | N/A       | unit       |
| **Append** | Appends refused entry to audit log          | Call `auditLog.record('refused', projectId, ['openai/dev'], undefined)`              | Entry written with action='refused'              | N/A       | unit       |
| **Append** | Entries are timestamped                     | Read audit log entry                                                                 | Entry has ISO 8601 timestamp field               | N/A       | unit       |
| **Append** | Entries record action (admit\|use\|refused) | Entries for all three actions                                                        | action field matches ('admit', 'use', 'refused') | N/A       | unit       |
| **Append** | Entries record project context              | Multiple projects, call auditLog.record for each                                     | projectId field correctly identifies project     | N/A       | unit       |
| **Append** | Entries record slugs (never values)         | Audit entry for ['openai/dev', 'supabase/prod']                                      | slugs array present; zero field values           | N/A       | unit       |
| **Append** | Entries record auth method when applicable  | Admit entry with method='touchid'                                                    | method field = 'touchid'                         | N/A       | unit       |
| **Append** | Audit log is append-only (never modified)   | Write entry A, then B, read log                                                      | Log contains [A, B] in order; A never modified   | N/A       | unit       |

### Feature: Audit log reading and queries

| Feature  | Behavior to test                                     | Input / command                                        | Expected output                                                            | Exit code | Test layer |
| -------- | ---------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | --------- | ---------- |
| **Read** | Reads audit entries in chronological order           | auditLog.list()                                        | Entries in ascending timestamp order                                       | N/A       | unit       |
| **Read** | list() returns all entries                           | Write 10 entries, call list()                          | Returns array of length 10                                                 | N/A       | unit       |
| **Read** | Entries by project filter works                      | auditLog.listByProject('project-a') with mixed entries | Returns only entries with projectId='project-a'                            | N/A       | unit       |
| **Read** | Entries by action filter works                       | auditLog.listByAction('admit')                         | Returns only entries with action='admit'                                   | N/A       | unit       |
| **Read** | No entry contains a secret value                     | Scan all audit log entries                             | Zero plaintext field values in any entry                                   | N/A       | unit       |
| **Read** | Entry parsing handles corrupt/partial log gracefully | Truncated or malformed log file                        | Reads valid entries before corruption; error on malformed line (not crash) | N/A       | unit       |

---

## 7. Agent-Safe Listing

### Feature: Agent-safe listing surface

| Feature     | Behavior to test                                                       | Input / command                                    | Expected output                                        | Exit code | Test layer |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | --------- | ---------- |
| **Listing** | Projects Secret to {slug, schema, fieldKeys, tags, hasValue, admitted} | Call agentView.projectSecret(secret, projectWorld) | Returns minimal projection                             | N/A       | unit       |
| **Listing** | Includes slug (exact string)                                           | Secret 'openai/dev'                                | slug = 'openai/dev'                                    | N/A       | unit       |
| **Listing** | Includes schema (exact string)                                         | Secret schema='openai'                             | schema = 'openai'                                      | N/A       | unit       |
| **Listing** | Includes fieldKeys list (keys only)                                    | Secret with OPENAI_API_KEY, OPENAI_ORG_ID          | fieldKeys = ['OPENAI_API_KEY', 'OPENAI_ORG_ID']        | N/A       | unit       |
| **Listing** | Includes tags (if any)                                                 | Secret with tags=['prod', 'critical']              | tags = ['prod', 'critical']                            | N/A       | unit       |
| **Listing** | Includes hasValue (boolean)                                            | Field with value set                               | hasValue = true for that field                         | N/A       | unit       |
| **Listing** | Includes admitted (boolean)                                            | Secret in projectWorld.admitted                    | admitted = true                                        | N/A       | unit       |
| **Listing** | Never includes a secret value                                          | Project any Secret                                 | Output contains zero plaintext field values            | N/A       | unit       |
| **Listing** | fieldKeys list is complete                                             | Secret with 3 fields                               | All 3 keys present in output                           | N/A       | unit       |
| **Listing** | hasValue is boolean (never actual value)                               | Output of hasValue for each field                  | Each is true or false, never a string or partial value | N/A       | unit       |
| **Listing** | Tags are accurate                                                      | Secret with multiple tags                          | All tags present in output; no extra tags              | N/A       | unit       |

### Feature: Agent-safe listing never leaks values

| Feature     | Behavior to test                                  | Input / command                                                                            | Expected output                                    | Exit code | Test layer |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- | --------- | ---------- |
| **No Leak** | Full listing output contains no field value       | Call agentView.listSecrets() for store with 5 secrets                                      | JSON.stringify(output) contains no value substring | N/A       | unit       |
| **No Leak** | Scanning all output finds no secret substring     | Hardcoded known secret in store, scan output                                               | Substring search returns zero matches              | N/A       | unit       |
| **No Leak** | Scanning all output finds no base64-encoded value | Secret value='abc123', scan output for base64('abc123')                                    | Zero matches (not encoded as escape hatch)         | N/A       | unit       |
| **No Leak** | Test uses known secret value and verifies absence | Test hardcodes SECRET='my-test-value', adds to store, projects to agent-view, scans output | Confirming absence                                 | N/A       | unit       |

---

## 8. Sandbox Enforcement & Injection Isolation

### Feature: Sandbox cannot be bypassed at run time

| Feature    | Behavior to test                                      | Input / command                                                             | Expected output                                                        | Exit code | Test layer |
| ---------- | ----------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------- | ---------- |
| **Bypass** | Resolving slot to non-admitted slug raises hard error | Vault pins to 'openai/dev'; secret exists in store but not admitted         | Error: "secret not admitted: openai/dev"                               | 1         | unit       |
| **Bypass** | Injection refused even though secret exists in store  | Slot resolves to 'supabase/prod'; exists in store but projectWorld is empty | Hard error before decryption                                           | 1         | unit       |
| **Bypass** | Error message is clear (not a value leak)             | Error output                                                                | Message names slug only, no field values or hints about value contents | 1         | unit       |
| **Bypass** | Project world membership is checked before decryption | Call injectSecret() with non-admitted slug                                  | Check fails before aeadOpen() is called                                | N/A       | unit       |

### Feature: Injection isolation (value confined to child)

| Feature       | Behavior to test                              | Input / command                                                                   | Expected output                                                                              | Exit code | Test layer |
| ------------- | --------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- | ---------- |
| **Isolation** | Resolved value present in spawned child env   | Child: `echo $OPENAI_API_KEY`                                                     | Child output shows (or masked) value                                                         | N/A       | e2e        |
| **Isolation** | Resolved value absent from parent process.env | Parent inspects process.env.OPENAI_API_KEY before and after kv run                | Before run: undefined; After run: still undefined                                            | N/A       | e2e        |
| **Isolation** | Resolved value absent from on-disk artifacts  | kv run completes, scan /tmp, ~/.kv, current directory                             | No unencrypted file containing value (except 0600 materialized file during child's lifetime) | N/A       | e2e        |
| **Isolation** | Child can read value via process.env.VAR_NAME | Child: `node -e "console.log(process.env.SECRET)"`                                | Child prints value (or masked output shows it was received)                                  | N/A       | e2e        |
| **Isolation** | Parent cannot read value after child spawns   | Parent: `setTimeout(() => console.log(process.env.SECRET), 100)` during child run | Parent env remains empty                                                                     | N/A       | e2e        |

---

## 9. Unlock & Keychain Cache

### Feature: Keychain cache (unlock passphrase once, then Touch ID)

| Feature   | Behavior to test                                          | Input / command                              | Expected output                                                  | Exit code | Test layer |
| --------- | --------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | --------- | ---------- |
| **Cache** | On first unlock, passphrase derives AK                    | User supplies passphrase at prompt           | AK (Account Key) derived via Argon2id                            | N/A       | unit       |
| **Cache** | AK unwraps DEK from wrapped envelope                      | Wrapped DEK in store, unlock with passphrase | DEK successfully unwrapped and matches stored payload key        | N/A       | unit       |
| **Cache** | DEK is cached in OS keychain with Touch ID access policy  | After unwrap, verify keychain entry created  | Entry exists in keychain, accessible via Touch ID                | N/A       | unit       |
| **Cache** | Subsequent unlocks use Touch ID to release DEK from cache | Second `kv run` within 15-min window         | Touch ID prompt (no passphrase re-entry)                         | N/A       | e2e        |
| **Cache** | Passphrase is not re-prompted on subsequent unlocks       | Run kv 3 times within session                | Passphrase prompt appears once; next 2 use cached DEK + Touch ID | N/A       | e2e        |

### Feature: Auto-lock on system sleep

| Feature   | Behavior to test                                       | Input / command                                  | Expected output                    | Exit code | Test layer |
| --------- | ------------------------------------------------------ | ------------------------------------------------ | ---------------------------------- | --------- | ---------- |
| **Sleep** | System sleep triggers DEK eviction from keychain cache | Computer sleeps, then wakes                      | Cached DEK removed from keychain   | N/A       | e2e        |
| **Sleep** | After wake, next kv access requires passphrase again   | After sleep, run `kv ls`                         | Passphrase prompt re-appears       | N/A       | e2e        |
| **Sleep** | OS sleep notification is detected and handled          | Register listener for sleep event, trigger sleep | Listener fires, eviction completed | N/A       | unit       |

### Feature: Auto-lock on idle timeout

| Feature  | Behavior to test                                     | Input / command                                            | Expected output                                      | Exit code | Test layer |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | --------- | ---------- |
| **Idle** | Default idle timeout is 15 minutes                   | No config set, check default constant                      | DEFAULT*IDLE_TIMEOUT_MS === 15 * 60 \_ 1000 (900000) | N/A       | unit       |
| **Idle** | After no kv access for 15 min, cached DEK is evicted | Last access at T=0, check at T=15m+1s                      | Keychain entry removed                               | N/A       | unit       |
| **Idle** | Next kv access requires passphrase again             | After 15-min idle, run `kv ls`                             | Passphrase prompt re-appears                         | N/A       | e2e        |
| **Idle** | Timeout is configurable                              | Set `KV_IDLE_TIMEOUT_SEC=300` (5 min), wait 5:01           | DEK evicted at 5-min mark, next run prompts          | N/A       | e2e        |
| **Idle** | Timer resets on each kv access                       | Access at T=0, idle 7:30, access at T=7:30, idle 7:30 more | Not evicted until T=15m from second access           | N/A       | e2e        |

### Feature: Explicit lock command (kv lock)

| Feature  | Behavior to test                                        | Input / command                    | Expected output                                              | Exit code | Test layer |
| -------- | ------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ | --------- | ---------- |
| **Lock** | `kv lock` command evicts cached DEK immediately         | Run `kv lock`                      | Keychain entry removed; next `kv run` prompts for passphrase | 0         | e2e        |
| **Lock** | Immediately after lock, next access requires passphrase | Lock, then immediately run `kv ls` | Passphrase prompt appears                                    | N/A       | e2e        |
| **Lock** | Succeeds silently if no DEK is cached                   | Run `kv lock` when no cache exists | No error; exit 0                                             | 0         | e2e        |

### Feature: Per-session access policy (user's own kv run)

| Feature         | Behavior to test                                          | Input / command                                             | Expected output                                                                | Exit code | Test layer |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- | ---------- |
| **Per-Session** | Touch ID released once per unlock window for personal use | Unlock with passphrase, run `kv run` 3 times within session | Touch ID prompt only on first unlock; next 2 runs use cached DEK (no Touch ID) | N/A       | e2e        |
| **Per-Session** | User does not re-auth on each kv run (smooth daily use)   | Daily workflow: passphrase once, then 10+ `kv run` commands | Passphrase prompted once at start of day; no re-auth needed                    | N/A       | e2e        |
| **Per-Session** | Access policy is per-session                              | Set access policy to 'per-session' in keychain              | Release count allows multiple reads within session window                      | N/A       | unit       |
| **Per-Session** | Policy dial is separate from per-use policy               | Inspect keychain access policy field                        | Distinct from per-use policy structure                                         | N/A       | unit       |

### Feature: Per-use access policy (agent-initiated access)

| Feature     | Behavior to test                                                       | Input / command                                                        | Expected output                                                 | Exit code | Test layer |
| ----------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- | --------- | ---------- |
| **Per-Use** | Agent-initiated access triggers Touch ID prompt on every single access | Agent (mock or real) requests 5 secrets within one session             | 5 separate Touch ID prompts, each one                           | N/A       | e2e        |
| **Per-Use** | Touch ID prompt shows which app is requesting                          | Capture Touch ID prompt text (or logs)                                 | Prompt includes app name (e.g., "Claude Code")                  | N/A       | e2e        |
| **Per-Use** | Touch ID prompt shows which keys are being accessed                    | Prompt text                                                            | Shows slugs/schema/fieldKeys for requested secrets (value-free) | N/A       | e2e        |
| **Per-Use** | Agent never sees passphrase or values                                  | Mock agent path with per-use policy                                    | Agent receives only 'ok' or 'denied'; never plaintext           | N/A       | unit       |
| **Per-Use** | Human fingerprint is structurally in the loop every time               | Disable Touch ID (simulate failure N times), agent still cannot access | Each agent request blocked at Touch ID gate                     | N/A       | unit       |

### Feature: SSH / no-Secure-Enclave passphrase fallback

| Feature | Behavior to test                                                     | Input / command                                                    | Expected output                                 | Exit code | Test layer |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | --------- | ---------- |
| **SSH** | Over SSH where keychain access is unavailable, prompt for passphrase | SSH into remote, run `kv run`                                      | Terminal prompt for passphrase (not Touch ID)   | N/A       | e2e        |
| **SSH** | Passphrase is typed at terminal (not stored)                         | Provide passphrase over SSH session, inspect memory/keychain after | Passphrase not persisted; not added to keychain | N/A       | e2e        |
| **SSH** | Derives AK, unwraps DEK, proceeds with injection                     | After passphrase entered, injection proceeds                       | Secret injected into child command              | N/A       | e2e        |
| **SSH** | No keychain caching on SSH sessions                                  | Run `kv run` twice over SSH with same session                      | Passphrase prompted both times (no cache)       | N/A       | e2e        |

### Feature: CI / KV_PASSPHRASE environment variable (opt-in)

| Feature | Behavior to test                           | Input / command                                                    | Expected output                                                   | Exit code | Test layer |
| ------- | ------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------- | --------- | ---------- |
| **CI**  | CI runner can supply KV_PASSPHRASE env var | `export KV_PASSPHRASE=mypass123; kv run openai -- node script.js`  | Injection proceeds without prompting                              | 0         | e2e        |
| **CI**  | Passphrase is read from env (not prompted) | Set KV_PASSPHRASE, run kv, check that no passphrase prompt appears | No interactive prompt                                             | N/A       | e2e        |
| **CI**  | Injection proceeds without keychain        | CI runner without keychain access                                  | DEK unwrapped from passphrase; injection succeeds                 | 0         | e2e        |
| **CI**  | Documented as deliberately-weaker mode     | README or docs mention KV_PASSPHRASE                               | Documentation states that CI mode is weaker than keychain cache   | N/A       | doc        |
| **CI**  | Per-secret injection preferred long-term   | Documentation or comments                                          | Notes that fine-grained per-secret CI tokens are future direction | N/A       | doc        |

### Feature: Passphrase-to-keychain cache wrapper (wrapKey / unwrapKey)

| Feature     | Behavior to test                                         | Input / command                                                 | Expected output                             | Exit code | Test layer |
| ----------- | -------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- | --------- | ---------- |
| **Wrapper** | wrapKey() encrypts DEK under AK using symmetric key wrap | Call `wrapKey(dek, ak)`                                         | Returns SealedBytes with nonce + ciphertext | N/A       | unit       |
| **Wrapper** | unwrapKey() decrypts DEK using AK                        | Call `unwrapKey(wrapped, ak)` where wrapped came from wrapKey() | Returns original DEK byte-for-byte          | N/A       | unit       |
| **Wrapper** | unwrapKey() rejects on wrong AK or tampering             | Call `unwrapKey(wrapped, wrongAK)` or flip a nonce bit          | Throws auth failure error                   | N/A       | unit       |
| **Wrapper** | Wrapped key is 32 bytes (enforced)                       | Call `wrapKey()` with non-32-byte DEK                           | Throws error: "DEK must be 32 bytes"        | N/A       | unit       |
| **Wrapper** | Uses domain-separated AEAD (kv:keywrap:v1)               | Inspect AAD in wrapKey() implementation                         | AAD constant = 'kv:keywrap:v1'              | N/A       | unit       |

### Feature: DEK indirection and wrapped-envelope store format

| Feature | Behavior to test                                     | Input / command                                                             | Expected output                                          | Exit code | Test layer |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | --------- | ---------- |
| **DEK** | Store keeps DEK wrapped under AK (not plaintext)     | Read store.json from disk                                                   | DEK not plaintext; visible as wrapped envelope field     | N/A       | e2e        |
| **DEK** | Unwrapping DEK does not require re-encrypting store  | Rotate unlock key (cache new DEK to keychain), payload unchanged            | Store file size identical before and after unlock change | N/A       | e2e        |
| **DEK** | Per-item can be re-keyed without store re-encryption | (Deferred P5+) Mechanism in place for rotating individual secret encryption | Architectural readiness for granular key rotation        | N/A       | doc        |
| **DEK** | Wrapped-envelope format is round-trippable           | Load store with wrapped DEK, unlock, re-save, load again                    | Data persists identically                                | N/A       | e2e        |

---

## 10. Security Invariants & Bounds

### Invariant: Agent cannot bypass admission

| Feature       | Behavior to test                                   | Input / command                                                                    | Expected output                                             | Exit code | Test layer      |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------- | --------------- |
| **Invariant** | Mock deny provider denies all admission requests   | Set mock provider to allow=false, call admission.admit()                           | No slug enters projectWorld                                 | N/A       | unit            |
| **Invariant** | With deny provider, no slug can be admitted        | Agent path uses deny-mock, attempt 10 admit requests                               | All 10 refused; projectWorld.size === 0                     | N/A       | unit            |
| **Invariant** | Agent path uses same admission flow as human path  | Trace code paths for agent vs user; both call admission.admit()                    | No alternate code path for agent-only admission             | N/A       | code-inspection |
| **Invariant** | Agent cannot take alternate code path to admission | Search for bypass: direct projectWorld.admit() calls not through admission.admit() | Zero direct calls; all flow through admission orchestration | N/A       | code-inspection |

### Invariant: Auth mandatory and called once per batch

| Feature       | Behavior to test                                                | Input / command                                                                                      | Expected output                                                                | Exit code | Test layer      |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- | --------------- |
| **Invariant** | Admitting N keys calls AuthProvider.authenticate() exactly once | admission.admit(store, projectWorld, mockProvider, ['s1', 's2', 's3']) with mock.callCount assertion | callCount === 1 (not 3)                                                        | N/A       | unit            |
| **Invariant** | Mock provider call count assertion succeeds                     | Assert `mockProvider.callCount === 1` after batch admit                                              | Assertion passes                                                               | N/A       | unit            |
| **Invariant** | No code path admits without calling authenticate()              | Code review of admission.ts                                                                          | All paths to projectWorld.admit() preceded by authProvider.authenticate() call | N/A       | code-inspection |
| **Invariant** | Single auth call admits all N keys atomically                   | Batch of 5 slugs, successful auth, check projectWorld                                                | All 5 present (not 4 if 1 admission fails partway)                             | N/A       | unit            |

### Invariant: Refusal admits nothing and audits

| Feature       | Behavior to test                                                  | Input / command                                                     | Expected output                              | Exit code | Test layer |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- | --------- | ---------- |
| **Invariant** | When auth returns ok: false, no slug enters project world         | admission.admit() with ok=false auth result                         | projectWorld.size === initial (no new slugs) | N/A       | unit       |
| **Invariant** | Project-world membership queries return false for requested slugs | After refused admission of ['openai/dev'], call `has('openai/dev')` | Returns false                                | N/A       | unit       |
| **Invariant** | Refused audit entry is recorded                                   | Check auditLog after refused admission                              | Entry with action='refused', matching slugs  | N/A       | unit       |
| **Invariant** | Subsequent injection attempts fail (not admitted)                 | After refused admission, attempt injection of refused slug          | Hard error: "not admitted"                   | 1         | unit       |

### Invariant: No-disk-write for plaintext

| Feature       | Behavior to test                                    | Input / command                                                | Expected output                                                               | Exit code | Test layer |
| ------------- | --------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ---------- |
| **Invariant** | Plaintext value never written to disk during kv run | Full `kv run` with file I/O mocking, inspect all write() calls | No unencrypted secret bytes in any write                                      | N/A       | unit       |
| **Invariant** | Only materialized 0600 file contains plaintext      | Exclude materialized temp file, scan rest of disk writes       | No other plaintext found                                                      | N/A       | unit       |
| **Invariant** | Env vars exist only in child process memory         | Parent and global process.env inspected                        | Secrets not in process.env; only in child's spawn env                         | N/A       | unit       |
| **Invariant** | Parent process env not mutated                      | process.env before and after `kv run`                          | Identical (no pollution)                                                      | N/A       | e2e        |
| **Invariant** | No temporary unencrypted files created              | Scan /tmp and ~/.kv for non-encrypted files during run         | No .txt, .tmp, or other plaintext files (except 0600 materialized during run) | N/A       | e2e        |

### Invariant: Unique inject name enforced at run time

| Feature       | Behavior to test                                                    | Input / command                                                   | Expected output                                      | Exit code | Test layer |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- | --------- | ---------- |
| **Invariant** | Duplicate env-var names in vault raise hard error at injection time | Vault: slot1 injects FIELD_A→MY_VAR, slot2 injects FIELD_B→MY_VAR | Error: "duplicate inject name: MY_VAR"               | 1         | unit       |
| **Invariant** | Error prevents silent shadowing                                     | Run with duplicate inject config                                  | Fails with error, not silently using last-write-wins | 1         | unit       |
| **Invariant** | Error is also caught at --dry-run                                   | `kv run --dry-run` with duplicate inject                          | Error caught before any execution                    | 1         | unit       |
| **Invariant** | Error lists which env-var name is duplicated                        | Error message                                                     | Names the env var (e.g., "MY_VAR")                   | 1         | unit       |

---

## Test Execution Notes

### KDF Parameters for Tests

When testing passphrase derivation or unlock with fast KDF params, use:

```ts
const fastKDF = { iterations: 2, memorySize: 8192, parallelism: 1 };
```

Never modify production defaults; keep tests fast by using fast params only in unit tests.

### Mocking & Isolation

- **AuthProvider**: Use MockAuthProvider (deny-allow config) for unit tests; real Touch ID integration tests isolated to e2e.
- **Keychain**: Mock OS keychain reads/writes in unit tests; real keychain tests are integration.
- **Filesystem**: Use temp directories; clean up after each test.
- **Output masking**: Capture child stdout/stderr; scan captured output for values.

### Cross-Platform Considerations

- **macOS**: Touch ID, LocalAuthentication, keychain support built in.
- **Linux/Windows**: SSH fallback and passphrase prompt tested; Touch ID integration deferred.
- **tmpfs on macOS**: No native tmpfs; materialize to `/var/tmp` at `0700` ownership.

### Entry Point & Dependencies

- All P4 tests depend on P0 crypto, P1 envelope, P3 store/vault/resolver being complete and tested.
- Test suite structure: `packages/core/src/{project-world,admission,run,audit,listing}/*.test.ts`.
- CLI wiring of these surfaces is P5; this phase proves programmatic core API only.

---

## Summary

This test plan specifies 80+ behaviors across 20+ features, organized by subsystem (project-world, admission, injection, masking, file materialization, dry-run, audit, listing, unlock/cache, security invariants). Every behavior is concrete: real inputs, expected outputs, exit codes, and test layer (unit vs. e2e). Implementation proceeds feature by feature, test-first, with each test passing before the next is written.
