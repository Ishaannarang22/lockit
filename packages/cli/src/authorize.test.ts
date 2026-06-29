import { describe, it, expect, afterEach } from "vitest";
import { ttyAuthorize } from "./authorize.js";

describe("ttyAuthorize headless behavior", () => {
  const prev = process.env.LOCKIT_PULL_YES;
  afterEach(() => {
    if (prev === undefined) delete process.env.LOCKIT_PULL_YES;
    else process.env.LOCKIT_PULL_YES = prev;
  });

  it("does not honor LOCKIT_PULL_YES as a bypass", async () => {
    process.env.LOCKIT_PULL_YES = "1";
    expect(await ttyAuthorize()).toBe(false);
  });

  it("returns false with no bypass and no controlling tty", async () => {
    delete process.env.LOCKIT_PULL_YES;
    expect(await ttyAuthorize()).toBe(false);
  });
});
