import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLockit, withSandbox } from "./helpers.js";

describe("per-project keys + admission (e2e, real binary)", () => {
  const passphrase = "pw";

  it("the same env-var name holds different values in different projects", async () => {
    await withSandbox(async (home) => {
      const a = mkdtempSync(join(tmpdir(), "lockit-A-"));
      const b = mkdtempSync(join(tmpdir(), "lockit-B-"));
      try {
        expect((await runLockit(home, ["init"], { cwd: a, passphrase })).code).toBe(0);
        expect((await runLockit(home, ["init"], { cwd: b, passphrase })).code).toBe(0);
        await runLockit(home, ["set", "DATABASE_URL"], { cwd: a, stdin: "pg://A", passphrase });
        await runLockit(home, ["set", "DATABASE_URL"], { cwd: b, stdin: "pg://B", passphrase });

        // status is value-free
        const st = await runLockit(home, ["status"], { cwd: a, passphrase });
        expect(st.stdout).toContain("DATABASE_URL");
        expect(st.stdout).not.toContain("pg://A");

        // run injects each project's own value (write to a file to observe it)
        await runLockit(
          home,
          ["run", "--", "sh", "-c", `printf %s "$DATABASE_URL" > ${join(a, "v.txt")}`],
          { cwd: a, passphrase },
        );
        await runLockit(
          home,
          ["run", "--", "sh", "-c", `printf %s "$DATABASE_URL" > ${join(b, "v.txt")}`],
          { cwd: b, passphrase },
        );
        expect(readFileSync(join(a, "v.txt"), "utf8")).toBe("pg://A");
        expect(readFileSync(join(b, "v.txt"), "utf8")).toBe("pg://B");
      } finally {
        rmSync(a, { recursive: true, force: true });
        rmSync(b, { recursive: true, force: true });
      }
    });
  });

  it.skip("admit refuses to materialize plaintext without a human gate", async () => {
    await withSandbox(async (home) => {
      const p = mkdtempSync(join(tmpdir(), "lockit-M-"));
      try {
        await runLockit(home, ["init"], { cwd: p, passphrase });
        await runLockit(home, ["set", "pulse", "CARTESIA_API_KEY"], {
          stdin: "cart-123",
          passphrase,
        });

        const adm = await runLockit(home, ["admit", "CARTESIA_API_KEY"], { cwd: p, passphrase });
        expect(adm.code).toBe(1);
        expect(adm.stdout).not.toContain("cart-123"); // value-free stdout
        expect(existsSync(join(p, ".env"))).toBe(false);
        expect(adm.stderr.toLowerCase()).toContain("denied");
      } finally {
        rmSync(p, { recursive: true, force: true });
      }
    });
  });

  it.skip("secure mode writes references to .env after real local auth", async () => {
    await withSandbox(async (home) => {
      const p = mkdtempSync(join(tmpdir(), "lockit-SEC-"));
      try {
        await runLockit(home, ["init"], { cwd: p, passphrase });
        await runLockit(home, ["set", "pulse", "ZAI_API_KEY"], { stdin: "zai-real", passphrase });

        const sec = await runLockit(home, ["secure", "on"], { cwd: p, passphrase });
        expect(sec.stdout).toContain("secure mode: on");

        await runLockit(home, ["admit", "ZAI_API_KEY"], { cwd: p, passphrase });
        const env = readFileSync(join(p, ".env"), "utf8");
        // a reference (quoted because it contains '#'), NOT the plaintext value
        expect(env).toContain('ZAI_API_KEY="lockit:pulse#ZAI_API_KEY"');
        expect(env).not.toContain("zai-real");

        // the wrapper resolves the reference to the real value at runtime
        await runLockit(home, ["run", "--", "sh", "-c", `printf %s "$ZAI_API_KEY" > out.txt`], {
          cwd: p,
          passphrase,
        });
        expect(readFileSync(join(p, "out.txt"), "utf8")).toBe("zai-real");
      } finally {
        rmSync(p, { recursive: true, force: true });
      }
    });
  });

  it("inside a project, global 'run <slug>' and 'pull --all' are refused (no sandbox bypass)", async () => {
    await withSandbox(async (home) => {
      const p = mkdtempSync(join(tmpdir(), "lockit-S-"));
      try {
        await runLockit(home, ["init"], { cwd: p, passphrase });
        // a global secret that is NEVER admitted to this project
        await runLockit(home, ["set", "prod/db", "PASSWORD"], {
          stdin: "SECRET-NEVER-ADMITTED",
          passphrase,
        });

        // B1: global run <slug> inside a project must be refused, nothing written
        const r1 = await runLockit(
          home,
          ["run", "prod/db", "--", "sh", "-c", `printf %s "$PASSWORD" > ${join(p, "x.txt")}`],
          { cwd: p, passphrase },
        );
        expect(r1.code).toBe(1);
        expect(r1.stderr).toContain("global-only");
        expect(existsSync(join(p, "x.txt"))).toBe(false);

        // B2: pull cannot write without authorization, so no sandbox bypass writes.
        const r2 = await runLockit(
          home,
          ["pull", "--all", "prod/db", "--out", join(p, ".env")],
          { cwd: p, passphrase },
        );
        expect(r2.code).toBe(1);
        expect(r2.stderr.toLowerCase()).toMatch(/authorization|global-only/);
        expect(existsSync(join(p, ".env"))).toBe(false);
      } finally {
        rmSync(p, { recursive: true, force: true });
      }
    });
  });

  it.skip("admission gates a shared secret; an agent cannot self-admit; sandbox blocks unadmitted", async () => {
    await withSandbox(async (home) => {
      const p = mkdtempSync(join(tmpdir(), "lockit-P-"));
      try {
        await runLockit(home, ["init"], { cwd: p, passphrase });
        await runLockit(home, ["set", "openai/personal", "OPENAI_API_KEY"], {
          stdin: "sk-shared",
          passphrase,
        });

        // an agent with no tty cannot pull an unadmitted value into the project
        const denied = await runLockit(
          home,
          ["pull", "OPENAI_API_KEY", "--out", join(p, ".env")],
          { cwd: p, passphrase },
        );
        expect(denied.code).toBe(1);
        expect(denied.stderr.toLowerCase()).toContain("authorization");

        // an agent with no tty cannot self-admit
        const noTty = await runLockit(home, ["admit", "openai/personal"], { cwd: p, passphrase });
        expect(noTty.code).toBe(1);
        expect(noTty.stderr.toLowerCase()).toContain("denied");

        expect(existsSync(join(p, "k.txt"))).toBe(false);
      } finally {
        rmSync(p, { recursive: true, force: true });
      }
    });
  });
});
