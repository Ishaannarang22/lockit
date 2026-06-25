import { describe, it, expect, afterEach } from "vitest";
import { ttyAuthorize } from "./authorize.js";

describe("ttyAuthorize headless behavior", () => {
  const prev = { yes: process.env.LOCKIT_PULL_YES, pass: process.env.LOCKIT_PASSPHRASE };
  afterEach(() => {
    if (prev.yes === undefined) delete process.env.LOCKIT_PULL_YES;
    else process.env.LOCKIT_PULL_YES = prev.yes;
    if (prev.pass === undefined) delete process.env.LOCKIT_PASSPHRASE;
    else process.env.LOCKIT_PASSPHRASE = prev.pass;
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
