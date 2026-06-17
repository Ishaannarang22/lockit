# P0 Scaffold + Crypto Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `key_manager` pnpm monorepo and build the `@kv/crypto` at-rest foundation — passphrase key derivation (Argon2id), authenticated encryption (XChaCha20-Poly1305), and a versioned sealed-blob format — fully test-driven.

**Architecture:** A pnpm-workspace TypeScript monorepo. `packages/crypto` is a pure, I/O-free trust root. This plan implements only its *symmetric, at-rest* layer: derive a 32-byte key from a passphrase, seal/open bytes with AEAD, and serialize a tamper-evident sealed blob (the on-disk vault envelope). Asymmetric/envelope/HPKE sharing crypto is a later plan.

**Tech Stack:** TypeScript (strict), pnpm workspaces, vitest, eslint + prettier, `libsodium-wrappers-sumo` (XChaCha20-Poly1305, pure-WASM, no native build), `hash-wasm` (Argon2id, pure-WASM). Native `sodium-native` is deferred as a later CLI-hotpath optimization.

**Where this sits in the plan sequence (one plan per subsystem):**
1. **P0 scaffold + crypto at-rest foundation — THIS PLAN**
2. crypto: asymmetric envelope (X25519/HPKE), Ed25519 signatures, key ladder
3. core: encrypted store + Sets/Slots vault model
4. core: project-world sandbox + human-gated admission + local auth
5. cli (`kv`) commands
6. Claude plugin (skill + hooks)
7. identity + end-to-end sharing crypto
8. single-team server (sync/sharing, Key Transparency, OPAQUE)

**Conventions for every task below:** Run commands from the repo root `/Users/ishaan/Projects/key_manager` unless stated. Tests are colocated as `*.test.ts` next to source. Commit messages use Conventional Commits.

---

### Task 1: Monorepo scaffold + `@kv/crypto` skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.nvmrc`
- Create: `packages/crypto/package.json`
- Create: `packages/crypto/tsconfig.json`
- Create: `packages/crypto/src/index.ts`
- Create: `packages/crypto/src/smoke.test.ts`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "key-manager",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "eslint": "^9.12.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.8.0",
    "prettier": "^3.3.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["packages/*/src/**/*.ts"] },
  },
});
```

- [ ] **Step 5: Create `eslint.config.js`**

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ["**/dist/**", "**/node_modules/**"] },
);
```

- [ ] **Step 6: Create `.prettierrc.json`**

```json
{ "semi": true, "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 7: Create `.nvmrc`**

```
20
```

- [ ] **Step 8: Create `packages/crypto/package.json`**

```json
{
  "name": "@kv/crypto",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "libsodium-wrappers-sumo": "^0.7.15",
    "hash-wasm": "^4.11.0"
  },
  "devDependencies": {
    "@types/libsodium-wrappers-sumo": "^0.7.8"
  }
}
```

- [ ] **Step 9: Create `packages/crypto/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 10: Create `packages/crypto/src/index.ts`**

```ts
export const CRYPTO_PACKAGE = "@kv/crypto";
```

- [ ] **Step 11: Create `packages/crypto/src/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { CRYPTO_PACKAGE } from "./index.js";

describe("@kv/crypto smoke", () => {
  it("exposes its package name", () => {
    expect(CRYPTO_PACKAGE).toBe("@kv/crypto");
  });
});
```

- [ ] **Step 12: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main, master] }
  pull_request:
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 13: Install dependencies**

Run: `pnpm install`
Expected: resolves and writes `pnpm-lock.yaml`, no errors.

- [ ] **Step 14: Run the smoke test to verify the toolchain works**

Run: `pnpm test`
Expected: PASS — 1 test passed (`@kv/crypto smoke`).

