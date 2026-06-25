import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLockit, withSandbox } from "./helpers.js";

describe("per-project keys + admission (e2e, real binary)", () => {
  it("the same env-var name holds different values in different projects", async () => {
    await withSandbox(async (home) => {
      const a = mkdtempSync(join(tmpdir(), "lockit-A-"));
      const b = mkdtempSync(join(tmpdir(), "lockit-B-"));
      try {
        expect((await runLockit(home, ["init"], { cwd: a })).code).toBe(0);
        expect((await runLockit(home, ["init"], { cwd: b })).code).toBe(0);
        await runLockit(home, ["set", "DATABASE_URL"], { cwd: a, stdin: "pg://A" });
        await runLockit(home, ["set", "DATABASE_URL"], { cwd: b, stdin: "pg://B" });

        // status is value-free
        const st = await runLockit(home, ["status"], { cwd: a });
        expect(st.stdout).toContain("DATABASE_URL");
        expect(st.stdout).not.toContain("pg://A");

        // run injects each project's own value (write to a file to observe it)
        await runLockit(
          home,
          ["run", "--", "sh", "-c", `printf %s "$DATABASE_URL" > ${join(a, "v.txt")}`],
          { cwd: a },
        );
        await runLockit(
          home,
          ["run", "--", "sh", "-c", `printf %s "$DATABASE_URL" > ${join(b, "v.txt")}`],
          { cwd: b },
        );
        expect(readFileSync(join(a, "v.txt"), "utf8")).toBe("pg://A");
        expect(readFileSync(join(b, "v.txt"), "utf8")).toBe("pg://B");
      } finally {
        rmSync(a, { recursive: true, force: true });
        rmSync(b, { recursive: true, force: true });
      }
    });
  });

  it("admission gates a shared secret; an agent (no tty) cannot self-admit; sandbox blocks unadmitted", async () => {
    await withSandbox(async (home) => {
      const p = mkdtempSync(join(tmpdir(), "lockit-P-"));
      try {
        await runLockit(home, ["init"], { cwd: p });
        await runLockit(home, ["set", "openai/personal", "OPENAI_API_KEY"], { stdin: "sk-shared" });

        // sandbox: an unadmitted name can't be pulled in the project
        const denied = await runLockit(
          home,
          ["pull", "OPENAI_API_KEY", "--out", join(p, ".env"), "--yes"],
          { cwd: p },
        );
        expect(denied.code).toBe(1);
        expect(denied.stderr).toContain("not admitted");

        // an agent with no tty cannot self-admit
        const noTty = await runLockit(home, ["admit", "openai/personal"], { cwd: p });
        expect(noTty.code).toBe(1);
        expect(noTty.stderr.toLowerCase()).toContain("denied");

        // human authorizes (bypass stands in for the presence gate in tests)
        const adm = await runLockit(home, ["admit", "openai/personal"], {
          cwd: p,
          env: { LOCKIT_PULL_YES: "1" },
        });
        expect(adm.code).toBe(0);

        // now it's admitted: run injects it
        await runLockit(
          home,
          ["run", "--", "sh", "-c", `printf %s "$OPENAI_API_KEY" > ${join(p, "k.txt")}`],
          { cwd: p },
        );
        expect(readFileSync(join(p, "k.txt"), "utf8")).toBe("sk-shared");
      } finally {
        rmSync(p, { recursive: true, force: true });
      }
    });
  });
});
