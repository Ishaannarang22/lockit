# Mode 1 Convenience Locker (`import` + `pull`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a convenience "locker" to the `lockit` CLI — `import` a `.env` into the encrypted store, and `pull` real values back into a project's `.env`, gated by a human authorization on `/dev/tty`.

**Architecture:** Pure logic (`.env` parse/merge, variable resolution) lives in `@lockit/core` and is unit-tested with no I/O. The `@lockit/cli` commands (`import`, `pull`, `ls --vars`) do filesystem and terminal I/O behind the existing injectable `Io` seam, plus one new `authorize` port so the human gate can be faked in tests. `@lockit/crypto` is untouched.

**Tech Stack:** TypeScript (ESM, strict), Node ≥20, pnpm workspace, vitest. Imports use explicit `.js` extensions. Tests follow the existing pattern: a temp `LOCKIT_HOME` and an `Io` built in-test with `out`/`err` collectors.

## Global Constraints

- **Invariant #1 — the agent never obtains a plaintext value.** `pull` writes plaintext, so it MUST require `io.authorize()` to resolve non-null before writing a single byte. The real authorizer prompts on `/dev/tty`, never stdin.
- **References, not guesses — strict 0/1/N resolver.** A bare variable matching two bundles is a hard `AMBIGUOUS` error, never a guess.
- **`crypto` and `core` stay pure / no-I/O** for the parts that live there. Parsing, merging, and resolving take strings/objects and return strings/objects.
- **lockit's own stdout/stderr stay value-free.** Secret values appear only inside the file `pull` writes. Variable *names* (keys) are not secret and may be printed.
- **Created secret files are mode `0600`.**
- **TDD, conventional commits, one deliverable per task.**
- **Field key validity** reuses `isValidFieldKey` (regex `^[A-Za-z_][A-Za-z0-9_]*$`). **Slug validity** reuses `isValidSlug`.

---

### Task 1: `.env` parser — `parseDotenv`

**Files:**
- Create: `packages/core/src/env/dotenv.ts`
- Test: `packages/core/src/env/dotenv.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `isValidFieldKey` from `../store/store.js`.
- Produces: `interface DotenvEntry { key: string; value: string }` and `parseDotenv(text: string): DotenvEntry[]` (throws `Error` naming the 1-based line number on a malformed line).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/env/dotenv.test.ts
import { describe, it, expect } from "vitest";
import { parseDotenv } from "./dotenv.js";

describe("parseDotenv", () => {
  it("parses plain KEY=VALUE", () => {
    expect(parseDotenv("FOO=bar")).toEqual([{ key: "FOO", value: "bar" }]);
  });
  it("strips an `export ` prefix", () => {
    expect(parseDotenv("export FOO=bar")).toEqual([{ key: "FOO", value: "bar" }]);
  });
  it("strips matching single or double quotes", () => {
    expect(parseDotenv(`A="x y"\nB='z'`)).toEqual([
      { key: "A", value: "x y" },
      { key: "B", value: "z" },
    ]);
  });
  it("ignores blank lines and # comments", () => {
    expect(parseDotenv("\n# c\nFOO=bar\n")).toEqual([{ key: "FOO", value: "bar" }]);
  });
  it("tolerates CRLF endings", () => {
    expect(parseDotenv("FOO=bar\r\nBAZ=qux")).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });
  it("keeps `=` characters inside the value", () => {
    expect(parseDotenv("URL=postgres://a:b@h/d?x=1")).toEqual([
      { key: "URL", value: "postgres://a:b@h/d?x=1" },
    ]);
  });
  it("last duplicate key wins via consumer upsert (parser keeps both)", () => {
    expect(parseDotenv("FOO=1\nFOO=2")).toEqual([
      { key: "FOO", value: "1" },
      { key: "FOO", value: "2" },
    ]);
  });
  it("throws naming the line number on a line with no `=`", () => {
    expect(() => parseDotenv("FOO=bar\noops")).toThrow(/line 2/);
  });
  it("throws naming the line number on an invalid key", () => {
    expect(() => parseDotenv("1BAD=x")).toThrow(/line 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/core test -- dotenv`
Expected: FAIL — `Cannot find module './dotenv.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/env/dotenv.ts
import { isValidFieldKey } from "../store/store.js";

export interface DotenvEntry {
  key: string;
  value: string;
}

/** Strip one matching pair of surrounding single or double quotes. */
function unquote(raw: string): string {
  if (raw.length >= 2) {
    const a = raw[0];
    const b = raw[raw.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return raw.slice(1, -1);
  }
  return raw;
}

/** Parse `.env`-format text into ordered entries. Throws on a malformed line,
 *  naming the 1-based line number. Does not deduplicate — the caller upserts. */
export function parseDotenv(text: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) throw new Error(`malformed .env line ${i + 1}: no "=" found`);
    const key = withoutExport.slice(0, eq).trim();
    if (!isValidFieldKey(key)) throw new Error(`malformed .env line ${i + 1}: invalid key ${JSON.stringify(key)}`);
    const value = unquote(withoutExport.slice(eq + 1).trim());
    entries.push({ key, value });
  }
  return entries;
}
```

