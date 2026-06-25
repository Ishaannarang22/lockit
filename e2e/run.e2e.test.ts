import { describe, expect, it } from "vitest";
import { runVeyl, withSandbox } from "./helpers.js";

const PW = "e2e-run-pass";
const SECRET = "sk-e2e-RUN-SECRET-abcdefghij";

/** Seed a single env-type secret used by most run tests. */
async function seed(home: string, key = "MYKEY", value = SECRET): Promise<void> {
  const set = await runVeyl(home, ["set", "openai/dev", key], { passphrase: PW, stdin: value });
  expect(set.code).toBe(0);
}

describe("lockit run (e2e, real binary)", () => {
  it("injects the env var (child reads it) but masks it in kv's forwarded stdout", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write(process.env.MYKEY ?? 'MISSING')",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).not.toContain("MISSING"); // injection worked
      expect(run.stdout).not.toContain(SECRET); // but masked
      expect(run.stdout).toBe("***");
    });
  });

  it("masks the value on the child's stderr too", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        ["run", "openai/dev", "--", "node", "-e", "process.stderr.write(process.env.MYKEY)"],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stderr).not.toContain(SECRET);
      expect(run.stderr).toBe("***");
    });
  });

  it("keeps the value masked when the child splits it across two timed writes", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "const v=process.env.MYKEY;process.stdout.write('A'+v.slice(0,10));setTimeout(()=>process.stdout.write(v.slice(10)+'B'),40)",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).not.toContain(SECRET);
      expect(run.stdout).toBe("A***B");
    });
  });

  it("masks longest-first so a value that is a substring of another is fully covered", async () => {
    await withSandbox(async (home) => {
      await runVeyl(home, ["set", "openai/dev", "SHORT"], { passphrase: PW, stdin: "abc" });
      await runVeyl(home, ["set", "openai/dev", "LONG"], { passphrase: PW, stdin: "abcXYZ" });
      const run = await runVeyl(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write(process.env.LONG+'|'+process.env.SHORT)",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).not.toContain("abc");
      expect(run.stdout).not.toContain("XYZ");
      expect(run.stdout).toBe("***|***");
    });
  });

  it("preserves non-value output around the mask", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write('before '+process.env.MYKEY+' after')",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("before *** after");
    });
  });

  it("does not inject file-type fields into the child env (v1: env-only)", async () => {
    await withSandbox(async (home) => {
      await runVeyl(home, ["set", "openai/dev", "FILEFIELD", "--file"], {
        passphrase: PW,
        stdin: SECRET,
      });
      const run = await runVeyl(
        home,
        [
          "run",
          "openai/dev",
          "--",
          "node",
          "-e",
          "process.stdout.write(process.env.FILEFIELD===undefined?'ABSENT':'PRESENT')",
        ],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("ABSENT");
      expect(run.stdout).not.toContain(SECRET);
    });
  });

  it("works with the explicit -- separator", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        ["run", "openai/dev", "--", "node", "-e", "process.stdout.write('ok')"],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("ok");
    });
  });

  it("works with the no-'--' form", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        ["run", "openai/dev", "node", "-e", "process.stdout.write('ok')"],
        { passphrase: PW },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("ok");
    });
  });

  it("propagates the child's own non-zero exit code (7)", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(home, ["run", "openai/dev", "node", "-e", "process.exit(7)"], {
        passphrase: PW,
      });
      expect(run.code).toBe(7);
    });
  });

  it("returns 137 for a SIGKILL-terminated child (128 + 9)", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        ["run", "openai/dev", "node", "-e", "process.kill(process.pid,'SIGKILL')"],
        { passphrase: PW },
      );
      expect(run.code).toBe(137);
    });
  });

  it("returns 143 for a SIGTERM-terminated child (128 + 15)", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        ["run", "openai/dev", "node", "-e", "process.kill(process.pid,'SIGTERM')"],
        { passphrase: PW },
      );
      expect(run.code).toBe(143);
    });
  });

  it("missing slug is a hard error naming the slug, exit 1", async () => {
    await withSandbox(async (home) => {
      const run = await runVeyl(home, ["run", "nope/missing", "node", "-e", ""], { passphrase: PW });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("no secret: nope/missing");
      expect(run.stdout).toBe("");
    });
  });

  it("does not prefix-match a slug (strict resolver): 'openai' != 'openai/dev'", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(home, ["run", "openai", "node", "-e", ""], { passphrase: PW });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("no secret: openai");
    });
  });

  it("a spawn failure (command not found) is reported on stderr with exit 1", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(home, ["run", "openai/dev", "this-binary-does-not-exist-kv-e2e"], {
        passphrase: PW,
      });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("failed to run this-binary-does-not-exist-kv-e2e");
      expect(run.stderr).not.toContain(SECRET);
    });
  });

  it("usage error with no slug (exit 1)", async () => {
    await withSandbox(async (home) => {
      const run = await runVeyl(home, ["run"], { passphrase: PW });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("usage: lockit run <slug> [--] <cmd> [args...]");
    });
  });

  it("usage error with a slug but no command (exit 1)", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(home, ["run", "openai/dev"], { passphrase: PW });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("usage: lockit run <slug> [--] <cmd> [args...]");
    });
  });

  it("usage error with a bare -- and no command (exit 1)", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(home, ["run", "openai/dev", "--"], { passphrase: PW });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("usage: lockit run <slug> [--] <cmd> [args...]");
    });
  });

  it("missing LOCKIT_PASSPHRASE is a clear error with exit 1 (no spawn)", async () => {
    await withSandbox(async (home) => {
      const run = await runVeyl(home, ["run", "openai/dev", "node", "-e", ""], {
        env: { LOCKIT_PASSPHRASE: "" },
      });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("LOCKIT_PASSPHRASE is not set");
    });
  });

  it("a wrong passphrase refuses to decrypt before running anything (exit 1)", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        ["run", "openai/dev", "node", "-e", "process.stdout.write('SHOULD-NOT-RUN')"],
        { passphrase: "WRONG-passphrase" },
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("wrong passphrase or corrupted");
      expect(run.stdout).not.toContain("SHOULD-NOT-RUN");
    });
  });

  it("the child inherits the parent env in addition to injected vars", async () => {
    await withSandbox(async (home) => {
      await seed(home);
      const run = await runVeyl(
        home,
        [
          "run",
          "openai/dev",
          "node",
          "-e",
          "process.stdout.write(process.env.INHERITED_MARKER ?? 'NO')",
        ],
        { passphrase: PW, env: { INHERITED_MARKER: "marker-xyz" } },
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("marker-xyz");
    });
  });
});

describe("lockit entry point (e2e)", () => {
  it("an unrecognized command exits 1 and prints usage on stderr", async () => {
    await withSandbox(async (home) => {
      const r = await runVeyl(home, ["frobnicate"], { passphrase: PW });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("usage: lockit <set|ls|run>");
      expect(r.stdout).toBe("");
    });
  });

  it("no command at all exits 1 and prints usage", async () => {
    await withSandbox(async (home) => {
      const r = await runVeyl(home, [], { passphrase: PW });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("usage: lockit <set|ls|run>");
    });
  });
});
