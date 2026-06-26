/** Unlock-session cache: after one Touch ID, the released store key is cached (in a
 *  keychain item readable without re-auth, bound to our helper binary) with an expiry,
 *  so back-to-back `lockit` commands within the window don't each re-prompt. Default
 *  90s; `LOCKIT_UNLOCK_TTL` (seconds) tunes it, 0 disables. `lockit lock` clears it. */

const DEFAULT_TTL_MS = 90_000;

/** TTL in ms from `LOCKIT_UNLOCK_TTL` (seconds). Default 90s; 0 disables caching;
 *  non-numeric falls back to the default. */
export function ttlMsFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.LOCKIT_UNLOCK_TTL;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_TTL_MS;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return DEFAULT_TTL_MS;
  return Math.floor(secs * 1000);
}

/** The keychain account under which the session copy is cached (distinct from the
 *  real key's account so they never collide). */
export function sessionAccount(account: string): string {
  return `${account}.session`;
}

/** A cached session value is `"<expiryMs>.<key>"`. Returns the key if still valid
 *  (base64 keys contain no `.`, so splitting on the first dot is unambiguous). */
export function parseSession(value: string | undefined, nowMs: number): string | undefined {
  if (value === undefined) return undefined;
  const dot = value.indexOf(".");
  if (dot <= 0) return undefined;
  const exp = Number(value.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= nowMs) return undefined;
  return value.slice(dot + 1);
}

export interface SessionUnlockDeps {
  ttlMs: number;
  now: () => number;
  /** Read the cached session value without auth (undefined if absent/unreadable). */
  peek: (service: string, account: string) => Promise<string | undefined>;
  /** Touch-ID-gated read of the real key. */
  unwrap: (service: string, account: string) => Promise<string>;
  /** Cache a session value (no auth). */
  writeSession: (service: string, account: string, value: string) => Promise<void>;
}

/** Resolve the store key, reusing a valid unlock session to avoid a fresh Touch ID.
 *  On a miss it does one Touch ID unwrap and refreshes the session. TTL 0 = no cache. */
export async function unlockWithSession(
  service: string,
  account: string,
  deps: SessionUnlockDeps,
): Promise<string> {
  if (deps.ttlMs > 0) {
    const cached = parseSession(await deps.peek(service, sessionAccount(account)), deps.now());
    if (cached !== undefined) return cached;
  }

  const key = await deps.unwrap(service, account); // Touch ID

  if (deps.ttlMs > 0) {
    await deps.writeSession(service, sessionAccount(account), `${deps.now() + deps.ttlMs}.${key}`);
  }
  return key;
}
