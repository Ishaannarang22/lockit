import type { StoreData, StoredField } from "./store.js";

export type RefResolveResult =
  | { status: "found"; bundle: string; field: StoredField }
  | { status: "none" }
  | { status: "ambiguous"; bundles: string[] };

export type ResolveResult =
  | { status: "found"; bundle: string; field: StoredField }
  | { status: "none" }
  | { status: "ambiguous"; bundles: string[] };

/** Resolve a variable name (bare `KEY` or qualified `bundle#KEY`) to a single
 *  field, strictly 0/1/N. Never guesses on ambiguity. */
export function resolveVar(store: StoreData, name: string): ResolveResult {
  const hash = name.indexOf("#");
  if (hash !== -1) {
    const bundle = name.slice(0, hash);
    const key = name.slice(hash + 1);
    const sec = store.secrets.find((s) => s.slug === bundle);
    const field = sec?.fields.find((f) => f.key === key);
    return field ? { status: "found", bundle, field } : { status: "none" };
  }
  const matches: { bundle: string; field: StoredField }[] = [];
  for (const sec of store.secrets) {
    const field = sec.fields.find((f) => f.key === name);
    if (field) matches.push({ bundle: sec.slug, field });
  }
  if (matches.length === 0) return { status: "none" };
  if (matches.length === 1) {
    const m = matches[0]!;
    return { status: "found", bundle: m.bundle, field: m.field };
  }
  const bundles = [...new Set(matches.map((m) => m.bundle))].sort();
  return { status: "ambiguous", bundles };
}

/** Resolve a provider reference (`@pulse`, `@supabase/acme#SUPABASE_URL`, etc.)
 *  to a single field. The `ref` param has NO leading `@`.
 *  Strictly 0/1/N — never guesses. */
export function resolveRef(store: StoreData, ref: string): RefResolveResult {
  const hashIdx = ref.indexOf("#");
  const locator = hashIdx !== -1 ? ref.slice(0, hashIdx) : ref;
  const fieldKey = hashIdx !== -1 ? ref.slice(hashIdx + 1) : undefined;

  // Determine candidate secrets by locator type.
  const isSlug = locator.includes("/");
  const candidates = store.secrets.filter((s) => {
    if (isSlug) {
      // Exact slug or aka match.
      return s.slug === locator || s.aka.includes(locator);
    } else {
      // Provider token: schema match OR first slug segment match.
      return s.schema === locator || s.slug.split("/")[0] === locator;
    }
  });

  // Count distinct slugs.
  const distinctSlugs = [...new Set(candidates.map((s) => s.slug))].sort();

  if (distinctSlugs.length === 0) return { status: "none" };
  if (distinctSlugs.length > 1) return { status: "ambiguous", bundles: distinctSlugs };

  // Exactly one candidate secret.
  const secret = candidates[0]!;

  if (fieldKey !== undefined) {
    const field = secret.fields.find((f) => f.key === fieldKey);
    return field ? { status: "found", bundle: secret.slug, field } : { status: "none" };
  }

  if (secret.fields.length === 1) {
    return { status: "found", bundle: secret.slug, field: secret.fields[0]! };
  }

  // Multiple fields, no fieldKey specified.
  return { status: "ambiguous", bundles: [secret.slug] };
}
