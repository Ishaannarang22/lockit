import { argon2id } from "hash-wasm";

export interface KdfParams {
  iterations: number; // time cost
  memorySize: number; // KiB
  parallelism: number;
}

// Interactive-tier defaults; tuned higher for production in a later task.
export const DEFAULT_KDF_PARAMS: KdfParams = {
  iterations: 3,
  memorySize: 65536, // 64 MiB
  parallelism: 1,
};

const MIN_SALT_BYTES = 8;
const KEY_LENGTH = 32;

// Bounds for params that may arrive from a (possibly tampered) sealed blob.
// Floors reject cryptographically-weak settings; ceilings stop a hostile
// header from forcing unbounded CPU/RAM — or an uncontrolled allocation crash.
const MIN_MEMORY_KIB = 8 * 1024; // 8 MiB
const MAX_MEMORY_KIB = 1024 * 1024; // 1 GiB
const MAX_ITERATIONS = 16;
const MAX_PARALLELISM = 4;

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;

function assertSaneKdfParams(p: KdfParams): void {
  if (!isPositiveInt(p.iterations) || p.iterations > MAX_ITERATIONS) {
    throw new Error(`kdf iterations out of range: ${p.iterations}`);
  }
  if (!isPositiveInt(p.memorySize) || p.memorySize < MIN_MEMORY_KIB || p.memorySize > MAX_MEMORY_KIB) {
    throw new Error(`kdf memorySize out of range: ${p.memorySize}`);
  }
  if (!isPositiveInt(p.parallelism) || p.parallelism > MAX_PARALLELISM) {
    throw new Error(`kdf parallelism out of range: ${p.parallelism}`);
  }
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  if (salt.length < MIN_SALT_BYTES) {
    throw new Error(`salt must be at least ${MIN_SALT_BYTES} bytes`);
  }
  assertSaneKdfParams(params);
  return argon2id({
    password: passphrase,
    salt,
    iterations: params.iterations,
    memorySize: params.memorySize,
    parallelism: params.parallelism,
    hashLength: KEY_LENGTH,
    outputType: "binary",
  });
}
