import { describe, it, expect, vi } from "vitest";
import { loadKey, protectKeyOn, protectKeyOff } from "./storekey.js";

describe("loadKey", () => {
  it("returns LOCKIT_PASSPHRASE when set, without reading the keyfile or keychain", async () => {
    const readKeyfile = vi.fn(() => "should-not-be-read");
    const unwrap = vi.fn();
    const key = await loadKey({ env: { LOCKIT_PASSPHRASE: "override" }, readKeyfile, unwrap });
    expect(key).toBe("override");
    expect(readKeyfile).not.toHaveBeenCalled();
    expect(unwrap).not.toHaveBeenCalled();
  });

  it("returns the plaintext key directly, never touching the keychain", async () => {
    const unwrap = vi.fn();
    const key = await loadKey({ env: {}, readKeyfile: () => "plain-key\n", unwrap });
    expect(key).toBe("plain-key");
    expect(unwrap).not.toHaveBeenCalled();
  });

  it("unwraps via the keychain (Touch ID) when the keyfile is a marker", async () => {
    const unwrap = vi.fn(async () => "secret-from-keychain");
    const readKeyfile = () => JSON.stringify({ protection: "keychain", service: "s", account: "a" });
    const key = await loadKey({ env: {}, readKeyfile, unwrap });
    expect(key).toBe("secret-from-keychain");
    expect(unwrap).toHaveBeenCalledWith("s", "a");
  });

  it("propagates an unwrap rejection (e.g. Touch ID cancelled)", async () => {
    const unwrap = vi.fn(async () => {
      throw new Error("authentication cancelled");
    });
    const readKeyfile = () => JSON.stringify({ protection: "keychain", service: "s", account: "a" });
    await expect(loadKey({ env: {}, readKeyfile, unwrap })).rejects.toThrow("cancelled");
  });
});

describe("protectKeyOn (migrate plaintext -> keychain)", () => {
  const baseOps = () => ({
    wrap: vi.fn(async () => true),
    unwrap: vi.fn(async () => "the-key"),
    del: vi.fn(async () => {}),
    writeMarker: vi.fn(),
    newAccount: () => "acct-1",
  });

  it("wraps, verifies via an unwrap round-trip, then writes the marker", async () => {
    const ops = baseOps();
    await protectKeyOn("the-key", ops);
    expect(ops.wrap).toHaveBeenCalledWith(expect.any(String), "acct-1", "the-key");
    expect(ops.unwrap).toHaveBeenCalledWith(expect.any(String), "acct-1");
    expect(ops.writeMarker).toHaveBeenCalledWith(expect.any(String), "acct-1");
    expect(ops.del).not.toHaveBeenCalled();
  });

  it("ABORTS without writing the marker if the round-trip does not match (deletes the bad item)", async () => {
    const ops = { ...baseOps(), unwrap: vi.fn(async () => "WRONG") };
    await expect(protectKeyOn("the-key", ops)).rejects.toThrow(/verif/i);
    expect(ops.writeMarker).not.toHaveBeenCalled(); // plaintext keyfile is left untouched
    expect(ops.del).toHaveBeenCalled();
  });

  it("does not write the marker if verification auth is cancelled", async () => {
    const ops = {
      ...baseOps(),
      unwrap: vi.fn(async () => {
        throw new Error("authentication cancelled");
      }),
    };
    await expect(protectKeyOn("the-key", ops)).rejects.toThrow();
    expect(ops.writeMarker).not.toHaveBeenCalled();
  });
});

describe("protectKeyOff (keychain -> plaintext)", () => {
  it("unwraps (Touch ID), writes the plaintext key back, then deletes the keychain item", async () => {
    const order: string[] = [];
    const ops = {
      unwrap: vi.fn(async () => "recovered-key"),
      del: vi.fn(async () => {
        order.push("del");
      }),
      writePlaintext: vi.fn(() => {
        order.push("write");
      }),
    };
    const key = await protectKeyOff("s", "a", ops);
    expect(key).toBe("recovered-key");
    expect(ops.writePlaintext).toHaveBeenCalledWith("recovered-key");
    expect(order).toEqual(["write", "del"]); // never delete before the plaintext is safely written
  });

  it("does not write or delete if the unwrap is cancelled", async () => {
    const ops = {
      unwrap: vi.fn(async () => {
        throw new Error("cancelled");
      }),
      del: vi.fn(async () => {}),
      writePlaintext: vi.fn(),
    };
    await expect(protectKeyOff("s", "a", ops)).rejects.toThrow();
    expect(ops.writePlaintext).not.toHaveBeenCalled();
    expect(ops.del).not.toHaveBeenCalled();
  });
});
