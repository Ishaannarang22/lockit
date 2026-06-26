import { parseKeyfile } from "./keyfile.js";

/** Keychain service name under which the store key is filed (account varies). */
export const KEYCHAIN_SERVICE = "dev.lockit.cli.store-key";

export interface LoadStoreKeyDeps {
  env: NodeJS.ProcessEnv;
  /** Existing keyfile contents (plaintext key or marker), or undefined if none yet. */
  readKeyfile: () => string | undefined;
  /** Whether keychain-backed protection is usable (macOS + Swift toolchain). */
  keychainAvailable: () => boolean;
  /** Id of the current helper build (see keychainkey HELPER_ID). */
  helperId: string;
  /** Re-key a foreign keychain item (created by a different helper build) into a fresh,
   *  current-bound item and update the marker — heals the keychain re-trust prompt. */
  rekey: (service: string, oldAccount: string, key: string) => Promise<void>;
  /** Generate a fresh random store key (base64). */
  randomKey: () => string;
  /** Generate a fresh keychain account id. */
  newAccount: () => string;
  wrap: (service: string, account: string, secret: string) => Promise<boolean>;
  unwrap: (service: string, account: string) => Promise<string>;
  /** Session-aware unlock for the normal read path (reuses a recent Touch ID). */
  unlock: (service: string, account: string) => Promise<string>;
  del: (service: string, account: string) => Promise<void>;
  writeMarker: (service: string, account: string) => void;
  warn?: (msg: string) => void;
}

/** Resolve the store key, keeping the decryption key protected by default.
 *
 *  - `LOCKIT_PASSPHRASE` overrides everything (you manage your own key).
 *  - First use: the key is CREATED directly in the keychain — a plaintext key is
 *    never written to disk. Without a usable keychain, we refuse rather than write
 *    plaintext (set `LOCKIT_PASSPHRASE` instead).
 *  - A keychain marker triggers a Touch ID unwrap.
 *  - A legacy plaintext keyfile is auto-migrated into the keychain (verified) when
 *    possible; if migration can't run/complete it keeps working and retries later. */
export async function loadStoreKey(deps: LoadStoreKeyDeps): Promise<string> {
  const envKey = deps.env.LOCKIT_PASSPHRASE;
  if (envKey !== undefined && envKey.length > 0) return envKey;

  const content = deps.readKeyfile();

  if (content === undefined) {
    if (!deps.keychainAvailable()) {
      throw new Error(
        "lockit will not store a decryption key in plaintext. Set LOCKIT_PASSPHRASE, " +
          "or run on macOS with Xcode Command Line Tools so the key can live in the keychain.",
      );
    }
    const key = deps.randomKey();
    const account = deps.newAccount();
    await deps.wrap(KEYCHAIN_SERVICE, account, key); // no Touch ID to create
    deps.writeMarker(KEYCHAIN_SERVICE, account);
    return key;
  }

  const parsed = parseKeyfile(content);
  if (parsed.kind === "keychain") {
    const key = await deps.unlock(parsed.service, parsed.account);
    // If a different helper build created this item, reads prompt for a keychain
    // re-trust. Re-key once into a fresh, current-bound item so it stops.
    if (parsed.helper !== deps.helperId) {
      await deps.rekey(parsed.service, parsed.account, key);
    }
    return key;
  }

  // Legacy plaintext key. Migrate into the keychain if we can; never break access.
  if (deps.keychainAvailable()) {
    try {
      await protectKeyOn(parsed.key, deps);
    } catch {
      // couldn't protect right now (e.g. Touch ID cancelled) — keep the plaintext
      // key working; protectKeyOn already cleaned up any orphan keychain item.
    }
    return parsed.key;
  }

  deps.warn?.(
    "warning: the store key is a plaintext file; set LOCKIT_PASSPHRASE or use macOS to protect it\n",
  );
  return parsed.key;
}

/** Whether merely *using* the store already requires a live OS authentication — i.e.
 *  the key is keychain-protected and not overridden by LOCKIT_PASSPHRASE. When true, a
 *  command that unlocks the store has already proven human presence, so a SECOND
 *  presence prompt (e.g. the admission gate) is redundant and should be skipped. */
export function isKeychainProtected(
  env: NodeJS.ProcessEnv,
  readKeyfile: () => string | undefined,
): boolean {
  const passphrase = env.LOCKIT_PASSPHRASE;
  if (passphrase !== undefined && passphrase.length > 0) return false;
  const content = readKeyfile();
  return content !== undefined && parseKeyfile(content).kind === "keychain";
}

export interface ProtectOnOps {
  wrap: (service: string, account: string, secret: string) => Promise<boolean>;
  unwrap: (service: string, account: string) => Promise<string>;
  del: (service: string, account: string) => Promise<void>;
  writeMarker: (service: string, account: string) => void;
  newAccount: () => string;
}

/** Move a plaintext key into the keychain. Stores it, then PROVES a Touch-ID unwrap
 *  round-trips to the same bytes BEFORE writing the marker — so the plaintext keyfile
 *  is only overwritten once the protected key is provably recoverable. Any failure
 *  (mismatch or cancelled auth) deletes the freshly-stored item and rethrows. */
export async function protectKeyOn(currentKey: string, ops: ProtectOnOps): Promise<void> {
  const service = KEYCHAIN_SERVICE;
  const account = ops.newAccount();

  await ops.wrap(service, account, currentKey);

  let roundTrip: string;
  try {
    roundTrip = await ops.unwrap(service, account); // triggers Touch ID
  } catch (e) {
    await ops.del(service, account);
    throw e instanceof Error ? e : new Error(String(e));
  }
  if (roundTrip !== currentKey) {
    await ops.del(service, account);
    throw new Error("keychain verification failed; plaintext keyfile left unchanged");
  }

  ops.writeMarker(service, account);
}
