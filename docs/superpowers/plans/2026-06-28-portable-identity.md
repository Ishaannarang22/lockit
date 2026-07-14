# Portable Secret Identity + Reference File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give secrets a canonical, origin-independent identity and a value-free `.env`-shaped reference file that auto-fills from the recipient's own store.

**Architecture:** A new `registry` module (core) supplies the canonical provider vocabulary; a `reference` module (core) parses/serializes `ENV=@ref` files; `resolveRef` (core) binds a reference to a stored secret strictly 0/1/N on the provider token; `import` (cli) stops using the CWD as identity; new `export`/`resolve` (cli) commands round-trip the reference file. No server.

**Tech Stack:** TypeScript (strict, ESM, `.js` import specifiers), vitest, pnpm workspace. Packages: `@lockit/core`, `@lockit/cli`.

## Global Constraints

- ESM with explicit `.js` extensions on relative imports.
- `core` may do file I/O but never imports `cli`; deps flow upward.
- Value-free surfaces only ever emit slug/schema/field-key/tag/`hasValue` — never a value. `export` output MUST contain no stored value (hard test).
- Strict 0/1/N resolution; never guess on ambiguity.
- TDD: failing test first, minimal impl, commit per task. Run `pnpm --filter <pkg> test`.
- Barrel re-exports in `packages/core/src/index.ts` are added by the orchestrator after each core module lands (subagents import module paths directly in tests).

---

### Task 1: Canonical provider registry (core)

**Files:**
- Create: `packages/core/src/registry/registry.ts`
- Test: `packages/core/src/registry/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RegistryEntry { provider: string; fields: string[]; env: Record<string, string[]>; match: string[] }`
  - `const builtinRegistry: RegistryEntry[]` — includes at least `openai` (`OPENAI_API_KEY`), `supabase` (`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`), and `pulse` (`API_KEY` → `PULSE_API_KEY`, match `["PULSE_API_KEY","PULSE_KEY"]`).
  - `function mergeRegistries(...lists: RegistryEntry[][]): RegistryEntry[]` — later lists override earlier by `provider`.
  - `function entryFor(registry: RegistryEntry[], provider: string): RegistryEntry | undefined`
  - `function providerForEnv(registry: RegistryEntry[], envName: string): string | undefined` — first entry whose `match` includes `envName`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { builtinRegistry, entryFor, mergeRegistries, providerForEnv } from "./registry.js";

