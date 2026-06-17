import { aeadSeal, aeadOpen, randomBytes } from "./aead.js";
import { deriveKey, DEFAULT_KDF_PARAMS, type KdfParams } from "./kdf.js";
import { encodeBlob, decodeBlob, BLOB_VERSION } from "./blob.js";

const SALT_BYTES = 16;

export async function sealWithPassphrase(
  plaintext: Uint8Array,
  passphrase: string,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<string> {
  const salt = await randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt, params);
  const sealed = await aeadSeal(plaintext, key);
  return encodeBlob({
    v: BLOB_VERSION,
    kdf: { algo: "argon2id", salt, params },
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
  });
}

export async function openWithPassphrase(
  blobText: string,
  passphrase: string,
): Promise<Uint8Array> {
  const blob = decodeBlob(blobText);
  const key = await deriveKey(passphrase, blob.kdf.salt, blob.kdf.params);
  return aeadOpen({ nonce: blob.nonce, ciphertext: blob.ciphertext }, key);
}
