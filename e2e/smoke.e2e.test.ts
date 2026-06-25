import { describe, it, expect } from "vitest";
import { runLockit, withSandbox } from "./helpers.js";

const PW = "e2e-pass";

describe("lockit e2e smoke (real binary in a sandbox)", () => {
  it("set (stdin) → ls (value-free) → run (masked)", async () => {
    await withSandbox(async (home) => {
      const secret = "sk-e2e-SECRET-0001";

      const set = await runLockit(home, ["set", "openai/dev", "OPENAI_API_KEY"], {
        passphrase: PW,
        stdin: secret,
      });
      expect(set.code).toBe(0);
      expect(set.stdout).toContain("set openai/dev OPENAI_API_KEY (env)");
      expect(set.stdout).not.toContain(secret);

      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.code).toBe(0);
      expect(ls.stdout).toContain("openai/dev");
      expect(ls.stdout).toContain("OPENAI_API_KEY");
      expect(ls.stdout).not.toContain(secret);

      const run = await runLockit(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write(process.env.OPENAI_API_KEY ?? 'MISSING')",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).not.toContain("MISSING"); // child saw the real value
      expect(run.stdout).not.toContain(secret); // but kv masked it
      expect(run.stdout).toContain("***");
    });
  });
});
