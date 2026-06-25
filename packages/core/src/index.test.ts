import { describe, it, expect } from "vitest";
import * as barrel from "./index.js";
import {
  createSecret,
  isValidSlug,
  emptyStore,
  upsertField,
  getSecret,
  listSecrets,
  removeSecret,
  secretEnv,
  isValidFieldKey,
  saveStore,
  loadStore,
  lockitHome,
  storePath,
} from "./index.js";

// These mirror the underlying modules so we can prove the barrel re-exports the
// same function objects, not look-alikes.
import { createSecret as createSecretSrc, isValidSlug as isValidSlugSrc } from "./model/secret.js";
import {
  emptyStore as emptyStoreSrc,
  upsertField as upsertFieldSrc,
  getSecret as getSecretSrc,
  listSecrets as listSecretsSrc,
  removeSecret as removeSecretSrc,
  secretEnv as secretEnvSrc,
  isValidFieldKey as isValidFieldKeySrc,
} from "./store/store.js";
import { saveStore as saveStoreSrc, loadStore as loadStoreSrc } from "./store/store-persist.js";
import { lockitHome as lockitHomeSrc, storePath as storePathSrc } from "./paths.js";

describe("@lockit/core barrel re-exports", () => {
  it("re-exports every model/secret value binding (same identity)", () => {
    expect(createSecret).toBe(createSecretSrc);
    expect(isValidSlug).toBe(isValidSlugSrc);
  });

  it("re-exports every store value binding (same identity)", () => {
    expect(emptyStore).toBe(emptyStoreSrc);
    expect(upsertField).toBe(upsertFieldSrc);
    expect(getSecret).toBe(getSecretSrc);
    expect(listSecrets).toBe(listSecretsSrc);
    expect(removeSecret).toBe(removeSecretSrc);
    expect(secretEnv).toBe(secretEnvSrc);
    expect(isValidFieldKey).toBe(isValidFieldKeySrc);
  });

  it("re-exports the persistence functions (same identity)", () => {
    expect(saveStore).toBe(saveStoreSrc);
    expect(loadStore).toBe(loadStoreSrc);
  });

  it("re-exports the path helpers (same identity)", () => {
    expect(lockitHome).toBe(lockitHomeSrc);
    expect(storePath).toBe(storePathSrc);
  });

  it("exposes exactly the documented public surface (no missing/extra exports)", () => {
    expect(Object.keys(barrel).sort()).toEqual(
      [
        "createSecret",
        "emptyStore",
        "emptyVault",
        "bindKey",
        "unbindKey",
        "vaultRef",
        "findProjectRoot",
        "vaultPath",
        "readVault",
        "writeVault",
        "initProject",
        "getSecret",
        "isValidFieldKey",
        "isValidSlug",
        "lockitHome",
        "listSecrets",
        "loadStore",
        "mergeDotenv",
        "parseDotenv",
        "removeSecret",
        "resolveVar",
        "saveStore",
        "secretEnv",
        "storePath",
        "upsertField",
      ].sort(),
    );
  });

  it("every re-exported binding is callable", () => {
    for (const fn of [
      createSecret,
      isValidSlug,
      emptyStore,
      upsertField,
      getSecret,
      listSecrets,
      removeSecret,
      secretEnv,
      isValidFieldKey,
      saveStore,
      loadStore,
      lockitHome,
      storePath,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("createSecret (via barrel)", () => {
  it("creates a value-free secret with defaults", () => {
    const s = createSecret({
      slug: "supabase/acme",
      schema: "supabase",
      fields: [{ key: "SUPABASE_URL", type: "env", hasValue: true }],
    });
    expect(s.slug).toBe("supabase/acme");
    expect(s.aka).toEqual([]);
    expect(s.versions).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.fields[0]?.hasValue).toBe(true);
  });

  it("rejects an invalid slug", () => {
    expect(() => createSecret({ slug: "Bad Slug!", schema: "x" })).toThrow(/invalid slug/);
  });

  it("rejects duplicate field keys", () => {
    expect(() =>
      createSecret({
        slug: "openai/dev",
        schema: "openai",
        fields: [
          { key: "OPENAI_API_KEY", type: "env", hasValue: true },
          { key: "OPENAI_API_KEY", type: "env", hasValue: false },
        ],
      }),
    ).toThrow(/duplicate field key/);
  });

  it("rejects an empty schema", () => {
    expect(() => createSecret({ slug: "openai/dev", schema: "" })).toThrow(/schema/);
  });
});

describe("isValidSlug (via barrel)", () => {
  it("accepts lowercase slash-segmented slugs, rejects others", () => {
    expect(isValidSlug("openai/dev")).toBe(true);
    expect(isValidSlug("a/b/c")).toBe(true);
    expect(isValidSlug("supabase/acme")).toBe(true);
    expect(isValidSlug("Bad")).toBe(false);
    expect(isValidSlug("/leading")).toBe(false);
    expect(isValidSlug("trailing/")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("has space")).toBe(false);
  });
});

describe("store flow (via barrel, pure functions only)", () => {
  it("composes emptyStore -> upsertField -> get/list/secretEnv/remove", () => {
    let s = emptyStore();
    s = upsertField(s, {
      slug: "openai/dev",
      schema: "openai",
      key: "OPENAI_API_KEY",
      type: "env",
      value: "sk-xyz",
    });
    expect(getSecret(s, "openai/dev")?.fields[0]?.value).toBe("sk-xyz");
    expect(isValidFieldKey("OPENAI_API_KEY")).toBe(true);
    const sec = getSecret(s, "openai/dev");
    expect(sec).toBeDefined();
    if (sec) expect(secretEnv(sec)).toEqual({ OPENAI_API_KEY: "sk-xyz" });
    expect(JSON.stringify(listSecrets(s))).not.toContain("sk-xyz");
    s = removeSecret(s, "openai/dev");
    expect(getSecret(s, "openai/dev")).toBeUndefined();
  });
});
