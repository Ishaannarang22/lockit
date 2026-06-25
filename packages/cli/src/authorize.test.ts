import { describe, it, expect, afterEach } from "vitest";
import { ttyAuthorize } from "./authorize.js";

describe("ttyAuthorize headless behavior", () => {
  const prev = process.env.LOCKIT_PULL_YES;
  afterEach(() => {
    if (prev === undefined) delete process.env.LOCKIT_PULL_YES;
    else process.env.LOCKIT_PULL_YES = prev;
  });

  it("returns true when LOCKIT_PULL_YES=1 (bypass)", async () => {
    process.env.LOCKIT_PULL_YES = "1";
    expect(await ttyAuthorize()).toBe(true);
  });

  it("returns false with no bypass and no controlling tty", async () => {
    delete process.env.LOCKIT_PULL_YES;
    expect(await ttyAuthorize()).toBe(false);
  });
});
