import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(ROOT, "packages/cli");

// SECURITY GUARD: the test-only presence-gate bypass (dist-e2e/) must NEVER reach
// the published npm package. If any of these fail, the bypass is leaking — treat
// it as a release blocker, not a flaky test.
describe("packaging guard — the e2e auth bypass never ships", () => {
  it("npm pack contains no dist-e2e / overlay files", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: CLI,
      encoding: "utf8",
    });
    const files: string[] = (JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map(
      (f) => f.path,
    );
    const leaked = files.filter(
      (p) => p.includes("dist-e2e") || p.includes("localauth.real") || p.includes("build-e2e-gate"),
    );
    expect(leaked, `these bypass files would be published: ${leaked.join(", ")}`).toEqual([]);
    // sanity: the real gate module IS shipped
    expect(files.some((p) => p === "dist/localauth.js")).toBe(true);
  });

  it("shipped dist/localauth.js keeps the real gate and has no LOCKIT_E2E_GATE hook", () => {
    const shipped = readFileSync(resolve(CLI, "dist/localauth.js"), "utf8");
    expect(shipped).not.toContain("LOCKIT_E2E_GATE");
    // the shipped gate still routes through the real macOS LocalAuthentication path
    expect(shipped).toContain("runSwiftGate");
  });

  it("the dist-e2e overlay exists and is the ONLY place the bypass env var lives", () => {
    const overlay = resolve(CLI, "dist-e2e/localauth.js");
    expect(existsSync(overlay), "run scripts/build-e2e-gate.mjs first (global-setup does)").toBe(
      true,
    );
    expect(readFileSync(overlay, "utf8")).toContain("LOCKIT_E2E_GATE");
  });
});
