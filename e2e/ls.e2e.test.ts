import { describe, expect, it } from "vitest";
import { runLockit, withSandbox } from "./helpers.js";

const PW = "e2e-ls-pass";

describe("lockit ls (e2e, real binary)", () => {
  it("prints nothing for an empty store and exits 0", async () => {
    await withSandbox(async (home) => {
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.code).toBe(0);
      expect(ls.stdout).toBe("");
      expect(ls.stderr).toBe("");
    });
  });

  it("lists a single-field secret value-free as '<slug>  [<schema>]  <KEY>'", async () => {
    await withSandbox(async (home) => {
      const secret = "sk-e2e-LS-VALUEFREE-0001";
      await runLockit(home, ["set", "openai/dev", "OPENAI_API_KEY"], {
        passphrase: PW,
        stdin: secret,
      });
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.code).toBe(0);
      expect(ls.stdout).toBe("openai/dev  [openai]  OPENAI_API_KEY\n");
      expect(ls.stdout).not.toContain(secret);
      expect(ls.stderr).toBe("");
    });
  });

  it("shows multiple field keys comma-separated in insertion order, never a value", async () => {
    await withSandbox(async (home) => {
      await runLockit(home, ["set", "openai/dev", "ALPHA"], { passphrase: PW, stdin: "v-alpha" });
      await runLockit(home, ["set", "openai/dev", "BRAVO"], { passphrase: PW, stdin: "v-bravo" });
      await runLockit(home, ["set", "openai/dev", "CHARLIE"], {
        passphrase: PW,
        stdin: "v-charlie",
      });
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.code).toBe(0);
      expect(ls.stdout).toBe("openai/dev  [openai]  ALPHA,BRAVO,CHARLIE\n");
      expect(ls.stdout).not.toContain("v-alpha");
      expect(ls.stdout).not.toContain("v-bravo");
      expect(ls.stdout).not.toContain("v-charlie");
    });
  });

  it("uses exactly two spaces around the [schema] token", async () => {
    await withSandbox(async (home) => {
      await runLockit(home, ["set", "openai/dev", "K", "--schema", "custom"], {
        passphrase: PW,
        stdin: "v",
      });
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.stdout).toBe("openai/dev  [custom]  K\n");
    });
  });

  it("lists multiple secrets one per line, each terminated by a newline", async () => {
    await withSandbox(async (home) => {
      await runLockit(home, ["set", "openai/dev", "K"], { passphrase: PW, stdin: "a" });
      await runLockit(home, ["set", "stripe/live", "K"], { passphrase: PW, stdin: "b" });
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.code).toBe(0);
      expect(ls.stdout).toBe("openai/dev  [openai]  K\nstripe/live  [stripe]  K\n");
    });
  });

  it("never reveals a value even for a file-type field", async () => {
    await withSandbox(async (home) => {
      const secret = "sk-e2e-FILE-FIELD-LS-0001";
      await runLockit(home, ["set", "openai/dev", "TOKEN", "--file"], {
        passphrase: PW,
        stdin: secret,
      });
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.stdout).toBe("openai/dev  [openai]  TOKEN\n");
      expect(ls.stdout).not.toContain(secret);
    });
  });

  it("works with no LOCKIT_PASSPHRASE (auto keyfile): empty store prints nothing, exit 0", async () => {
    await withSandbox(async (home) => {
      const ls = await runLockit(home, ["ls"], { env: { LOCKIT_PASSPHRASE: "" } });
      expect(ls.code).toBe(0);
      expect(ls.stdout).toBe("");
      expect(ls.stderr).toBe("");
    });
  });

  it("a wrong passphrase refuses to decrypt (exit 1, value-free error)", async () => {
    await withSandbox(async (home) => {
      await runLockit(home, ["set", "openai/dev", "K"], { passphrase: PW, stdin: "v" });
      const ls = await runLockit(home, ["ls"], { passphrase: "WRONG-passphrase" });
      expect(ls.code).toBe(1);
      expect(ls.stderr).toContain("wrong passphrase or corrupted");
      expect(ls.stdout).toBe("");
    });
  });
});
