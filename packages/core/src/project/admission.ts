import type { StoreData } from "../store/store.js";
import type { Vault } from "./vault.js";

export interface Ref {
  slug: string;
  field: string;
}

/** Parse a "slug#field" reference. Throws on a malformed reference. */
export function parseRef(ref: string): Ref {
  const hash = ref.indexOf("#");
  if (hash <= 0 || hash === ref.length - 1) throw new Error(`invalid reference: ${ref}`);
  return { slug: ref.slice(0, hash), field: ref.slice(hash + 1) };
}

export type BindingResolution =
  | { status: "ok"; value: string; ref: string }
  | { status: "unbound" }
  | { status: "missing"; ref: string };

/** Resolve a bound env-var name to its current value through the store. The
 *  sandbox: a name not bound in the vault is `unbound` — never a global guess.
 *  A bound name whose secret/field has since vanished is `missing`. */
export function resolveBinding(store: StoreData, vault: Vault, name: string): BindingResolution {
  const ref = vault.bindings[name];
  if (ref === undefined) return { status: "unbound" };
  let parsed: Ref;
  try {
    parsed = parseRef(ref);
  } catch {
    return { status: "missing", ref };
  }
  const secret = store.secrets.find((s) => s.slug === parsed.slug);
  const field = secret?.fields.find((f) => f.key === parsed.field);
  if (field === undefined || field.type !== "env") return { status: "missing", ref };
  return { status: "ok", value: field.value, ref };
}

/** Resolve every bound env var for a project, for `run` injection. Returns the
 *  env map for resolvable bindings and the names whose refs are missing. */
export function resolveVaultEnv(
  store: StoreData,
  vault: Vault,
): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of Object.keys(vault.bindings)) {
    const r = resolveBinding(store, vault, name);
    if (r.status === "ok") env[name] = r.value;
    else missing.push(name);
  }
  return { env, missing };
}

export type AdmitResolution =
  | { status: "ok"; slug: string; field: string }
  | { status: "none" }
  | { status: "multi-field"; slug: string; fields: string[] };

/** Resolve what `lockit admit <query>` should bind. `query` is either a bare
 *  slug (must have exactly one field) or a `slug#field`. Value-free results. */
export function resolveAdmit(store: StoreData, query: string): AdmitResolution {
  if (query.includes("#")) {
    let parsed: Ref;
    try {
      parsed = parseRef(query);
    } catch {
      return { status: "none" };
    }
    const secret = store.secrets.find((s) => s.slug === parsed.slug);
    const field = secret?.fields.find((f) => f.key === parsed.field);
    return field ? { status: "ok", slug: parsed.slug, field: parsed.field } : { status: "none" };
  }
  const secret = store.secrets.find((s) => s.slug === query);
  if (secret === undefined || secret.fields.length === 0) return { status: "none" };
  if (secret.fields.length === 1) {
    return { status: "ok", slug: query, field: secret.fields[0]!.key };
  }
  return { status: "multi-field", slug: query, fields: secret.fields.map((f) => f.key).sort() };
}
