import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLockit, withSandbox } from "./helpers.js";

describe("portable identity (e2e, real binary)", () => {
  it("a value-free reference file authored by A fills with B's OWN key; no value crosses", async () => {
    // Two independent stores (separate sandbox HOMEs) and one shared reference file.
    await withSandbox(async (homeA) => {
      await withSandbox(async (homeB) => {
        const proj = mkdtempSync(join(tmpdir(), "lockit-portable-"));
        try {
          // --- A authors the reference file from her own value ---
          const aEnv = join(proj, "a.env");
          writeFileSync(aEnv, "PULSE_API_KEY=alice-key\n");

          const impA = await runLockit(homeA, ["import", aEnv], { passphrase: "pwA" });
          expect(impA.code).toBe(0);

          const ref = join(proj, "a.env.ref");
          const expA = await runLockit(homeA, ["export", "--out", ref], { passphrase: "pwA" });
          expect(expA.code).toBe(0);

          // The committed reference file carries a reference, NOT A's value.
          const refText = readFileSync(ref, "utf8");
          expect(refText).toContain("PULSE_API_KEY=@pulse");
          expect(refText).not.toContain("alice-key");

          // --- B owns its OWN pulse key (value via stdin only — never argv) ---
          const setB = await runLockit(homeB, ["set", "pulse", "API_KEY"], {
            passphrase: "pwB",
            stdin: "bob-key",
          });
          expect(setB.code).toBe(0);

          // --- B resolves A's reference file against B's store ---
          const bEnv = join(proj, "b.env");
          const res = await runLockit(homeB, ["resolve", ref, "--out", bEnv, "--yes"], {
            passphrase: "pwB",
          });
          expect(res.code).toBe(0);
          expect(res.stdout).not.toContain("bob-key");
          expect(res.stdout).not.toContain("alice-key");

          // Core guarantee: references travel, values do not. B gets B's value.
          const filled = readFileSync(bEnv, "utf8");
          expect(filled).toContain("PULSE_API_KEY=bob-key");
          expect(filled).not.toContain("alice-key");
        } finally {
          rmSync(proj, { recursive: true, force: true });
        }
      });
    });
  });
});
