import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lockitHome } from "@lockit/core";

/** Touch-ID-gated key storage for an UNSIGNED / ad-hoc npm CLI on macOS.
 *
 *  Secure Enclave and biometric keychain ACLs are unavailable without an Apple
 *  Developer signing identity (errSecMissingEntitlement -34018). So instead the
 *  store key is filed in the login keychain as a generic password — encrypted at
 *  rest, and (because this helper is a COMPILED binary with a stable code identity)
 *  the item's default ACL binds it to this binary, so another same-user process
 *  reading it off disk hits a keychain prompt. Every unwrap is gated behind
 *  LAContext.evaluatePolicy(.deviceOwnerAuthentication) — a real Touch ID / account
 *  -password prompt, which DOES work unsigned.
 *
 *  Honest limit: this is an authorization gate, not a hardware key release. It is a
 *  large improvement over a flat plaintext keyfile, but not the Secure Enclave. */
const KVKEY_SWIFT = `import Foundation
import Security
import LocalAuthentication

func errOut(_ s: String) { FileHandle.standardError.write((s + "\\n").data(using: .utf8)!) }
@inline(__always) func die(_ code: Int32, _ msg: String) -> Never { errOut("kvkey: " + msg); exit(code) }

let args = CommandLine.arguments
guard args.count >= 4 else { die(1, "usage: kvkey <wrap|unwrap|delete> <service> <account>") }
let cmd = args[1], service = args[2], account = args[3]

func baseQuery() -> [String: Any] {
    [ kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account ]
}

func authOrExit(reason: String) {
    let ctx = LAContext()
    ctx.localizedReason = reason
    var canErr: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &canErr) else {
        die(3, "authentication unavailable: \\(canErr?.localizedDescription ?? "unknown")")
    }
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    var laCode: Int = 0
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
        ok = success
        if let e = error as NSError? { laCode = e.code }
        sem.signal()
    }
    sem.wait()
    if ok { return }
    switch laCode {
    case LAError.userCancel.rawValue, LAError.appCancel.rawValue, LAError.systemCancel.rawValue:
        die(2, "authentication cancelled")
    case LAError.biometryNotAvailable.rawValue, LAError.biometryNotEnrolled.rawValue,
         LAError.passcodeNotSet.rawValue, LAError.biometryLockout.rawValue:
        die(3, "authentication unavailable (code \\(laCode))")
    default:
        die(1, "authentication failed (code \\(laCode))")
    }
}

switch cmd {
case "wrap":
    let keyData = FileHandle.standardInput.readDataToEndOfFile()
    guard !keyData.isEmpty else { die(1, "no key bytes on stdin") }
    SecItemDelete(baseQuery() as CFDictionary)
    var add = baseQuery()
    add[kSecValueData as String] = keyData
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let st = SecItemAdd(add as CFDictionary, nil)
    if st != errSecSuccess {
        die(1, "SecItemAdd failed: OSStatus \\(st) (\\(SecCopyErrorMessageString(st, nil).map{$0 as String} ?? "?"))")
    }
    exit(0)

case "unwrap":
    authOrExit(reason: "Unlock your lockit store key")
    var q = baseQuery()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &out)
    if st == errSecItemNotFound { die(1, "no key stored for \\(service)/\\(account)") }
    if st != errSecSuccess {
        die(1, "SecItemCopyMatching failed: OSStatus \\(st) (\\(SecCopyErrorMessageString(st, nil).map{$0 as String} ?? "?"))")
    }
    guard let data = out as? Data else { die(1, "unexpected keychain payload") }
    FileHandle.standardOutput.write(data)
    exit(0)

case "peek":
    // No-auth read for the unlock-session cache. Not-found -> exit 4 (so the caller
    // just misses the cache instead of erroring). Bound to this binary's identity.
    var pq = baseQuery()
    pq[kSecReturnData as String] = true
    pq[kSecMatchLimit as String] = kSecMatchLimitOne
    var pout: CFTypeRef?
    let pst = SecItemCopyMatching(pq as CFDictionary, &pout)
    if pst == errSecItemNotFound { exit(4) }
    if pst != errSecSuccess { die(1, "peek failed: OSStatus \\(pst)") }
    guard let pdata = pout as? Data else { die(1, "unexpected keychain payload") }
    FileHandle.standardOutput.write(pdata)
    exit(0)

case "delete":
    let st = SecItemDelete(baseQuery() as CFDictionary)
    if st != errSecSuccess && st != errSecItemNotFound {
        die(1, "SecItemDelete failed: OSStatus \\(st)")
    }
    exit(0)

default:
    die(1, "unknown command \\(cmd)")
}
`;

