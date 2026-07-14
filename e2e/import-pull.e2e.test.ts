import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLockit, withSandbox } from "./helpers.js";

describe("import + pull (e2e, real binary)", () => {
  it("imports a .env, lists vars value-free, and refuses pull without a human gate", async () => {
    await withSandbox(async (home) => {
      const proj = mkdtempSync(join(tmpdir(), "lockit-proj-"));
      try {
        const src = join(proj, ".env");
        writeFileSync(src, "API_KEY=sk-live-123\nFOO=bar\n");

        // import the .env into the encrypted store
        const imp = await runLockit(home, ["import", src, "--as", "app/dev"], { passphrase: "pw" });
        expect(imp.code).toBe(0);

        // discovery is value-free
        const ls = await runLockit(home, ["ls", "--vars"], { passphrase: "pw" });
        expect(ls.code).toBe(0);
        expect(ls.stdout).toContain("API_KEY");
        expect(ls.stdout).toContain("app/dev");
        expect(ls.stdout).not.toContain("sk-live-123");

        // No /dev/tty in the spawned process → pull refuses and writes nothing.
        const out = join(proj, "out.env");
        const denied = await runLockit(home, ["pull", "API_KEY", "--out", out], {
          passphrase: "pw",
        });
        expect(denied.code).toBe(1);
        expect(existsSync(out)).toBe(false);
        expect(denied.stderr.toLowerCase()).toContain("authorization");

        const yes = await runLockit(home, ["pull", "API_KEY", "--out", out, "--yes"], {
          passphrase: "pw",
        });
        expect(yes.code).toBe(1);
        expect(existsSync(out)).toBe(false);
        expect(yes.stderr).toContain("--yes");
      } finally {
        rmSync(proj, { recursive: true, force: true });
      }
    });
  });
});