- [ ] **Step 15: Verify typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed; `packages/crypto/dist/index.js` exists.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo and @kv/crypto package"
```

---

### Task 2: AEAD seal/open round-trip (XChaCha20-Poly1305)

**Files:**
- Create: `packages/crypto/src/aead.ts`
- Test: `packages/crypto/src/aead.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/crypto/src/aead.test.ts
import { describe, it, expect } from "vitest";
import { aeadSeal, aeadOpen, KEY_BYTES, NONCE_BYTES, randomBytes } from "./aead.js";

describe("aead round-trip", () => {
  it("seals and opens back to the original plaintext", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = new TextEncoder().encode("sk-secret-value");
    const sealed = await aeadSeal(message, key);
    expect(sealed.nonce.length).toBe(NONCE_BYTES);
    expect(sealed.ciphertext).not.toEqual(message); // actually encrypted
    const opened = await aeadOpen(sealed, key);
    expect(new TextDecoder().decode(opened)).toBe("sk-secret-value");
  });

  it("binds associated data (AAD): mismatched AAD fails to open", async () => {
    const key = await randomBytes(KEY_BYTES);
    const message = new TextEncoder().encode("hello");
    const sealed = await aeadSeal(message, key, new TextEncoder().encode("ctx-A"));
    await expect(aeadOpen(sealed, key, new TextEncoder().encode("ctx-B"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- aead`
Expected: FAIL — cannot resolve `./aead.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/crypto/src/aead.ts
import _sodium from "libsodium-wrappers-sumo";

await _sodium.ready;
const sodium = _sodium;

export const KEY_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES; // 32
export const NONCE_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES; // 24

export interface SealedBytes {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export async function randomBytes(n: number): Promise<Uint8Array> {
  return sodium.randombytes_buf(n);
}

export async function aeadSeal(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Promise<SealedBytes> {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key,
  );
  return { nonce, ciphertext };
}

export async function aeadOpen(
  sealed: SealedBytes,
  key: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sealed.ciphertext,
    aad,
    sealed.nonce,
    key,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- aead`
Expected: PASS — both `aead round-trip` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src/aead.ts packages/crypto/src/aead.test.ts
git commit -m "feat(crypto): XChaCha20-Poly1305 AEAD seal/open with AAD binding"
```

---

### Task 3: Tamper detection

**Files:**
- Modify: `packages/crypto/src/aead.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `packages/crypto/src/aead.test.ts`:

```ts
describe("aead tamper detection", () => {
  it("rejects a flipped ciphertext byte", async () => {
    const key = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(new TextEncoder().encode("data"), key);
    const tampered = {
      nonce: sealed.nonce,
      ciphertext: new Uint8Array(sealed.ciphertext),
    };
    tampered.ciphertext[0] ^= 0x01;
    await expect(aeadOpen(tampered, key)).rejects.toThrow();
  });

  it("rejects a wrong key", async () => {
    const key = await randomBytes(KEY_BYTES);
    const wrong = await randomBytes(KEY_BYTES);
    const sealed = await aeadSeal(new TextEncoder().encode("data"), key);
    await expect(aeadOpen(sealed, wrong)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `pnpm test -- aead`
Expected: PASS — tamper tests pass with no implementation change (Poly1305 authentication already rejects tampering and wrong keys). This task is a *characterization test* that locks in the security property.

- [ ] **Step 3: Commit**

```bash
git add packages/crypto/src/aead.test.ts
git commit -m "test(crypto): lock in AEAD tamper and wrong-key rejection"
```

---

### Task 4: Argon2id key derivation

**Files:**
- Create: `packages/crypto/src/kdf.ts`
- Test: `packages/crypto/src/kdf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/crypto/src/kdf.test.ts
import { describe, it, expect } from "vitest";
import { deriveKey, DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";

const salt = new Uint8Array(16).fill(7);

describe("deriveKey (Argon2id)", () => {
  it("derives a 32-byte key", async () => {
    const key = await deriveKey("correct horse battery staple", salt, DEFAULT_KDF_PARAMS);
    expect(key.length).toBe(32);
  });

  it("is deterministic for the same passphrase, salt, and params", async () => {
    const a = await deriveKey("pw", salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey("pw", salt, DEFAULT_KDF_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("differs for a different passphrase", async () => {
    const a = await deriveKey("pw1", salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey("pw2", salt, DEFAULT_KDF_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("differs for a different salt", async () => {
    const other = new Uint8Array(16).fill(9);
    const a = await deriveKey("pw", salt, DEFAULT_KDF_PARAMS);
    const b = await deriveKey("pw", other, DEFAULT_KDF_PARAMS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("rejects a salt shorter than 8 bytes", async () => {
    await expect(deriveKey("pw", new Uint8Array(4), DEFAULT_KDF_PARAMS)).rejects.toThrow();
  });
});

// Type-shape assertion so later tasks rely on a stable params contract.
const _params: KdfParams = { iterations: 3, memorySize: 65536, parallelism: 1 };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- kdf`
Expected: FAIL — cannot resolve `./kdf.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/crypto/src/kdf.ts
import { argon2id } from "hash-wasm";

export interface KdfParams {
  iterations: number; // time cost
  memorySize: number; // KiB
  parallelism: number;
}

// Interactive-tier defaults; tuned higher for production in a later task.
export const DEFAULT_KDF_PARAMS: KdfParams = {
  iterations: 3,
  memorySize: 65536, // 64 MiB
  parallelism: 1,
};

const MIN_SALT_BYTES = 8;
const KEY_LENGTH = 32;

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  if (salt.length < MIN_SALT_BYTES) {
    throw new Error(`salt must be at least ${MIN_SALT_BYTES} bytes`);
  }
  return argon2id({
    password: passphrase,
    salt,
    iterations: params.iterations,
    memorySize: params.memorySize,
    parallelism: params.parallelism,
    hashLength: KEY_LENGTH,
    outputType: "binary",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- kdf`
Expected: PASS — all 5 `deriveKey` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src/kdf.ts packages/crypto/src/kdf.test.ts
git commit -m "feat(crypto): Argon2id passphrase key derivation"
```

---

### Task 5: Versioned sealed-blob format (encode/decode)

**Files:**
- Create: `packages/crypto/src/blob.ts`
- Test: `packages/crypto/src/blob.test.ts`

This is the on-disk envelope: a self-describing JSON record with base64 fields, carrying the KDF parameters + salt + nonce + ciphertext so a vault file can be opened later with only the passphrase.

- [ ] **Step 1: Write the failing test**

```ts
// packages/crypto/src/blob.test.ts
import { describe, it, expect } from "vitest";
import { encodeBlob, decodeBlob, BLOB_VERSION, type SealedBlob } from "./blob.js";
import { DEFAULT_KDF_PARAMS } from "./kdf.js";

const sample: SealedBlob = {
  v: BLOB_VERSION,
  kdf: { algo: "argon2id", salt: new Uint8Array(16).fill(1), params: DEFAULT_KDF_PARAMS },
  nonce: new Uint8Array(24).fill(2),
  ciphertext: new Uint8Array([9, 8, 7, 6]),
};

describe("sealed-blob format", () => {
  it("round-trips through encode/decode", () => {
    const decoded = decodeBlob(encodeBlob(sample));
    expect(decoded.v).toBe(BLOB_VERSION);
    expect(decoded.kdf.algo).toBe("argon2id");
    expect(Buffer.from(decoded.kdf.salt).equals(Buffer.from(sample.kdf.salt))).toBe(true);
    expect(Buffer.from(decoded.nonce).equals(Buffer.from(sample.nonce))).toBe(true);
    expect(Buffer.from(decoded.ciphertext).equals(Buffer.from(sample.ciphertext))).toBe(true);
    expect(decoded.kdf.params).toEqual(DEFAULT_KDF_PARAMS);
  });

  it("encodes to valid JSON text", () => {
    expect(() => JSON.parse(encodeBlob(sample))).not.toThrow();
  });

  it("rejects an unknown version", () => {
    const bad = JSON.stringify({ ...JSON.parse(encodeBlob(sample)), v: 999 });
    expect(() => decodeBlob(bad)).toThrow(/unsupported.*version/i);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeBlob("{not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- blob`
Expected: FAIL — cannot resolve `./blob.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/crypto/src/blob.ts
import type { KdfParams } from "./kdf.js";

export const BLOB_VERSION = 1 as const;

export interface SealedBlob {
  v: typeof BLOB_VERSION;
  kdf: { algo: "argon2id"; salt: Uint8Array; params: KdfParams };
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

interface WireBlob {
  v: number;
  kdf: { algo: string; salt: string; params: KdfParams };
  nonce: string;
  ciphertext: string;
}

export function encodeBlob(blob: SealedBlob): string {
  const wire: WireBlob = {
    v: blob.v,
    kdf: { algo: blob.kdf.algo, salt: b64(blob.kdf.salt), params: blob.kdf.params },
    nonce: b64(blob.nonce),
    ciphertext: b64(blob.ciphertext),
  };
  return JSON.stringify(wire);
}

export function decodeBlob(text: string): SealedBlob {
  const wire = JSON.parse(text) as WireBlob;
  if (wire.v !== BLOB_VERSION) {
    throw new Error(`unsupported sealed-blob version: ${wire.v}`);
  }
  if (wire.kdf?.algo !== "argon2id") {
    throw new Error(`unsupported kdf algo: ${wire.kdf?.algo}`);
  }
  return {
    v: BLOB_VERSION,
    kdf: { algo: "argon2id", salt: unb64(wire.kdf.salt), params: wire.kdf.params },
    nonce: unb64(wire.nonce),
    ciphertext: unb64(wire.ciphertext),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- blob`
Expected: PASS — all 4 `sealed-blob format` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src/blob.ts packages/crypto/src/blob.test.ts
git commit -m "feat(crypto): versioned sealed-blob (de)serialization format"
```

---

### Task 6: Passphrase seal/open (the at-rest vault primitive)

**Files:**
- Create: `packages/crypto/src/vault-seal.ts`
- Test: `packages/crypto/src/vault-seal.test.ts`
- Modify: `packages/crypto/src/index.ts`

Combine KDF + AEAD + blob format into the two functions the rest of the system uses to put bytes safely on disk and get them back with only a passphrase.

- [ ] **Step 1: Write the failing test**

```ts
// packages/crypto/src/vault-seal.test.ts
import { describe, it, expect } from "vitest";
import { sealWithPassphrase, openWithPassphrase } from "./vault-seal.js";
import { decodeBlob } from "./blob.js";

const fast = { iterations: 2, memorySize: 8192, parallelism: 1 };

describe("sealWithPassphrase / openWithPassphrase", () => {
  it("round-trips secret bytes with the correct passphrase", async () => {
    const secret = new TextEncoder().encode("OPENAI_API_KEY=sk-xyz");
    const blobText = await sealWithPassphrase(secret, "hunter2", fast);
    const opened = await openWithPassphrase(blobText, "hunter2");
    expect(new TextDecoder().decode(opened)).toBe("OPENAI_API_KEY=sk-xyz");
  });

  it("fails to open with the wrong passphrase", async () => {
    const blobText = await sealWithPassphrase(new TextEncoder().encode("x"), "right", fast);
    await expect(openWithPassphrase(blobText, "wrong")).rejects.toThrow();
  });

  it("uses a fresh random salt and nonce each time (no plaintext, no reuse)", async () => {
    const msg = new TextEncoder().encode("same");
    const a = decodeBlob(await sealWithPassphrase(msg, "pw", fast));
    const b = decodeBlob(await sealWithPassphrase(msg, "pw", fast));
    expect(Buffer.from(a.kdf.salt).equals(Buffer.from(b.kdf.salt))).toBe(false);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("persists the kdf params in the blob so it can be opened later", async () => {
    const blob = decodeBlob(await sealWithPassphrase(new TextEncoder().encode("x"), "pw", fast));
    expect(blob.kdf.params).toEqual(fast);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- vault-seal`
Expected: FAIL — cannot resolve `./vault-seal.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/crypto/src/vault-seal.ts
import { aeadSeal, aeadOpen, randomBytes } from "./aead.js";
import { deriveKey, DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";
import { encodeBlob, decodeBlob, BLOB_VERSION } from "./blob.js";

const SALT_BYTES = 16;

export async function sealWithPassphrase(
  plaintext: Uint8Array,
  passphrase: string,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<string> {
  const salt = await randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt, params);
  const sealed = await aeadSeal(plaintext, key);
  return encodeBlob({
    v: BLOB_VERSION,
    kdf: { algo: "argon2id", salt, params },
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
  });
}

export async function openWithPassphrase(
  blobText: string,
  passphrase: string,
): Promise<Uint8Array> {
  const blob = decodeBlob(blobText);
  const key = await deriveKey(passphrase, blob.kdf.salt, blob.kdf.params);
  return aeadOpen({ nonce: blob.nonce, ciphertext: blob.ciphertext }, key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- vault-seal`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Export the public API from `index.ts`**

Replace the contents of `packages/crypto/src/index.ts` with:

```ts
export const CRYPTO_PACKAGE = "@kv/crypto";

export { aeadSeal, aeadOpen, randomBytes, KEY_BYTES, NONCE_BYTES } from "./aead.js";
export type { SealedBytes } from "./aead.js";
export { deriveKey, DEFAULT_KDF_PARAMS } from "./kdf.js";
export type { KdfParams } from "./kdf.js";
export { encodeBlob, decodeBlob, BLOB_VERSION } from "./blob.js";
export type { SealedBlob } from "./blob.js";
export { sealWithPassphrase, openWithPassphrase } from "./vault-seal.js";
```

- [ ] **Step 6: Run the full suite, typecheck, lint, and build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green — every test passes; typecheck, lint, and build succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/crypto/src/vault-seal.ts packages/crypto/src/vault-seal.test.ts packages/crypto/src/index.ts
git commit -m "feat(crypto): passphrase seal/open at-rest vault primitive"
```

---

## Plan Self-Review

**Spec coverage (this plan's slice):** scaffold ✓ (Task 1); Argon2id KDF ✓ (Task 4); XChaCha20-Poly1305 AEAD ✓ (Task 2); tamper/wrong-key rejection ✓ (Task 3); versioned on-disk format ✓ (Task 5); passphrase-only seal/open at-rest primitive ✓ (Task 6). Asymmetric envelope, HPKE, signatures, the key ladder, the Sets/Slots vault, the sandbox/admission, the CLI, the plugin, sharing, and the server are explicitly deferred to plans 2–8 (listed in the header) — not gaps.

**Placeholder scan:** none — every code/command step contains complete content.

**Type consistency:** `KdfParams` defined in `kdf.ts` (Task 4) and consumed by `blob.ts` (Task 5) and `vault-seal.ts` (Task 6). `SealedBytes` defined in `aead.ts` (Task 2), reused by `vault-seal.ts`. `SealedBlob`/`BLOB_VERSION` from `blob.ts` used consistently. Function names (`aeadSeal`/`aeadOpen`/`randomBytes`/`deriveKey`/`encodeBlob`/`decodeBlob`/`sealWithPassphrase`/`openWithPassphrase`) are identical across definition, tests, and the `index.ts` re-export.

**Security note carried forward:** `DEFAULT_KDF_PARAMS` is interactive-tier; tests use a deliberately fast (`iterations: 2, memorySize: 8192`) profile for speed. A later task (in plan 2 or a hardening pass) must tune production Argon2id parameters and add a benchmark — flagged here so it is not forgotten.
