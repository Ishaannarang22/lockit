export const CRYPTO_PACKAGE = "@kv/crypto";

export { aeadSeal, aeadOpen, randomBytes, KEY_BYTES, NONCE_BYTES } from "./aead.js";
export type { SealedBytes } from "./aead.js";
export { deriveKey, DEFAULT_KDF_PARAMS } from "./kdf.js";
export type { KdfParams } from "./kdf.js";
export { encodeBlob, decodeBlob, BLOB_VERSION } from "./blob.js";
export type { SealedBlob } from "./blob.js";
export { sealWithPassphrase, openWithPassphrase } from "./vault-seal.js";
