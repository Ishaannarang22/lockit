import { isValidFieldKey } from "../store/store.js";

export interface Reference {
  envName: string;
  ref: string; // the token AFTER the '@'
}

/** Parse a reference file — an `.env`-shaped file where every value is a
 *  `@token` reference, never a real secret value.
 *
 *  Throws a descriptive error (with 1-based line number) for:
 *  - an invalid env-var identifier on the left-hand side
 *  - a value that does not start with `@` (security guard: this file must
 *    never contain a real value)
 */
export function parseReferences(text: string): Reference[] {
  const refs: Reference[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) throw new Error(`malformed reference line ${i + 1}: no "=" found`);
    const envName = withoutExport.slice(0, eq).trim();
    if (!isValidFieldKey(envName))
      throw new Error(
        `malformed reference line ${i + 1}: invalid key ${JSON.stringify(envName)}`,
      );
    const value = withoutExport.slice(eq + 1);
    if (!value.startsWith("@"))
      throw new Error(`malformed reference line ${i + 1}: value is not a @reference`);
    refs.push({ envName, ref: value.slice(1) });
  }
  return refs;
}

/** Serialize references back to reference-file text.
 *  Each entry becomes `ENV_NAME=@ref\n`. Round-trips exactly for well-formed input. */
export function serializeReferences(refs: Reference[]): string {
  return refs.map((r) => `${r.envName}=@${r.ref}\n`).join("");
}
