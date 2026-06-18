import { defineConfig } from "vitest/config";

// Black-box e2e: spawns the real compiled `kv` binary in disposable sandbox
// HOMEs. Kept out of the fast unit gate (`pnpm test`); run via `pnpm test:e2e`.
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    environment: "node",
    globalSetup: ["./e2e/global-setup.ts"],
    testTimeout: 30000, // real Argon2id (64 MiB) + process spawn
    hookTimeout: 120000,
  },
});
