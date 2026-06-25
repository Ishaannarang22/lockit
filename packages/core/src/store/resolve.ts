import type { StoreData, StoredField } from "./store.js";

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
