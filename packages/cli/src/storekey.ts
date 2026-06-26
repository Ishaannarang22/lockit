import { parseKeyfile } from "./keyfile.js";

/** Keychain service name under which the store key is filed (account varies). */
export const KEYCHAIN_SERVICE = "dev.lockit.cli.store-key";

export interface LoadKeyDeps {
  env: NodeJS.ProcessEnv;
  /** Reads (creating if absent) the raw keyfile contents — plaintext key or marker. */
  readKeyfile: () => string;
  /** Touch-ID-gated keychain read; resolves the stored key or rejects (cancel/unavailable). */
  unwrap: (service: string, account: string) => Promise<string>;
}

/** Resolve the store key. `LOCKIT_PASSPHRASE` overrides everything (never prompts).
 *  Otherwise: a plaintext keyfile is used as-is; a keychain marker triggers a
 *  Touch-ID unwrap. */
export async function loadKey(deps: LoadKeyDeps): Promise<string> {
  const envKey = deps.env.LOCKIT_PASSPHRASE;
  if (envKey !== undefined && envKey.length > 0) return envKey;

  const parsed = parseKeyfile(deps.readKeyfile());
  if (parsed.kind === "plaintext") return parsed.key;
  return deps.unwrap(parsed.service, parsed.account);
}

export interface ProtectOnOps {
  wrap: (service: string, account: string, secret: string) => Promise<boolean>;
  unwrap: (service: string, account: string) => Promise<string>;
  del: (service: string, account: string) => Promise<void>;
  writeMarker: (service: string, account: string) => void;
  newAccount: () => string;
}

/** Move a plaintext key into the keychain. Stores it, then PROVES a Touch-ID
 *  unwrap round-trips to the same bytes BEFORE writing the marker — so we never
 *  destroy the plaintext keyfile unless the protected key is provably recoverable.
 *  On any mismatch the freshly-stored item is deleted and the keyfile is untouched. */
export async function protectKeyOn(currentKey: string, ops: ProtectOnOps): Promise<void> {
  const service = KEYCHAIN_SERVICE;
  const account = ops.newAccount();

  await ops.wrap(service, account, currentKey);

  const roundTrip = await ops.unwrap(service, account); // triggers Touch ID
  if (roundTrip !== currentKey) {
    await ops.del(service, account);
    throw new Error("keychain verification failed; plaintext keyfile left unchanged");
  }

  ops.writeMarker(service, account);
}

export interface ProtectOffOps {
  unwrap: (service: string, account: string) => Promise<string>;
  del: (service: string, account: string) => Promise<void>;
  writePlaintext: (key: string) => void;
}

/** Move the key back out of the keychain to a plaintext keyfile. Unwraps (Touch ID)
 *  and writes the plaintext FIRST, only then deletes the keychain item — never the
 *  other way round, so a failure can't leave the key irrecoverable. */
export async function protectKeyOff(
  service: string,
  account: string,
  ops: ProtectOffOps,
): Promise<string> {
  const key = await ops.unwrap(service, account); // triggers Touch ID
  ops.writePlaintext(key);
  await ops.del(service, account);
  return key;
}