Add to `packages/core/src/index.ts`:

```ts
export { parseDotenv } from "./env/dotenv.js";
export type { DotenvEntry } from "./env/dotenv.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/core test -- dotenv` → Expected: PASS (all cases).
Run: `pnpm --filter @lockit/core typecheck` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/env/dotenv.ts packages/core/src/env/dotenv.test.ts packages/core/src/index.ts
git commit -m "feat(core): parseDotenv — strict .env parser with line-numbered errors"
```

---

### Task 2: `.env` merge — `mergeDotenv`

**Files:**
- Modify: `packages/core/src/env/dotenv.ts`
- Test: `packages/core/src/env/dotenv.test.ts` (add a `mergeDotenv` describe block)
- Modify: `packages/core/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `DotenvEntry` from Task 1.
- Produces: `interface MergeResult { text: string; wrote: string[]; skipped: string[] }` and `mergeDotenv(existingText: string, entries: DotenvEntry[], opts: { force: boolean }): MergeResult`.
- Behavior: a key already present in `existingText` is **skipped** unless `force`. With `force`, the existing line(s) for that key are dropped and the new value appended (surrounding lines untouched). Present-key detection is a tolerant regex scan — it never throws on weird existing content.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/core/src/env/dotenv.test.ts
import { mergeDotenv } from "./dotenv.js";

