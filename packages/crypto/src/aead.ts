// libsodium-wrappers-sumo is pinned to exactly 0.7.15 in package.json: 0.7.16's
// published ESM/CJS entry points have a broken relative import of the wasm module
// ("./libsodium-sumo.mjs") and fail to load. Bump the pin only after verifying.
import _sodium from "libsodium-wrappers-sumo";

await _sodium.ready;
const sodium = _sodium;

export const KEY_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES; // 32
export const NONCE_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES; // 24

export interface SealedBytes {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

// randomBytes/aeadSeal/aeadOpen are async only to keep this module's surface
// uniformly Promise-based (and to allow a future native/async sodium backend);
// the sumo backend resolves synchronously once `await _sodium.ready` completes.

/** Cryptographically-secure random bytes from libsodium's CSPRNG. */
export async function randomBytes(n: number): Promise<Uint8Array> {
  return sodium.randombytes_buf(n);
}

/** Seal `plaintext` under a 32-byte `key` with a fresh random nonce; `aad` is authenticated, not encrypted. */
export async function aeadSeal(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Promise<SealedBytes> {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key,
  );
  return { nonce, ciphertext };
}

/** Open a sealed value; rejects if the key is wrong, the `aad` differs, or the ciphertext was tampered. */
export async function aeadOpen(
  sealed: SealedBytes,
  key: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes`);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sealed.ciphertext,
    aad,
    sealed.nonce,
    key,
  );
}
