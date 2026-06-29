import { isValidSlug, type FieldType, type Secret } from "../model/secret.js";

/** A field with its (decrypted, in-memory) value. This is the plaintext shape
 *  that gets sealed as a whole; the listing surface projects it to value-free. */
export interface StoredField {
  key: string;
  type: FieldType;
  value: string;
}

export interface StoredSecret {
  slug: string;
  schema: string;
  fields: StoredField[];
  aka: string[];
  tags: string[];
}

export interface StoreData {
  version: 1;
  secrets: StoredSecret[];
}

export interface UpsertFieldInput {
  slug: string;
  schema: string;
  key: string;
  type: FieldType;
  value: string;
}

// A field key is the env-var name it injects as, so it must be a valid env-var
// identifier — no spaces, "=", or newlines that would corrupt the child's env.
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidFieldKey(key: string): boolean {
  return ENV_KEY_RE.test(key);
}

export function emptyStore(): StoreData {
  return { version: 1, secrets: [] };
}

export function getSecret(store: StoreData, slug: string): StoredSecret | undefined {
  return store.secrets.find((s) => s.slug === slug);
}

/** Add a secret (if new) and set/replace one field value. Returns a new store. */
export function upsertField(store: StoreData, input: UpsertFieldInput): StoreData {
  if (!isValidSlug(input.slug)) throw new Error(`invalid slug: ${JSON.stringify(input.slug)}`);
  if (input.schema.length === 0) throw new Error("schema must not be empty");
  if (!isValidFieldKey(input.key)) {
    throw new Error(`invalid field key: ${JSON.stringify(input.key)}`);
  }
  // Deep copy-on-write: new field OBJECTS (not just a new array) so updating an
  // existing field's value cannot mutate the input store's shared field.
  const secrets = store.secrets.map((s) => ({
    ...s,
    fields: s.fields.map((f) => ({ ...f })),
    aka: [...s.aka],
    tags: [...s.tags],
  }));
  let sec = secrets.find((s) => s.slug === input.slug);
  if (!sec) {
    sec = { slug: input.slug, schema: input.schema, fields: [], aka: [], tags: [] };
    secrets.push(sec);
  }
  const existing = sec.fields.find((f) => f.key === input.key);
  if (existing) {
    existing.type = input.type;
    existing.value = input.value;
  } else {
    sec.fields.push({ key: input.key, type: input.type, value: input.value });
  }
  return { version: 1, secrets };
}

/** Append a provenance/label tag to a secret (by slug), deduped. Copy-on-write:
 *  returns a new store and never mutates the input. No-op if the slug is unknown
 *  or the tag is already present. */
export function addTag(store: StoreData, slug: string, tag: string): StoreData {
  const secrets = store.secrets.map((s) => ({
    ...s,
    fields: s.fields.map((f) => ({ ...f })),
    aka: [...s.aka],
    tags: [...s.tags],
  }));
  const sec = secrets.find((s) => s.slug === slug);
  if (sec && !sec.tags.includes(tag)) {
    sec.tags.push(tag);
  }
  return { version: 1, secrets };
}

export function removeSecret(store: StoreData, slug: string): StoreData {
  return { version: 1, secrets: store.secrets.filter((s) => s.slug !== slug) };
}

/** Value-free projection for listing: structure + `hasValue`, never the value. */
export function listSecrets(store: StoreData): Secret[] {
  return store.secrets.map((s) => ({
    slug: s.slug,
    schema: s.schema,
    aka: [...s.aka],
    fields: s.fields.map((f) => ({ key: f.key, type: f.type, hasValue: f.value.length > 0 })),
    versions: [],
    tags: [...s.tags],
  }));
}

/** The env-var map for injection: `env`-type fields only. */
export function secretEnv(secret: StoredSecret): Record<string, string> {
  const env: Record<string, string> = {};
  for (const f of secret.fields) {
    if (f.type === "env") env[f.key] = f.value;
  }
  return env;
}
