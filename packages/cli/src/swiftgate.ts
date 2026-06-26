import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateResult } from "./localauth.js";

/** A tiny macOS LocalAuthentication gate. `.deviceOwnerAuthentication` shows
 *  Touch ID and automatically falls back to the account-password dialog when
 *  biometrics fail / aren't enrolled. It returns ONLY an exit code — never a
 *  secret — so it stays clear of the crypto trust root.
 *
 *  Exit codes: 0 authenticated · 2 user cancel/deny · 3 cannot evaluate. */
const SWIFT_GATE = `import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "authenticate to continue"
let context = LAContext()
let policy: LAPolicy = .deviceOwnerAuthentication

var capError: NSError?
guard context.canEvaluatePolicy(policy, error: &capError) else {
    FileHandle.standardError.write("canEvaluatePolicy failed: \\(capError?.localizedDescription ?? "unknown")\\n".data(using: .utf8)!)
    exit(3)
}

let sema = DispatchSemaphore(value: 0)
var ok = false
var evalError: NSError?
context.evaluatePolicy(policy, localizedReason: reason) { success, error in
    ok = success; evalError = error as NSError?; sema.signal()
}
sema.wait()

if ok { exit(0) }

if let e = evalError {
    FileHandle.standardError.write("evaluatePolicy failed: domain=\\(e.domain) code=\\(e.code) \\(e.localizedDescription)\\n".data(using: .utf8)!)
    switch e.code {
    case -5, -6, -7: exit(3) // passcodeNotSet / biometryNotAvailable / biometryNotEnrolled
    default:         exit(2) // userCancel / systemCancel / authFailed / userFallback ...
    }
}
exit(2)
`;

export interface SpawnOutcome {
  /** Process exit code, or null if it was killed by a signal. */
  code: number | null;
  /** True if the process could not be launched at all (e.g. `swift` not found). */
  spawnError: boolean;
}

export type Spawner = (cmd: string, args: string[]) => Promise<SpawnOutcome>;

const defaultSpawner: Spawner = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", () => {
      resolve({ code: null, spawnError: true });
    });
    child.on("close", (code) => {
      resolve({ code, spawnError: false });
    });
  });

/** Run the macOS LocalAuthentication gate via the system `swift` interpreter.
 *  Returns the gate's exit code, or null if `swift` is unavailable so the caller
 *  can fall back. The audited source is written to a fresh 0600 temp file and
 *  removed immediately — no persistent executable to tamper with. */
export async function runSwiftGate(
  reason: string,
  spawner: Spawner = defaultSpawner,
): Promise<GateResult> {
  const dir = mkdtempSync(join(tmpdir(), "lockit-authgate-"));
  const script = join(dir, "authgate.swift");
  try {
    writeFileSync(script, SWIFT_GATE, { mode: 0o600 });
    const { code, spawnError } = await spawner("swift", [script, reason]);
    if (spawnError) return null;
    return code;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
