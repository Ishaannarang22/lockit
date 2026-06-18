import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Build crypto → core → cli once so the e2e suite drives the real compiled
 *  binary (the actual shipped artifact), not the TypeScript source. */
export default function setup(): void {
  execFileSync("pnpm", ["-r", "build"], { cwd: ROOT, stdio: "inherit" });
}
