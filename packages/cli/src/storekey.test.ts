import { describe, it, expect, vi } from "vitest";
import { loadStoreKey, protectKeyOn, isKeychainProtected, KEYCHAIN_SERVICE } from "./storekey.js";

describe("isKeychainProtected — does using the store already require a Touch ID?", () => {
  const marker = JSON.stringify({ protection: "keychain", service: "s", account: "a" });
  it("true when the keyfile is a keychain marker and no passphrase override", () => {
    expect(isKeychainProtected({} as NodeJS.ProcessEnv, () => marker)).toBe(true);
  });
  it("false when LOCKIT_PASSPHRASE overrides (no unlock prompt happens)", () => {
    expect(isKeychainProtected({ LOCKIT_PASSPHRASE: "x" } as NodeJS.ProcessEnv, () => marker)).toBe(false);
  });
  it("false for a plaintext keyfile or no keyfile", () => {
    expect(isKeychainProtected({} as NodeJS.ProcessEnv, () => "plain-key")).toBe(false);
    expect(isKeychainProtected({} as NodeJS.ProcessEnv, () => undefined)).toBe(false);
  });
});

function baseDeps(over: Partial<Parameters<typeof loadStoreKey>[0]> = {}) {
  return {
    env: {} as NodeJS.ProcessEnv,
    readKeyfile: vi.fn(() => undefined as string | undefined),
    keychainAvailable: vi.fn(() => true),
    randomKey: vi.fn(() => "fresh-random-key"),
    newAccount: vi.fn(() => "acct-1"),
    wrap: vi.fn(async () => true),
    unwrap: vi.fn(async () => "unwrapped"),
    unlock: vi.fn(async () => "unlocked"),
    del: vi.fn(async () => {}),
    writeMarker: vi.fn(),
    warn: vi.fn(),
    ...over,
  };
}

describe("loadStoreKey — protected by default", () => {
  it("returns LOCKIT_PASSPHRASE when set, touching nothing else", async () => {
    const deps = baseDeps({ env: { LOCKIT_PASSPHRASE: "override" } as NodeJS.ProcessEnv });
    expect(await loadStoreKey(deps)).toBe("override");
    expect(deps.readKeyfile).not.toHaveBeenCalled();
  });

  it("on first use, CREATES the key directly in the keychain — never a plaintext file", async () => {
    const deps = baseDeps({ readKeyfile: () => undefined });
    const key = await loadStoreKey(deps);
    expect(key).toBe("fresh-random-key");
    expect(deps.wrap).toHaveBeenCalledWith(KEYCHAIN_SERVICE, "acct-1", "fresh-random-key");
    expect(deps.writeMarker).toHaveBeenCalledWith(KEYCHAIN_SERVICE, "acct-1");
    expect(deps.unwrap).not.toHaveBeenCalled(); // no Touch ID at creation
  });

  it("refuses to invent a key when the keychain is unavailable (no plaintext fallback)", async () => {
    const deps = baseDeps({ readKeyfile: () => undefined, keychainAvailable: () => false });
    await expect(loadStoreKey(deps)).rejects.toThrow(/LOCKIT_PASSPHRASE|keychain/i);
    expect(deps.wrap).not.toHaveBeenCalled();
  });

  it("unlocks (session-aware) when the keyfile is a keychain marker", async () => {
    const deps = baseDeps({
      readKeyfile: () => JSON.stringify({ protection: "keychain", service: "s", account: "a" }),
      unlock: vi.fn(async () => "from-keychain"),
    });
    expect(await loadStoreKey(deps)).toBe("from-keychain");
    expect(deps.unlock).toHaveBeenCalledWith("s", "a");
  });

  it("auto-migrates a legacy plaintext key into the keychain (verified) on next use", async () => {
    const deps = baseDeps({ readKeyfile: () => "legacy-key", unwrap: vi.fn(async () => "legacy-key") });
    const key = await loadStoreKey(deps);
    expect(key).toBe("legacy-key");
    expect(deps.wrap).toHaveBeenCalledWith(KEYCHAIN_SERVICE, "acct-1", "legacy-key");
    expect(deps.writeMarker).toHaveBeenCalled(); // now protected
  });

  it("keeps working (plaintext preserved) if the migration Touch ID is cancelled", async () => {
    const deps = baseDeps({
      readKeyfile: () => "legacy-key",
      unwrap: vi.fn(async () => {
        throw new Error("authentication cancelled");
      }),
    });
    const key = await loadStoreKey(deps);
    expect(key).toBe("legacy-key"); // command still proceeds
    expect(deps.writeMarker).not.toHaveBeenCalled(); // keyfile left as plaintext, retried next time
    expect(deps.del).toHaveBeenCalled(); // orphan keychain item cleaned up
  });

  it("reads (but warns about) a legacy plaintext key when the keychain is unavailable", async () => {
    const deps = baseDeps({ readKeyfile: () => "legacy-key", keychainAvailable: () => false });
    expect(await loadStoreKey(deps)).toBe("legacy-key");
    expect(deps.warn).toHaveBeenCalled();
    expect(deps.wrap).not.toHaveBeenCalled();
  });
});

describe("protectKeyOn (explicit migrate, strict)", () => {
  const ops = (over = {}) => ({
    wrap: vi.fn(async () => true),
    unwrap: vi.fn(async () => "the-key"),
    del: vi.fn(async () => {}),
    writeMarker: vi.fn(),
    newAccount: () => "acct-1",
    ...over,
  });

  it("wraps, verifies the round-trip, then writes the marker", async () => {
    const o = ops();
    await protectKeyOn("the-key", o);
    expect(o.writeMarker).toHaveBeenCalled();
    expect(o.del).not.toHaveBeenCalled();
  });

  it("deletes the item and throws on a verification mismatch (keyfile untouched)", async () => {
    const o = ops({ unwrap: vi.fn(async () => "WRONG") });
    await expect(protectKeyOn("the-key", o)).rejects.toThrow(/verif/i);
    expect(o.writeMarker).not.toHaveBeenCalled();
    expect(o.del).toHaveBeenCalled();
  });

  it("deletes the orphan item and rethrows if the verify auth is cancelled", async () => {
    const o = ops({
      unwrap: vi.fn(async () => {
        throw new Error("cancelled");
      }),
    });
    await expect(protectKeyOn("the-key", o)).rejects.toThrow();
    expect(o.del).toHaveBeenCalled();
    expect(o.writeMarker).not.toHaveBeenCalled();
  });
});