describe("registry", () => {
  it("maps a known raw env name to its provider", () => {
    expect(providerForEnv(builtinRegistry, "PULSE_API_KEY")).toBe("pulse");
    expect(providerForEnv(builtinRegistry, "OPENAI_API_KEY")).toBe("openai");
  });
  it("returns undefined for an unknown env name", () => {
    expect(providerForEnv(builtinRegistry, "WHATEVER_TOKEN")).toBeUndefined();
  });
  it("later registries override earlier by provider", () => {
    const custom = [{ provider: "pulse", fields: ["KEY"], env: { KEY: ["PULSE_API_KEY"] }, match: ["X"] }];
    const merged = mergeRegistries(builtinRegistry, custom);
    expect(entryFor(merged, "pulse")?.fields).toEqual(["KEY"]);
    expect(providerForEnv(merged, "X")).toBe("pulse");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @lockit/core test registry` → FAIL (module not found).
- [ ] **Step 3: Implement** `RegistryEntry`, the three functions, and `builtinRegistry`. `mergeRegistries` builds a `Map<string, RegistryEntry>` keyed by `provider`, applying lists left→right so later wins.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** `feat(core): canonical provider registry (built-in + mergeable)`.

---

### Task 2: Reference-file parse/serialize (core)

**Files:**
- Create: `packages/core/src/env/reference.ts`
- Test: `packages/core/src/env/reference.test.ts`

**Interfaces:**
- Consumes: nothing (does not depend on Task 1).
- Produces:
  - `interface Reference { envName: string; ref: string }` — `ref` is the token after `@`, e.g. `pulse`, `supabase/acme`, `supabase/acme#SUPABASE_URL`.
  - `function parseReferences(text: string): Reference[]` — parses `ENV_NAME=@ref` lines; ignores blanks/`#`-comments; throws on a line whose value does not start with `@` (naming the 1-based line number), since a reference file must never carry a value.
  - `function serializeReferences(refs: Reference[]): string` — emits `ENV_NAME=@ref\n` per entry.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseReferences, serializeReferences } from "./reference.js";

describe("reference file", () => {
  it("round-trips env name and ref", () => {
    const text = "PULSE_API_KEY=@pulse\nSUPABASE_URL=@supabase/acme#SUPABASE_URL\n";
    const refs = parseReferences(text);
    expect(refs).toEqual([
      { envName: "PULSE_API_KEY", ref: "pulse" },
      { envName: "SUPABASE_URL", ref: "supabase/acme#SUPABASE_URL" },
    ]);
    expect(serializeReferences(refs)).toBe(text);
  });
  it("rejects a line carrying a real value (no @)", () => {
    expect(() => parseReferences("PULSE_API_KEY=sk-live-123")).toThrow(/line 1/);
  });
});
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement.** Reuse the line-splitting shape of `parseDotenv` (skip blanks/comments, find `=`, validate key via `isValidFieldKey`), then require the value to start with `@` and strip it into `ref`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** `feat(core): value-free reference-file parse/serialize`.

---

### Task 3: resolveRef — bind a reference to a stored secret (core)

**Files:**
- Modify: `packages/core/src/store/resolve.ts`
- Test: `packages/core/src/store/resolve.test.ts` (add cases)

**Interfaces:**
- Consumes: `StoreData`, `StoredField` from `./store.js`.
- Produces:
  - `type RefResolveResult = { status: "found"; bundle: string; field: StoredField } | { status: "none" } | { status: "ambiguous"; bundles: string[] }`
  - `function resolveRef(store: StoreData, ref: string): RefResolveResult`

**Resolution rule** (ref already has `@` stripped; optional `#FIELD` suffix):
- Split off `#FIELD` if present. Left part is the locator.
- If locator contains `/` → exact slug match (`s.slug === locator` or `s.aka.includes(locator)`).
- Else (provider token) → candidates are secrets where `s.schema === locator` OR the slug's first `/`-segment === locator. 0 → none; >1 distinct slugs → ambiguous; exactly 1 → that secret.
- Field selection on the chosen secret: if `#FIELD` given, that field (or `none`); else if the secret has exactly one field, use it; else `ambiguous` (bundles = [slug]).

- [ ] **Step 1: Write failing tests**

```ts
import { resolveRef } from "./resolve.js";
import { emptyStore, upsertField } from "./store.js";

const withPulse = upsertField(emptyStore(), { slug: "pulse", schema: "pulse", key: "API_KEY", type: "env", value: "v" });

it("resolves a provider ref to its single-field secret", () => {
  const r = resolveRef(withPulse, "pulse");
  expect(r).toEqual({ status: "found", bundle: "pulse", field: { key: "API_KEY", type: "env", value: "v" } });
});
it("returns none when no secret of that provider exists", () => {
  expect(resolveRef(emptyStore(), "pulse")).toEqual({ status: "none" });
});
it("is ambiguous when two secrets share the provider", () => {
  const two = upsertField(upsertField(emptyStore(),
    { slug: "pulse/a", schema: "pulse", key: "API_KEY", type: "env", value: "1" }),
    { slug: "pulse/b", schema: "pulse", key: "API_KEY", type: "env", value: "2" });
  expect(resolveRef(two, "pulse")).toEqual({ status: "ambiguous", bundles: ["pulse/a", "pulse/b"] });
});
it("resolves an explicit slug#FIELD", () => {
  expect(resolveRef(withPulse, "pulse#API_KEY").status).toBe("found");
});
```

- [ ] **Step 2–4:** verify fail, implement `resolveRef` (leave existing `resolveVar` untouched), verify pass.
- [ ] **Step 5: Commit** `feat(core): resolveRef — strict 0/1/N reference binding on provider token`.

---

### Task 4: Import derives canonical identity, demotes provenance to a tag (cli)

**Files:**
- Modify: `packages/cli/src/import.ts`
- Test: `packages/cli/src/import.test.ts` (add cases)
- Modify: `packages/core/src/store/store.ts` — add `addTag(store, slug, tag)` helper (copy-on-write) **(orchestrator adds barrel export)**.

**Interfaces:**
- Consumes: `providerForEnv`, `builtinRegistry` (Task 1); `upsertField`, `addTag` (core).
- Produces: changed `cmdImport` behavior (no new exported signature).

**Behavior change:**
- Remove the `slugifyDir(basename(process.cwd()))` default. For each parsed entry: `provider = providerForEnv(registry, entry.key) ?? fallback`, where `fallback` is the lowercased env key's leading segment (NOT the CWD). Slug = `provider`; schema = `provider`.
- After upserting a provider's fields, tag that secret `source:<cwd-basename>` via `addTag`.
- `--as <slug>` still overrides (all vars go under that slug, as today).

- [ ] **Step 1: Write failing test** (core `addTag` first, then import):

```ts
// import.test.ts — run in a tmp HOME with cwd basename "plugin-manager"
it("imports PULSE_API_KEY as provider 'pulse', not the cwd, and tags the source", async () => {
  // ...write .env "PULSE_API_KEY=sk-1", run cmdImport...
  const store = await loadStore(pass, sp);
  const sec = store.secrets.find((s) => s.slug === "pulse");
  expect(sec).toBeDefined();
  expect(sec!.tags).toContain("source:plugin-manager");
  expect(store.secrets.some((s) => s.slug === "plugin-manager")).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** `addTag` in core (copy-on-write, dedupe), then rewire `cmdImport`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** `feat(cli): import derives canonical provider identity; provenance becomes a tag`.

---

### Task 5: `lockit export` writes a value-free reference file (cli)

**Files:**
- Create: `packages/cli/src/export.ts`
- Test: `packages/cli/src/export.test.ts`
- Modify: `packages/cli/src/index.ts` — dispatch `export`.

**Interfaces:**
- Consumes: `loadStore`, `storePath`, `serializeReferences` (Task 2), `builtinRegistry`/`entryFor` (Task 1), `Io`/`resolveKey`.
- Produces: `function cmdExport(io: Io): Promise<number>`.

**Behavior:** load store; for each secret, for each `env`-type field, emit a `Reference { envName, ref }` where `envName` is the registry's conventional env name for that field (fallback: the field key) and `ref` is the secret's `provider` (slug's leading segment) — or `slug#FIELD` when the secret has multiple fields. Write via `serializeReferences` to `--out <path>` (default `./.env.ref`). **Never write a value.**

- [ ] **Step 1: Write failing test** — the security-critical one:

```ts
it("export output contains only @refs, never a stored value", async () => {
  // store has pulse/API_KEY = "sk-SECRET-123"
  const code = await cmdExport(io);
  expect(code).toBe(0);
  const text = await readFile(outPath, "utf8");
  expect(text).toContain("PULSE_API_KEY=@pulse");
  expect(text).not.toContain("sk-SECRET-123");
});
```

- [ ] **Step 2–4:** verify fail, implement, verify pass.
- [ ] **Step 5: Commit** `feat(cli): lockit export — value-free reference file`.

---

### Task 6: `lockit resolve` fills a .env from references, gated by admission (cli)

**Files:**
- Create: `packages/cli/src/resolve-cmd.ts`
- Test: `packages/cli/src/resolve-cmd.test.ts`
- Modify: `packages/cli/src/index.ts` — dispatch `resolve`.

**Interfaces:**
- Consumes: `parseReferences` (Task 2), `resolveRef` (Task 3), `loadStore`, `mergeDotenv`, the existing authorizer (`Io.authorize` / `authorize.ts`).
- Produces: `function cmdResolve(io: Io): Promise<number>`.

**Behavior:** read reference file (`argv[0]` or `./.env.ref`); `parseReferences`; `resolveRef` each. Collect `found` → `{ key: envName, value: field.value }`. If any `ambiguous`/`none`, print a value-free report and exit non-zero (never guess). Before writing values, call the authorizer once (batch admission) listing the providers; on deny, exit non-zero and write nothing. On allow, `mergeDotenv` into `./.env`. Print chosen slugs ("auto-fill but tell me").

- [ ] **Step 1: Write failing test** (inject an `Io` whose authorizer returns true):

```ts
it("resolves references against the local store and writes the .env on admit", async () => {
  // store owns pulse/API_KEY = "my-own-key"; ref file "PULSE_API_KEY=@pulse"
  const code = await cmdResolve(io); // io.authorize -> true
  expect(code).toBe(0);
  expect(await readFile(envPath, "utf8")).toContain("PULSE_API_KEY=my-own-key");
});
it("writes nothing when admission is denied", async () => {
  const code = await cmdResolve(denyIo); // io.authorize -> false
  expect(code).not.toBe(0);
  expect(existsSync(envPath)).toBe(false);
});
```

- [ ] **Step 2–4:** verify fail, implement, verify pass.
- [ ] **Step 5: Commit** `feat(cli): lockit resolve — admission-gated fill from references`.

---

### Task 7: End-to-end round-trip (e2e)

**Files:**
- Create: `e2e/portable-identity.e2e.test.ts`

**Behavior:** in two separate sandbox HOMEs (helpers in `e2e/helpers.ts`):
1. HOME-A: `import` a `.env` with `PULSE_API_KEY=alice-key` → asserts slug `pulse`.
2. HOME-A: `export` → `.env.ref` contains `PULSE_API_KEY=@pulse`, no value.
3. HOME-B: `set pulse API_KEY=bob-key` (B owns its own key).
4. HOME-B: `resolve .env.ref` (auto-authorized) → `.env` contains `PULSE_API_KEY=bob-key` (B's own value, never A's).

- [ ] **Step 1: Write the e2e test** using the existing `runLockit` harness.
- [ ] **Step 2: Run** `pnpm test:e2e` (or the configured e2e command) → PASS.
- [ ] **Step 3: Commit** `test(e2e): portable-identity import→export→resolve round-trip`.

---

## Self-Review

- **Spec coverage:** §5 registry → Task 1; §7 reference file → Tasks 2/5/6; §6 import identity + provenance tag → Task 4; §8 resolveRef 0/1/N → Task 3; §9 admission gate → Task 6; §12 tests → all tasks + Task 7. Covered.
- **Type consistency:** `RegistryEntry`, `Reference`, `RefResolveResult`, `resolveRef`, `providerForEnv`, `mergeRegistries`, `entryFor`, `addTag`, `cmdExport`, `cmdResolve` used consistently across tasks.
- **Placeholders:** none; each task carries concrete test + behavior.

## Wave ordering (for parallel subagents)

- **Wave 1 (parallel):** Task 1 (registry), Task 2 (reference) — independent, different files.
- **Wave 2 (parallel):** Task 3 (resolveRef, needs store only), Task 4 (import, needs Task 1).
- **Wave 3 (parallel):** Task 5 (export, needs 1+2), Task 6 (resolve, needs 2+3).
- **Wave 4:** Task 7 (e2e, needs all).
