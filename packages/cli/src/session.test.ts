import { describe, it, expect, vi } from "vitest";
import { parseSession, sessionAccount, unlockWithSession, ttlMsFromEnv } from "./session.js";

describe("parseSession", () => {
  it("returns the key when the cached entry has not expired", () => {
    expect(parseSession("2000.the-base64-key", 1500)).toBe("the-base64-key");
  });
  it("returns undefined when expired", () => {
    expect(parseSession("1000.the-key", 1500)).toBeUndefined();
  });
  it("returns undefined for missing / malformed entries", () => {
    expect(parseSession(undefined, 1)).toBeUndefined();
    expect(parseSession("garbage-no-dot", 1)).toBeUndefined();
  });
  it("keeps the full key even if it contains base64 chars (splits on the first dot only)", () => {
    expect(parseSession("9999.ab+/=CD", 0)).toBe("ab+/=CD");
  });
});

describe("ttlMsFromEnv", () => {
  it("defaults to 90 seconds", () => {
    expect(ttlMsFromEnv({})).toBe(90_000);
  });
  it("honors LOCKIT_UNLOCK_TTL in seconds", () => {
    expect(ttlMsFromEnv({ LOCKIT_UNLOCK_TTL: "30" })).toBe(30_000);
  });
  it("0 disables caching", () => {
    expect(ttlMsFromEnv({ LOCKIT_UNLOCK_TTL: "0" })).toBe(0);
  });
  it("falls back to the default for non-numeric values", () => {
    expect(ttlMsFromEnv({ LOCKIT_UNLOCK_TTL: "abc" })).toBe(90_000);
  });
});

describe("unlockWithSession", () => {
  const deps = (over = {}) => ({
    ttlMs: 90_000,
    now: () => 1_000_000,
    peek: vi.fn(async () => undefined as string | undefined),
    unwrap: vi.fn(async () => "real-key"),
    writeSession: vi.fn(async () => {}),
    ...over,
  });

  it("returns the cached key WITHOUT a Touch ID when the session is still valid", async () => {
    const d = deps({ peek: vi.fn(async () => "2000000.real-key") }); // exp far in the future
    const key = await unlockWithSession("svc", "acct", d);
    expect(key).toBe("real-key");
    expect(d.unwrap).not.toHaveBeenCalled(); // no prompt
    expect(d.writeSession).not.toHaveBeenCalled();
  });

  it("does a Touch ID unwrap and refreshes the session on a cache miss", async () => {
    const d = deps({ peek: vi.fn(async () => undefined) });
    const key = await unlockWithSession("svc", "acct", d);
    expect(key).toBe("real-key");
    expect(d.unwrap).toHaveBeenCalledWith("svc", "acct");
    expect(d.writeSession).toHaveBeenCalledWith("svc", sessionAccount("acct"), `${1_000_000 + 90_000}.real-key`);
  });

  it("does a Touch ID unwrap when the cached session has expired", async () => {
    const d = deps({ peek: vi.fn(async () => "500000.stale-key") }); // exp < now
    const key = await unlockWithSession("svc", "acct", d);
    expect(key).toBe("real-key");
    expect(d.unwrap).toHaveBeenCalled();
  });

  it("never caches (and never peeks) when TTL is 0", async () => {
    const d = deps({ ttlMs: 0 });
    const key = await unlockWithSession("svc", "acct", d);
    expect(key).toBe("real-key");
    expect(d.peek).not.toHaveBeenCalled();
    expect(d.writeSession).not.toHaveBeenCalled();
    expect(d.unwrap).toHaveBeenCalled();
  });
});