describe("mergeDotenv", () => {
  it("appends new keys to empty text with a trailing newline", () => {
    const r = mergeDotenv("", [{ key: "FOO", value: "bar" }], { force: false });
    expect(r.text).toBe("FOO=bar\n");
    expect(r.wrote).toEqual(["FOO"]);
    expect(r.skipped).toEqual([]);
  });
  it("skips a key already present, leaving the file unchanged", () => {
    const r = mergeDotenv("FOO=old\n", [{ key: "FOO", value: "new" }], { force: false });
    expect(r.text).toBe("FOO=old\n");
    expect(r.wrote).toEqual([]);
    expect(r.skipped).toEqual(["FOO"]);
  });
  it("force overwrites a present key, preserving other lines", () => {
    const r = mergeDotenv("KEEP=1\nFOO=old\n", [{ key: "FOO", value: "new" }], { force: true });
    expect(r.text).toBe("KEEP=1\nFOO=new\n");
    expect(r.wrote).toEqual(["FOO"]);
    expect(r.skipped).toEqual([]);
  });
  it("quotes a value containing whitespace when serializing", () => {
    const r = mergeDotenv("", [{ key: "A", value: "x y" }], { force: false });
    expect(r.text).toBe('A="x y"\n');
  });
  it("appends after existing content without a trailing newline", () => {
    const r = mergeDotenv("KEEP=1", [{ key: "FOO", value: "bar" }], { force: false });
    expect(r.text).toBe("KEEP=1\nFOO=bar\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/core test -- dotenv`
Expected: FAIL — `mergeDotenv is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to packages/core/src/env/dotenv.ts
export interface MergeResult {
  text: string;
  wrote: string[];
  skipped: string[];
}

const KEY_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** The key a line assigns, or null for blanks/comments/other lines. */
function lineKey(line: string): string | null {
  const m = KEY_LINE_RE.exec(line.endsWith("\r") ? line.slice(0, -1) : line);
  return m ? (m[1] ?? null) : null;
}

/** Serialize a value, quoting only when it contains whitespace, `#`, or quotes. */
function serializeValue(value: string): string {
  return /[\s#'"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Merge entries into `.env` text. Present keys are skipped unless `force`,
 *  in which case their existing lines are dropped and the new value appended. */
export function mergeDotenv(
  existingText: string,
  entries: DotenvEntry[],
  opts: { force: boolean },
): MergeResult {
  const present = new Set<string>();
  for (const line of existingText.split("\n")) {
    const k = lineKey(line);
    if (k) present.add(k);
  }
  const entryKeys = new Set(entries.map((e) => e.key));

  let baseText = existingText;
  const wrote: string[] = [];
  const skipped: string[] = [];
  let toAppend: DotenvEntry[];

  if (opts.force) {
    baseText = existingText
      .split("\n")
      .filter((line) => {
        const k = lineKey(line);
        return !(k !== null && entryKeys.has(k));
      })
      .join("\n");
    toAppend = entries;
    for (const e of entries) wrote.push(e.key);
  } else {
    toAppend = [];
    for (const e of entries) {
      if (present.has(e.key)) skipped.push(e.key);
      else {
        toAppend.push(e);
        wrote.push(e.key);
      }
    }
  }

  let text = baseText;
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  for (const e of toAppend) text += `${e.key}=${serializeValue(e.value)}\n`;
  return { text, wrote, skipped };
}
```

Add to `packages/core/src/index.ts`:

```ts
export { mergeDotenv } from "./env/dotenv.js";
export type { MergeResult } from "./env/dotenv.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/core test -- dotenv` → Expected: PASS.
Run: `pnpm --filter @lockit/core typecheck` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/env/dotenv.ts packages/core/src/env/dotenv.test.ts packages/core/src/index.ts
git commit -m "feat(core): mergeDotenv — skip-by-default / force-overwrite .env merge"
```

---

### Task 3: variable resolver — `resolveVar`

**Files:**
- Create: `packages/core/src/store/resolve.ts`
- Test: `packages/core/src/store/resolve.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `StoreData`, `StoredField` from `./store.js`.
- Produces:
  ```ts
  export type ResolveResult =
    | { status: "found"; bundle: string; field: StoredField }
    | { status: "none" }
    | { status: "ambiguous"; bundles: string[] };
  export function resolveVar(store: StoreData, name: string): ResolveResult;
  ```
- A `name` of the form `bundle#KEY` resolves against that exact bundle. A bare `KEY` scans all bundles: 0 → `none`, 1 → `found`, ≥2 → `ambiguous` with sorted unique bundle slugs.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/store/resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolveVar } from "./resolve.js";
import { upsertField } from "./store.js";
import { emptyStore } from "./store.js";

function withField(store = emptyStore(), slug: string, key: string, value: string) {
  return upsertField(store, { slug, schema: slug.split("/")[0] ?? slug, key, type: "env", value });
}

describe("resolveVar", () => {
  it("returns none when no bundle has the variable", () => {
    expect(resolveVar(emptyStore(), "FOO")).toEqual({ status: "none" });
  });
  it("returns found for a unique bare variable", () => {
    const s = withField(undefined, "app/dev", "FOO", "bar");
    expect(resolveVar(s, "FOO")).toEqual({
      status: "found",
      bundle: "app/dev",
      field: { key: "FOO", type: "env", value: "bar" },
    });
  });
  it("returns ambiguous with sorted bundles when two bundles share a name", () => {
    let s = withField(undefined, "b/dev", "FOO", "1");
    s = withField(s, "a/dev", "FOO", "2");
    expect(resolveVar(s, "FOO")).toEqual({ status: "ambiguous", bundles: ["a/dev", "b/dev"] });
  });
  it("resolves a bundle#KEY qualifier directly, bypassing ambiguity", () => {
    let s = withField(undefined, "b/dev", "FOO", "1");
    s = withField(s, "a/dev", "FOO", "2");
    expect(resolveVar(s, "a/dev#FOO")).toEqual({
      status: "found",
      bundle: "a/dev",
      field: { key: "FOO", type: "env", value: "2" },
    });
  });
  it("returns none for a qualifier whose bundle lacks the key", () => {
    const s = withField(undefined, "a/dev", "FOO", "1");
    expect(resolveVar(s, "a/dev#NOPE")).toEqual({ status: "none" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/core test -- resolve`
Expected: FAIL — `Cannot find module './resolve.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/store/resolve.ts
import type { StoreData, StoredField } from "./store.js";

export type ResolveResult =
  | { status: "found"; bundle: string; field: StoredField }
  | { status: "none" }
  | { status: "ambiguous"; bundles: string[] };

/** Resolve a variable name (bare `KEY` or qualified `bundle#KEY`) to a single
 *  field, strictly 0/1/N. Never guesses on ambiguity. */
export function resolveVar(store: StoreData, name: string): ResolveResult {
  const hash = name.indexOf("#");
  if (hash !== -1) {
    const bundle = name.slice(0, hash);
    const key = name.slice(hash + 1);
    const sec = store.secrets.find((s) => s.slug === bundle);
    const field = sec?.fields.find((f) => f.key === key);
    return field ? { status: "found", bundle, field } : { status: "none" };
  }
  const matches: { bundle: string; field: StoredField }[] = [];
  for (const sec of store.secrets) {
    const field = sec.fields.find((f) => f.key === name);
    if (field) matches.push({ bundle: sec.slug, field });
  }
  if (matches.length === 0) return { status: "none" };
  if (matches.length === 1) {
    const m = matches[0]!;
    return { status: "found", bundle: m.bundle, field: m.field };
  }
  const bundles = [...new Set(matches.map((m) => m.bundle))].sort();
  return { status: "ambiguous", bundles };
}
```

Add to `packages/core/src/index.ts`:

```ts
export { resolveVar } from "./store/resolve.js";
export type { ResolveResult } from "./store/resolve.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/core test -- resolve` → Expected: PASS.
Run: `pnpm --filter @lockit/core typecheck` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/resolve.ts packages/core/src/store/resolve.test.ts packages/core/src/index.ts
git commit -m "feat(core): resolveVar — strict 0/1/N variable resolver with bundle#KEY qualifier"
```

---

### Task 4: `lockit import`

**Files:**
- Create: `packages/cli/src/import.ts`
- Test: `packages/cli/src/import.test.ts`
- Modify: `packages/cli/src/index.ts` (dispatch `import`)

**Interfaces:**
- Consumes: `Io` from `./commands.js`; `parseDotenv`, `loadStore`, `saveStore`, `storePath`, `upsertField`, `emptyStore` from `@lockit/core`.
- Produces: `cmdImport(io: Io): Promise<number>`. Reads `argv[0]` (default `./.env`) and an optional `--as <slug>` (default: a slug derived from the basename of `process.cwd()`). Stores each variable as an `env`-type field. Never modifies the source file. Returns 0 on success, 1 on any error (missing file, parse error, missing passphrase) with nothing persisted.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/import.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdImport } from "./import.js";
import { cmdLs } from "./commands.js";
import type { Io } from "./commands.js";

const PASS = "test-passphrase";

function makeIo(argv: string[], home: string): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: "",
    env: { ...process.env, LOCKIT_HOME: home, LOCKIT_PASSPHRASE: PASS } as NodeJS.ProcessEnv,
    stdout: "",
    stderr: "",
    out(s: string) { (this as { stdout: string }).stdout += s; },
    err(s: string) { (this as { stderr: string }).stderr += s; },
  };
  return io as Io & { stdout: string; stderr: string };
}

describe("cmdImport", () => {
  let home: string;
  let dir: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    dir = mkdtempSync(join(tmpdir(), "lockit-proj-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports every var under an explicit --as slug and lists them value-free", async () => {
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "FOO=bar\nAPI_KEY=sk-live-123\n");
    const imp = makeIo([envFile, "--as", "app/dev"], home);
    expect(await cmdImport(imp)).toBe(0);

    const ls = makeIo(["--vars"], home);
    expect(await cmdLs(ls)).toBe(0);
    expect(ls.stdout).toContain("FOO");
    expect(ls.stdout).toContain("API_KEY");
    expect(ls.stdout).toContain("app/dev");
    expect(ls.stdout).not.toContain("sk-live-123");
  });

  it("returns 1 and stores nothing on a parse error", async () => {
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "FOO=bar\nBROKEN_LINE\n");
    const imp = makeIo([envFile, "--as", "app/dev"], home);
    expect(await cmdImport(imp)).toBe(1);
    expect(imp.stderr).toContain("line 2");

    const ls = makeIo(["--vars"], home);
    await cmdLs(ls);
    expect(ls.stdout).toBe("");
  });

  it("returns 1 with a clear error when the file is missing", async () => {
    const imp = makeIo([join(dir, "nope.env"), "--as", "app/dev"], home);
    expect(await cmdImport(imp)).toBe(1);
    expect(imp.stderr.toLowerCase()).toContain("no such file");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/cli test -- import`
Expected: FAIL — `Cannot find module './import.js'` (and `cmdLs` has no `--vars` yet; that lands in Task 5 — for now expect the import-not-found failure).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/import.ts
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  emptyStore,
  loadStore,
  parseDotenv,
  saveStore,
  storePath,
  upsertField,
} from "@lockit/core";
import type { Io } from "./commands.js";

/** Turn an arbitrary directory name into a valid lowercase slug segment. */
function slugifyDir(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return s.length > 0 ? s : "imported";
}

function passphraseOrError(io: Io): string | undefined {
  const passphrase = io.env.LOCKIT_PASSPHRASE;
  if (passphrase === undefined || passphrase.length === 0) {
    io.err("LOCKIT_PASSPHRASE is not set\n");
    return undefined;
  }
  return passphrase;
}

/** `lockit import [path] [--as <slug>]` — read a .env into the encrypted store. */
export async function cmdImport(io: Io): Promise<number> {
  const passphrase = passphraseOrError(io);
  if (passphrase === undefined) return 1;

  let path: string | undefined;
  let slug: string | undefined;
  for (let i = 0; i < io.argv.length; i++) {
    const arg = io.argv[i] ?? "";
    if (arg === "--as") {
      const next = io.argv[i + 1];
      if (next === undefined || next.length === 0) {
        io.err("--as requires a non-empty slug\n");
        return 1;
      }
      slug = next;
      i++;
    } else if (path === undefined) {
      path = arg;
    }
  }
  const filePath = path ?? "./.env";
  const resolvedSlug = slug ?? slugifyDir(basename(process.cwd()));
  const schema = resolvedSlug.split("/")[0] ?? resolvedSlug;

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let entries;
  try {
    entries = parseDotenv(text);
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let store;
  try {
    store = await loadStore(passphrase, storePath());
  } catch {
    store = emptyStore();
  }
  for (const entry of entries) {
    store = upsertField(store, {
      slug: resolvedSlug,
      schema,
      key: entry.key,
      type: "env",
      value: entry.value,
    });
  }
  await saveStore(store, passphrase, storePath());

  io.out(`imported ${entries.length} var(s) into ${resolvedSlug}\n`);
  return 0;
}
```

Add `import` dispatch in `packages/cli/src/index.ts` (inside `main`, alongside the existing `set`/`ls`/`run` blocks):

```ts
import { cmdImport } from "./import.js";
// ...
if (command === "import") {
  const io: Io = { argv, stdin: "", env: process.env, out, err };
  return await cmdImport(io);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/cli test -- import`
Expected: the file-missing and parse-error cases PASS; the `--vars` listing assertion still FAILS until Task 5. (That is expected — proceed to Task 5, which makes it pass.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/import.ts packages/cli/src/import.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): lockit import — load a .env into the encrypted store"
```

---

### Task 5: `lockit ls --vars` discovery view

**Files:**
- Modify: `packages/cli/src/commands.ts` (extend `cmdLs`)
- Test: `packages/cli/src/commands.test.ts` (add a `--vars` describe block)

**Interfaces:**
- Consumes: `listSecrets` (already imported in `commands.ts`).
- Produces: when `argv` contains `--vars`, `cmdLs` prints one line per variable: `${key}  [${slug}]  ${hasValue ? "hasValue" : "empty"}`, sorted by key then slug. Without `--vars`, behavior is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/cli/src/commands.test.ts (reuse the file's existing Io/home harness)
describe("cmdLs --vars (variable discovery)", () => {
  it("lists each variable with its bundle, value-free and sorted", async () => {
    // store is seeded by the surrounding suite's beforeEach via cmdSet;
    // here assume two fields exist: app/dev#FOO and app/dev#BAR.
    const ls = makeIo(["--vars"]); // makeIo per the existing suite helper
    expect(await cmdLs(ls)).toBe(0);
    const lines = ls.err === "" ? ls.out.trim().split("\n") : [];
    expect(lines[0]).toMatch(/^BAR\s+\[app\/dev\]\s+hasValue$/);
    expect(lines[1]).toMatch(/^FOO\s+\[app\/dev\]\s+hasValue$/);
    expect(ls.out).not.toMatch(/sk-|secret|value-bytes/);
  });
});
```

> Note for the implementer: match the existing `makeIo`/seed pattern already used in `commands.test.ts`. Seed `app/dev#FOO` and `app/dev#BAR` via `cmdSet` in a `beforeEach`, mirroring the current `cmdLs` tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/cli test -- commands`
Expected: FAIL — `--vars` output is empty / unformatted.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `cmdLs` in `packages/cli/src/commands.ts` with:

```ts
export async function cmdLs(io: Io): Promise<number> {
  const passphrase = passphraseOrError(io);
  if (passphrase === undefined) return 1;

  const store = await loadStore(passphrase, storePath());

  if (io.argv.includes("--vars")) {
    const rows: { key: string; slug: string; hasValue: boolean }[] = [];
    for (const secret of listSecrets(store)) {
      for (const f of secret.fields) rows.push({ key: f.key, slug: secret.slug, hasValue: f.hasValue });
    }
    rows.sort((a, b) => a.key.localeCompare(b.key) || a.slug.localeCompare(b.slug));
    for (const r of rows) io.out(`${r.key}  [${r.slug}]  ${r.hasValue ? "hasValue" : "empty"}\n`);
    return 0;
  }

  for (const secret of listSecrets(store)) {
    const keys = secret.fields.map((f) => f.key).join(",");
    io.out(`${secret.slug}  [${secret.schema}]  ${keys}\n`);
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/cli test -- commands` → Expected: PASS (including the prior `cmdLs` tests).
Run: `pnpm --filter @lockit/cli test -- import` → Expected: now fully PASS (the Task 4 `--vars` assertion resolves).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands.ts packages/cli/src/commands.test.ts
git commit -m "feat(cli): lockit ls --vars — value-free per-variable discovery view"
```

---

### Task 6: `lockit pull` (logic, with an injected `authorize` port)

**Files:**
- Modify: `packages/cli/src/commands.ts` (add `authorize?` to `Io`)
- Create: `packages/cli/src/pull.ts`
- Test: `packages/cli/src/pull.test.ts`

**Interfaces:**
- Consumes: `Io` (now with optional `authorize?: () => Promise<string | null>`); `resolveVar`, `getSecret`, `loadStore`, `storePath`, `mergeDotenv`, `secretEnv` from `@lockit/core`.
- Produces: `cmdPull(io: Io): Promise<number>`. Steps, writing nothing until the last: (1) parse `argv` into names / `--all <bundle>` / `--out <file>` / `--force`; (2) call `io.authorize()` — `null` → exit 1, nothing written; (3) `loadStore` with the returned passphrase — failure → exit 1; (4) resolve every requested name strictly — any `none`/`ambiguous` → exit 1, nothing written; (5) pick the target file by precedence (`--out`; else first existing of `.env.local`, `.env`; else create `.env` mode `0600`); (6) `mergeDotenv` and write; (7) print a value-free summary.

First, extend `Io` in `packages/cli/src/commands.ts`:

```ts
export interface Io {
  argv: string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
  out: (s: string) => void;
  err: (s: string) => void;
  /** Human authorization for plaintext egress (pull). Resolves to the
   *  passphrase typed on /dev/tty, or null if denied / unavailable. */
  authorize?: () => Promise<string | null>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/pull.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSet } from "./commands.js";
import { cmdPull } from "./pull.js";
import type { Io } from "./commands.js";

const PASS = "test-passphrase";

function makeIo(
  argv: string[],
  home: string,
  opts: { stdin?: string; authorize?: () => Promise<string | null> } = {},
): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: opts.stdin ?? "",
    env: { ...process.env, LOCKIT_HOME: home, LOCKIT_PASSPHRASE: PASS } as NodeJS.ProcessEnv,
    authorize: opts.authorize,
    stdout: "",
    stderr: "",
    out(s: string) { (this as { stdout: string }).stdout += s; },
    err(s: string) { (this as { stderr: string }).stderr += s; },
  };
  return io as Io & { stdout: string; stderr: string };
}

async function seed(home: string, slug: string, key: string, value: string) {
  const set = makeIo([slug, key], home, { stdin: value });
  // cmdSet reads value from stdin
  (set as { stdin: string }).stdin = value;
  await cmdSet(set);
}

describe("cmdPull", () => {
  let home: string;
  let dir: string;
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    dir = mkdtempSync(join(tmpdir(), "lockit-proj-"));
    await seed(home, "app/dev", "API_KEY", "sk-live-123");
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the real value into a new .env after authorization, at 0600", async () => {
    const out = join(dir, ".env");
    const io = makeIo(["API_KEY", "--out", out], home, { authorize: async () => PASS });
    expect(await cmdPull(io)).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("API_KEY=sk-live-123");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(io.stdout).not.toContain("sk-live-123"); // value-free stdout
  });

  it("writes nothing and exits 1 when authorization is denied", async () => {
    const out = join(dir, ".env");
    const io = makeIo(["API_KEY", "--out", out], home, { authorize: async () => null });
    expect(await cmdPull(io)).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(io.stderr.toLowerCase()).toContain("authorization");
  });

  it("aborts before auth on an unknown variable, writing nothing", async () => {
    const out = join(dir, ".env");
    let authorized = false;
    const io = makeIo(["NOPE", "--out", out], home, {
      authorize: async () => { authorized = true; return PASS; },
    });
    expect(await cmdPull(io)).toBe(1);
    expect(io.stderr).toMatch(/not found/i);
    expect(existsSync(out)).toBe(false);
  });

  it("skips an existing key unless --force", async () => {
    const out = join(dir, ".env");
    writeFileSync(out, "API_KEY=old\n");
    const io = makeIo(["API_KEY", "--out", out], home, { authorize: async () => PASS });
    expect(await cmdPull(io)).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("API_KEY=old");
    expect(io.stdout).toMatch(/skipped 1/);

    const forced = makeIo(["API_KEY", "--out", out, "--force"], home, { authorize: async () => PASS });
    expect(await cmdPull(forced)).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("API_KEY=sk-live-123");
  });
});
```

> The resolver-abort test intentionally resolves *after* auth in the implementation; assert only that nothing is written and exit is 1. (If you prefer resolve-before-auth, both orderings satisfy "writes nothing"; this plan resolves after auth so the human is the first gate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/cli test -- pull`
Expected: FAIL — `Cannot find module './pull.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/pull.ts
import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getSecret,
  loadStore,
  mergeDotenv,
  resolveVar,
  storePath,
  type DotenvEntry,
} from "@lockit/core";
import type { Io } from "./commands.js";

interface PullArgs {
  names: string[];
  allBundle?: string;
  out?: string;
  force: boolean;
}

function parsePullArgs(argv: string[]): PullArgs {
  const args: PullArgs = { names: [], force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--force") args.force = true;
    else if (a === "--all") { args.allBundle = argv[i + 1]; i++; }
    else if (a === "--out") { args.out = argv[i + 1]; i++; }
    else args.names.push(a);
  }
  return args;
}

/** Resolve the target env file by fixed precedence: --out, else first existing
 *  of .env.local / .env, else a new .env in the cwd. */
function targetFile(out: string | undefined): { path: string; isNew: boolean } {
  if (out !== undefined) return { path: out, isNew: !existsSync(out) };
  for (const name of [".env.local", ".env"]) {
    const p = join(process.cwd(), name);
    if (existsSync(p)) return { path: p, isNew: false };
  }
  return { path: join(process.cwd(), ".env"), isNew: true };
}

/** `lockit pull <VAR...> | bundle#VAR | --all <bundle> [--out <file>] [--force]` */
export async function cmdPull(io: Io): Promise<number> {
  const args = parsePullArgs(io.argv);
  if (args.names.length === 0 && args.allBundle === undefined) {
    io.err("usage: lockit pull <VAR...> | <bundle#VAR> | --all <bundle> [--out <file>] [--force]\n");
    return 1;
  }

  // Human gate FIRST — nothing is read or written until a human authorizes.
  const passphrase = io.authorize ? await io.authorize() : null;
  if (passphrase === null) {
    io.err("authorization denied or unavailable; nothing written\n");
    return 1;
  }

  let store;
  try {
    store = await loadStore(passphrase, storePath());
  } catch {
    io.err("authorization failed: passphrase did not decrypt the store\n");
    return 1;
  }

  const entries: DotenvEntry[] = [];
  if (args.allBundle !== undefined) {
    const sec = getSecret(store, args.allBundle);
    if (sec === undefined) {
      io.err(`not found: bundle ${args.allBundle}\n`);
      return 1;
    }
    for (const f of sec.fields) if (f.type === "env") entries.push({ key: f.key, value: f.value });
  }
  for (const name of args.names) {
    const r = resolveVar(store, name);
    if (r.status === "none") { io.err(`not found: ${name}\n`); return 1; }
    if (r.status === "ambiguous") {
      io.err(`AMBIGUOUS: ${name} is in ${r.bundles.join(", ")}; qualify as <bundle>#${name}\n`);
      return 1;
    }
    entries.push({ key: r.field.key, value: r.field.value });
  }

  const target = targetFile(args.out);
  const existingText = target.isNew ? "" : await readFile(target.path, "utf8");
  const merged = mergeDotenv(existingText, entries, { force: args.force });
  await writeFile(target.path, merged.text, target.isNew ? { mode: 0o600 } : {});
  await chmod(target.path, 0o600);

  const skipNote = merged.skipped.length > 0 ? " (already present; --force to overwrite)" : "";
  io.out(`wrote ${merged.wrote.length}, skipped ${merged.skipped.length}${skipNote}\n`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/cli test -- pull` → Expected: PASS (all cases).
Run: `pnpm --filter @lockit/cli typecheck` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pull.ts packages/cli/src/pull.test.ts packages/cli/src/commands.ts
git commit -m "feat(cli): lockit pull — auth-gated egress of real values into .env"
```

---

### Task 7: real `/dev/tty` authorizer + `pull` dispatch

**Files:**
- Create: `packages/cli/src/authorize.ts`
- Modify: `packages/cli/src/index.ts` (dispatch `pull`, wire the real authorizer)

**Interfaces:**
- Consumes: `Io` shape from `./commands.js`.
- Produces: `ttyAuthorize(): Promise<string | null>` — opens `/dev/tty`, prompts with echo off, resolves the typed passphrase; resolves `null` if `/dev/tty` cannot be opened (headless) or on Ctrl-C. Honors `LOCKIT_PULL_YES=1` as a documented bypass that returns `process.env.LOCKIT_PASSPHRASE ?? null` after a stderr warning.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/authorize.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { ttyAuthorize } from "./authorize.js";

describe("ttyAuthorize headless behavior", () => {
  const prev = { yes: process.env.LOCKIT_PULL_YES, pass: process.env.LOCKIT_PASSPHRASE };
  afterEach(() => {
    process.env.LOCKIT_PULL_YES = prev.yes;
    process.env.LOCKIT_PASSPHRASE = prev.pass;
  });

  it("returns the passphrase when LOCKIT_PULL_YES=1 (bypass)", async () => {
    process.env.LOCKIT_PULL_YES = "1";
    process.env.LOCKIT_PASSPHRASE = "p";
    expect(await ttyAuthorize()).toBe("p");
  });

  it("returns null with LOCKIT_PULL_YES=1 but no passphrase set", async () => {
    process.env.LOCKIT_PULL_YES = "1";
    delete process.env.LOCKIT_PASSPHRASE;
    expect(await ttyAuthorize()).toBeNull();
  });
});
```

> The interactive `/dev/tty` path cannot be unit-tested without a pseudo-terminal; it is exercised manually and via the Task 8 e2e bypass path. These two cases pin the headless contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lockit/cli test -- authorize`
Expected: FAIL — `Cannot find module './authorize.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/authorize.ts
import { openSync, closeSync } from "node:fs";
import * as tty from "node:tty";

/** Prompt the human on /dev/tty (echo off) for the passphrase that authorizes a
 *  pull. Resolves null if no controlling terminal is available or on Ctrl-C.
 *  An agent that drives the child's stdin cannot answer a /dev/tty prompt. */
export function ttyAuthorize(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.env.LOCKIT_PULL_YES === "1") {
      process.stderr.write("warning: LOCKIT_PULL_YES=1 — pull authorization gate bypassed\n");
      resolve(process.env.LOCKIT_PASSPHRASE ?? null);
      return;
    }

    let fd: number;
    try {
      fd = openSync("/dev/tty", "r+");
    } catch {
      resolve(null);
      return;
    }

    const input = new tty.ReadStream(fd);
    const output = new tty.WriteStream(fd);
    output.write("lockit: enter passphrase to authorize pull: ");
    try { input.setRawMode(true); } catch { /* best effort */ }

    let buf = "";
    const finish = (val: string | null) => {
      try { input.setRawMode(false); } catch { /* ignore */ }
      output.write("\n");
      input.destroy();
      output.destroy();
      try { closeSync(fd); } catch { /* streams may already own/close fd */ }
      resolve(val);
    };

    input.on("data", (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return finish(buf);
        if (ch === "") return finish(null); // Ctrl-C
        if (ch === "") { buf = buf.slice(0, -1); continue; } // backspace
        buf += ch;
      }
    });
  });
}
```

Wire dispatch in `packages/cli/src/index.ts`:

```ts
import { cmdPull } from "./pull.js";
import { ttyAuthorize } from "./authorize.js";
// ...inside main(), alongside the other command blocks:
if (command === "pull") {
  const io: Io = { argv, stdin: "", env: process.env, out, err, authorize: ttyAuthorize };
  return await cmdPull(io);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lockit/cli test -- authorize` → Expected: PASS.
Run: `pnpm -r typecheck && pnpm -r build` → Expected: PASS, clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/authorize.ts packages/cli/src/authorize.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): /dev/tty pull authorizer + pull/import dispatch"
```

---

### Task 8: e2e — real binary round trip + headless gate

**Files:**
- Create: `e2e/import-pull.e2e.test.ts`
- Reference: `e2e/helpers.ts` (existing `runLockit` / sandbox-home helpers)

**Interfaces:**
- Consumes: the existing e2e helper that spawns the built binary in a sandbox `LOCKIT_HOME` and returns `{ stdout, stderr, code }`. Reuse its exact signature (mirror `e2e/set.e2e.test.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// e2e/import-pull.e2e.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLockit, withHome } from "./helpers.js"; // match existing helper exports

describe("import + pull (e2e, real binary)", () => {
  it("imports a .env, lists vars value-free, and refuses pull without a tty", async () => {
    await withHome(async (home) => {
      const proj = mkdtempSync(join(tmpdir(), "lockit-proj-"));
      try {
        const src = join(proj, ".env");
        writeFileSync(src, "API_KEY=sk-live-123\nFOO=bar\n");

        const imp = await runLockit(home, ["import", src, "--as", "app/dev"], { passphrase: "pw" });
        expect(imp.code).toBe(0);

        const ls = await runLockit(home, ["ls", "--vars"], { passphrase: "pw" });
        expect(ls.stdout).toContain("API_KEY");
        expect(ls.stdout).not.toContain("sk-live-123");

        // No tty in the spawned process → pull refuses, writes nothing.
        const out = join(proj, "out.env");
        const denied = await runLockit(home, ["pull", "API_KEY", "--out", out], { passphrase: "pw" });
        expect(denied.code).toBe(1);
        expect(existsSync(out)).toBe(false);

        // Documented headless bypass writes the real value.
        const ok = await runLockit(home, ["pull", "API_KEY", "--out", out], {
          passphrase: "pw",
          env: { LOCKIT_PULL_YES: "1" },
        });
        expect(ok.code).toBe(0);
        expect(readFileSync(out, "utf8")).toContain("API_KEY=sk-live-123");
        expect(ok.stdout).not.toContain("sk-live-123");
      } finally {
        rmSync(proj, { recursive: true, force: true });
      }
    });
  });
});
```

> Adapt `runLockit`/`withHome` names and the `env`/`passphrase` option shape to whatever `e2e/helpers.ts` actually exports — read it first and match exactly. The headless `pull` (no tty) exercising the refuse path is the key invariant assertion: a process without `/dev/tty` cannot self-authorize.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -r build && pnpm test:e2e -- import-pull`
Expected: FAIL — binary lacks `import`/`pull`, or helper names need adapting. Fix the helper imports to match, rebuild.

- [ ] **Step 3: Make it pass**

No new product code — Tasks 4–7 already implement the behavior. Adjust only the test's helper imports/option shape to match `e2e/helpers.ts`, then rebuild.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -r build && pnpm test:e2e -- import-pull` → Expected: PASS.
Run full gates: `pnpm -r typecheck && pnpm test && pnpm test:e2e && pnpm -r build` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/import-pull.e2e.test.ts
git commit -m "test(e2e): import → ls --vars → pull round trip; headless pull refuses without a tty"
```

---

## Self-Review

**Spec coverage:**
- Two-mode framing / Mode 1 scope → plan header + Global Constraints. ✓
- Invariant #1 via `/dev/tty` gate → Tasks 6 (port + gate-first ordering) and 7 (real authorizer); e2e headless-refuse in Task 8. ✓
- Addressing (flat by var name, `bundle#KEY` qualifier, strict 0/1/N) → Task 3 `resolveVar`; consumed in Task 6. ✓
- `import [path] [--as]`, default `./.env`, slug = cwd basename, parser rules, no source-file write, no partial import → Task 4 + Task 1. ✓
- `ls --vars` value-free discovery → Task 5. ✓
- `pull` precedence (`--out` / `.env.local` / `.env` / create), merge skip-vs-`--force`, `0600`, value-free summary, headless `LOCKIT_PULL_YES` → Tasks 6 + 7. ✓
- Errors: not-found / ambiguous abort with nothing written → Task 6 tests. ✓
- Success criteria 1–5 → covered across Tasks 4–8. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step is complete. The two adapt-to-existing notes (Task 5 `makeIo` seed, Task 8 helper names) point at concrete existing patterns rather than leaving logic unwritten. ✓

**Type consistency:** `DotenvEntry`, `MergeResult`, `ResolveResult`, and `Io.authorize?: () => Promise<string | null>` are defined once and used with identical signatures across Tasks 1–7. `cmdImport`/`cmdPull`/`cmdLs` all return `Promise<number>` matching the existing command convention. ✓

---

## Execution Handoff

Defer `pnpm test:e2e` until after Task 7 (the binary needs the new commands built). Run `pnpm --filter <pkg> test` per task; run the full gate (`typecheck && test && test:e2e && build`) at the end of Task 8.
