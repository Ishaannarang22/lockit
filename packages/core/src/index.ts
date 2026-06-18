export { createSecret, isValidSlug } from "./model/secret.js";
export type { Secret, Field, FieldType, Version, SecretInput } from "./model/secret.js";
export {
  emptyStore,
  upsertField,
  getSecret,
  listSecrets,
  removeSecret,
  secretEnv,
} from "./store/store.js";
export type { StoreData, StoredSecret, StoredField, UpsertFieldInput } from "./store/store.js";
export { saveStore, loadStore } from "./store/store-persist.js";
export { kvHome, storePath } from "./paths.js";
