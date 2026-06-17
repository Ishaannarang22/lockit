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

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  if (salt.length < MIN_SALT_BYTES) {
    throw new Error(`salt must be at least ${MIN_SALT_BYTES} bytes`);
  }
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
