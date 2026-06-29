export { createSecret, isValidSlug } from "./model/secret.js";
export type { Secret, Field, FieldType, Version, SecretInput } from "./model/secret.js";
export {
  emptyStore,
  upsertField,
  getSecret,
  listSecrets,
  removeSecret,
  secretEnv,
  isValidFieldKey,
  addTag,
} from "./store/store.js";
export type { StoreData, StoredSecret, StoredField, UpsertFieldInput } from "./store/store.js";
export { saveStore, loadStore } from "./store/store-persist.js";
export { lockitHome, storePath } from "./paths.js";
export { parseDotenv, mergeDotenv } from "./env/dotenv.js";
export type { DotenvEntry, MergeResult } from "./env/dotenv.js";
export { parseReferences, serializeReferences } from "./env/reference.js";
export type { Reference } from "./env/reference.js";
export {
  builtinRegistry,
  mergeRegistries,
  entryFor,
  providerForEnv,
} from "./registry/registry.js";
export type { RegistryEntry } from "./registry/registry.js";
export { resolveVar, resolveRef } from "./store/resolve.js";
export type { ResolveResult, RefResolveResult } from "./store/resolve.js";
export {
  emptyVault,
  bindKey,
  unbindKey,
  setVaultSecure,
  vaultRef,
  findProjectRoot,
  vaultPath,
  readVault,
  writeVault,
  initProject,
  projectLocalSlug,
} from "./project/vault.js";
export type { Vault } from "./project/vault.js";
export { parseRef, resolveBinding, resolveVaultEnv, resolveAdmit } from "./project/admission.js";
export type { Ref, BindingResolution, AdmitResolution } from "./project/admission.js";
