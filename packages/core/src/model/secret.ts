export type FieldType = "env" | "file";

/** A named field within a Secret. The model surface is value-free: it carries
 *  structure plus `hasValue`, never the secret value itself. */
export interface Field {
  key: string;
  type: FieldType;
  hasValue: boolean;
}

export interface Version {
  id: string;
  current: boolean;
  createdAt: string;
}

export interface Secret {
  slug: string; // portable identity, e.g. "supabase/acme"
  schema: string; // registry name or free string
  aka: string[]; // rename-safe aliases
  fields: Field[];
  versions: Version[];
  tags: string[];
  localId?: string; // machine-local only, never committed/portable
}

export interface SecretInput {
  slug: string;
  schema: string;
  fields?: Field[];
  aka?: string[];
  tags?: string[];
}

// A slug is a portable identity: lowercase alphanumeric segments (with . _ -)
// joined by "/", each segment starting alphanumeric. No spaces, no leading/trailing slash.
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Build a normalized, value-free Secret, rejecting an invalid slug, an empty
 *  schema, or duplicate field keys. */
export function createSecret(input: SecretInput): Secret {
  if (!isValidSlug(input.slug)) {
    throw new Error(`invalid slug: ${JSON.stringify(input.slug)}`);
  }
  if (input.schema.length === 0) {
    throw new Error("schema must not be empty");
  }
  const fields = input.fields ?? [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) throw new Error(`duplicate field key: ${f.key}`);
    seen.add(f.key);
  }
  return {
    slug: input.slug,
    schema: input.schema,
    aka: input.aka ?? [],
    fields,
    versions: [],
    tags: input.tags ?? [],
  };
}