const SRC_HASH = createHash("sha256").update(KVKEY_SWIFT).digest("hex").slice(0, 12);

/** Identifies the current helper build. A keychain item's ACL is bound to the binary
 *  that created it, so when this changes (a new helper build after an upgrade) existing
 *  items become "foreign" and reads prompt for a keychain re-trust. The marker records
 *  the helper that created the item so we can re-key into a fresh, current-bound item. */
export const HELPER_ID = SRC_HASH;

function binDir(): string {
  return join(lockitHome(), "bin");
}

/** Path to the cached compiled helper. Keyed by a hash of the source so an
 *  unchanged helper reuses the same binary (stable cdhash → no keychain re-trust);
 *  a changed source compiles to a new path. */
function binaryPath(): string {
  return join(binDir(), `kvkey-${SRC_HASH}`);
}

/** Compile the helper once and cache it; reuse on subsequent calls. Throws a clear
 *  error if the Swift toolchain (`swiftc`, from Xcode Command Line Tools) is absent. */
function ensureBinary(): string {
  const bin = binaryPath();
  if (existsSync(bin)) return bin;
  mkdirSync(binDir(), { recursive: true, mode: 0o700 });
  const src = `${bin}.swift`;
  writeFileSync(src, KVKEY_SWIFT, { mode: 0o600 });
  const r = spawnSync(
    "swiftc",
    [src, "-O", "-o", bin, "-framework", "Security", "-framework", "LocalAuthentication", "-framework", "Foundation"],
    { encoding: "utf8" },
  );
  if (r.error !== undefined || r.status !== 0) {
    const why = r.error?.message ?? r.stderr ?? `exit ${String(r.status)}`;
    throw new Error(
      `could not build the keychain helper (needs macOS + Xcode Command Line Tools / swiftc): ${why}`,
    );
  }
  return bin;
}

/** Whether keychain-backed protection is usable here: macOS with the Swift
 *  toolchain (`swiftc`, from Xcode Command Line Tools) present to build the helper. */
export function keychainAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  const r = spawnSync("swiftc", ["--version"], { stdio: "ignore" });
  return r.error === undefined && r.status === 0;
}

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function run(args: string[], input?: Buffer): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let bin: string;
    try {
      bin = ensureBinary();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") });
    });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

/** Store `secret` in the keychain under service/account (overwrites). No Touch ID. */
export async function keychainWrap(
  service: string,
  account: string,
  secret: string,
): Promise<boolean> {
  const r = await run(["wrap", service, account], Buffer.from(secret, "utf8"));
  if (r.code !== 0) throw new Error(r.stderr.trim() || "keychain wrap failed");
  return true;
}

/** Read the stored secret. Triggers Touch ID / account-password. Rejects on
 *  cancel (exit 2), unavailable (exit 3), or any other failure. */
export async function keychainUnwrap(service: string, account: string): Promise<string> {
  const r = await run(["unwrap", service, account]);
  if (r.code === 0) return r.stdout.toString("utf8");
  if (r.code === 2) throw new Error("Touch ID cancelled; the store stays locked");
  if (r.code === 3) throw new Error("Touch ID / password unavailable on this machine");
  throw new Error(r.stderr.trim() || "keychain unwrap failed");
}

/** Remove the stored secret. Idempotent. */
export async function keychainDelete(service: string, account: string): Promise<void> {
  const r = await run(["delete", service, account]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "keychain delete failed");
}

/** Read a cached value WITHOUT Touch ID (for the unlock-session cache). Returns
 *  undefined if absent or unreadable — the caller then falls back to a real unwrap. */
export async function keychainPeek(service: string, account: string): Promise<string | undefined> {
  try {
    const r = await run(["peek", service, account]);
    return r.code === 0 ? r.stdout.toString("utf8") : undefined;
  } catch {
    return undefined;
  }
}
