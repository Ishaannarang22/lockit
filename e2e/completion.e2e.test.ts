import { describe, it, expect } from "vitest";
import { runLockit, withSandbox } from "./helpers.js";

describe("completion (e2e, real binary)", () => {
  it("emits a zsh script and lists candidates value-free, silent when locked", async () => {
    await withSandbox(async (home) => {
      const comp = await runLockit(home, ["completion", "zsh"]);
      expect(comp.code).toBe(0);
      expect(comp.stdout).toContain("compdef _lockit lockit");
      expect(comp.stdout).toContain("lockit __complete-list");

      await runLockit(home, ["set", "nvidia/dev", "NVIDIA_API_KEY"], {
        passphrase: "pw",
        stdin: "secret-xyz",
      });

      const list = await runLockit(home, ["__complete-list"], { passphrase: "pw" });
      expect(list.code).toBe(0);
      expect(list.stdout).toContain("NVIDIA_API_KEY");
      expect(list.stdout).toContain("nvidia/dev#NVIDIA_API_KEY");
      expect(list.stdout).not.toContain("secret-xyz");

      // Locked (empty passphrase) → silent, no candidates leaked.
      const locked = await runLockit(home, ["__complete-list"], { env: { LOCKIT_PASSPHRASE: "" } });
      expect(locked.code).toBe(0);
      expect(locked.stdout).toBe("");
    });
  });
});
