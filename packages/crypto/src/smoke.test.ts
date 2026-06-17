import { describe, it, expect } from "vitest";
import { CRYPTO_PACKAGE } from "./index.js";

describe("@kv/crypto smoke", () => {
  it("exposes its package name", () => {
    expect(CRYPTO_PACKAGE).toBe("@kv/crypto");
  });
});
