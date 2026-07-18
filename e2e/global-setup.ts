import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Build crypto → core → cli once so the e2e suite drives the real compiled
 *  binary (the actual shipped artifact), not the TypeScript source. Then build the
 *  test-only dist-e2e binary (real binary + a controllable presence gate) used by
 *  the human-gated flow tests. dist-e2e never ships (see packaging-guard test). */
export default function setup(): void {
  execFileSync("pnpm", ["-r", "build"], { cwd: ROOT, stdio: "inherit" });
  execFileSync("node", ["packages/cli/scripts/build-e2e-gate.mjs"], { cwd: ROOT, stdio: "inherit" });
}
