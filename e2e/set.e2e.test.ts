import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLockit, withSandbox } from "./helpers.js";

const PW = "e2e-set-pass";

describe("lockit set (e2e, real binary)", () => {
  it("stores the stdin value and prints a value-free confirmation; argv positional is ignored", async () => {
    await withSandbox(async (home) => {
      const secret = "sk-e2e-STDIN-ONLY-0001";
      const set = await runLockit(
        home,
        ["set", "openai/dev", "OPENAI_API_KEY", "ARGV_SHOULD_BE_IGNORED"],
        { passphrase: PW, stdin: secret },
      );
      expect(set.code).toBe(0);
      expect(set.stdout).toBe("set openai/dev OPENAI_API_KEY (env)\n");
      expect(set.stderr).toBe("");
      expect(set.stdout).not.toContain(secret);
      expect(set.stdout).not.toContain("ARGV_SHOULD_BE_IGNORED");

      // Prove the *stdin* value (not the argv token) is what the child injects.
      const run = await runLockit(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write(process.env.OPENAI_API_KEY === 'sk-e2e-STDIN-ONLY-0001' ? 'MATCH' : 'NOMATCH:'+process.env.OPENAI_API_KEY)",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("MATCH");
      expect(run.stdout).not.toContain("ARGV_SHOULD_BE_IGNORED");
    });
  });

  it("defaults the schema to the slug's first segment", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "supabase/acme", "DB_URL"], {
        passphrase: PW,
        stdin: "postgres://x",
      });
      expect(set.code).toBe(0);
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.stdout).toBe("supabase/acme  [supabase]  DB_URL\n");
    });
  });

  it("--schema overrides the default schema", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(
        home,
        ["set", "supabase/acme", "DB_URL", "--schema", "postgres"],
        {
          passphrase: PW,
          stdin: "v",
        },
      );
      expect(set.code).toBe(0);
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.stdout).toBe("supabase/acme  [postgres]  DB_URL\n");
    });
  });

  it("--schema with an empty value is rejected (exit 1, usage on stderr)", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "openai/dev", "K", "--schema", ""], {
        passphrase: PW,
        stdin: "v",
      });
      expect(set.code).toBe(1);
      expect(set.stderr).toContain("--schema requires a non-empty value");
      expect(set.stdout).toBe("");
    });
  });

  it("--schema with no following value is rejected (exit 1)", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "openai/dev", "K", "--schema"], {
        passphrase: PW,
        stdin: "v",
      });
      expect(set.code).toBe(1);
      expect(set.stderr).toContain("--schema requires a non-empty value");
    });
  });

  it("--file marks the field as file type (shown via the confirmation line)", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "openai/dev", "TOKEN", "--file"], {
        passphrase: PW,
        stdin: "filevalue",
      });
      expect(set.code).toBe(0);
      expect(set.stdout).toBe("set openai/dev TOKEN (file)\n");
    });
  });

  it("stores multiple fields on one secret (multi-field)", async () => {
    await withSandbox(async (home) => {
      const a = await runLockit(home, ["set", "openai/dev", "ALPHA"], {
        passphrase: PW,
        stdin: "a",
      });
      const b = await runLockit(home, ["set", "openai/dev", "BRAVO"], {
        passphrase: PW,
        stdin: "b",
      });
      expect(a.code).toBe(0);
      expect(b.code).toBe(0);
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      expect(ls.stdout).toBe("openai/dev  [openai]  ALPHA,BRAVO\n");
    });
  });

  it("works with no LOCKIT_PASSPHRASE (auto keyfile), exit 0", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "openai/dev", "K"], {
        stdin: "v",
        env: { LOCKIT_PASSPHRASE: "" },
      });
      expect(set.code).toBe(0);
      expect(set.stderr).toBe("");
    });
  });

  it("usage error when slug and key are missing (exit 1)", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set"], { passphrase: PW, stdin: "v" });
      expect(set.code).toBe(1);
      expect(set.stderr).toContain("usage: lockit set <slug> <KEY>");
    });
  });

  it("one positional outside a project errors with a project hint (exit 1)", async () => {
    await withSandbox(async (home) => {
      // A single positional means project-local set; with no .lockit/ here it
      // errors and points at init / the two-arg global form.
      const set = await runLockit(home, ["set", "OPENAI_API_KEY"], { passphrase: PW, stdin: "v" });
      expect(set.code).toBe(1);
      expect(set.stderr).toContain("not in a lockit project");
    });
  });

  it("rejects an invalid slug (uppercase) with exit 1; output is value-free", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "OpenAI/dev", "K"], {
        passphrase: PW,
        stdin: "sk-secret-leak-check",
      });
      expect(set.code).toBe(1);
      expect(set.stderr).toContain("invalid slug");
      expect(set.stderr).not.toContain("sk-secret-leak-check");
    });
  });

  it("rejects an invalid field key (leading digit) with exit 1", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "openai/dev", "1BADKEY"], {
        passphrase: PW,
        stdin: "v",
      });
      expect(set.code).toBe(1);
      expect(set.stderr).toContain("invalid field key");
    });
  });

  it("writes no plaintext to disk and creates the store at 0600 under $LOCKIT_HOME", async () => {
    await withSandbox(async (home) => {
      const secret = "sk-on-disk-PLAINTEXT-CHECK";
      const set = await runLockit(home, ["set", "openai/dev", "OPENAI_API_KEY"], {
        passphrase: PW,
        stdin: secret,
      });
      expect(set.code).toBe(0);

      const file = join(home, "store.json");
      const raw = await readFile(file, "utf8");
      expect(raw).not.toContain(secret);
      expect(raw).not.toContain("OPENAI_API_KEY"); // sealed: even the key name is hidden
      const blob = JSON.parse(raw) as { v: number; kdf: { algo: string } };
      expect(blob.v).toBe(1);
      expect(blob.kdf.algo).toBe("argon2id");

      const st = await stat(file);
      expect(st.mode & 0o777).toBe(0o600);
    });
  });

  it("a wrong passphrase refuses to decrypt the store later", async () => {
    await withSandbox(async (home) => {
      const set = await runLockit(home, ["set", "openai/dev", "K"], { passphrase: PW, stdin: "v" });
      expect(set.code).toBe(0);

      const ls = await runLockit(home, ["ls"], { passphrase: "the-WRONG-passphrase" });
      expect(ls.code).toBe(1);
      expect(ls.stderr).toContain("wrong passphrase or corrupted");
      expect(ls.stdout).toBe("");
    });
  });

  it("upsert replaces a field value without duplicating it", async () => {
    await withSandbox(async (home) => {
      await runLockit(home, ["set", "openai/dev", "K"], { passphrase: PW, stdin: "first" });
      await runLockit(home, ["set", "openai/dev", "K"], { passphrase: PW, stdin: "second" });
      const ls = await runLockit(home, ["ls"], { passphrase: PW });
      // Still a single comma-free key (no duplicate "K,K").
      expect(ls.stdout).toBe("openai/dev  [openai]  K\n");

      const run = await runLockit(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write(process.env.K === 'second' ? 'OK' : 'BAD:'+process.env.K)",
        ],
        { passphrase: PW },
      );
      expect(run.stdout).toBe("OK");
    });
  });
});
