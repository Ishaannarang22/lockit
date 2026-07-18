import type { FieldType } from "../model/secret.js";
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
  | { status: "ok"; value: string; ref: string; type: FieldType }
  | { status: "unbound" }
  | { status: "missing"; ref: string };

/** Resolve a bound env-var name to its current value through the store. The
 *  sandbox: a name not bound in the vault is `unbound` — never a global guess.
 *  A bound name whose secret/field has since vanished is `missing`. Carries the
 *  field `type` so injection can distinguish `env` (value) from `file` (path to
 *  materialized 0600 file); for a `file` field `value` is the file CONTENTS. */
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
  if (field === undefined) return { status: "missing", ref };
  return { status: "ok", value: field.value, ref, type: field.type };
}

/** Resolve every bound env var for a project, for `run` injection. Returns:
 *  - `env`: env-field bindings (env-var name -> value, injected inline);
 *  - `files`: file-field bindings (env-var name -> file CONTENTS; the CLI
 *    materializes each to a 0600 temp file and injects the env var as its PATH);
 *  - `missing`: names whose refs no longer resolve. */
export function resolveVaultEnv(
  store: StoreData,
  vault: Vault,
): { env: Record<string, string>; files: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  const files: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of Object.keys(vault.bindings)) {
    const r = resolveBinding(store, vault, name);
    if (r.status !== "ok") {
      missing.push(name);
    } else if (r.type === "file") {
      files[name] = r.value;
    } else {
      env[name] = r.value;
    }
  }
  return { env, files, missing };
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
