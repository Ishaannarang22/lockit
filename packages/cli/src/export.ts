import { writeFile } from "node:fs/promises";
import {
  builtinRegistry,
  entryFor,
  listSecrets,
  loadStore,
  serializeReferences,
  storePath,
  type Reference,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

/** `lockit export [--out <path>]` — write a VALUE-FREE reference file: an
 *  `.env`-shaped file whose right-hand sides are `@references`, never real
 *  values. This is the file a user commits to git so a teammate's own keys can
 *  fill it. The output contains only `ENV=@ref` lines; a value is never written. */
export async function cmdExport(io: Io): Promise<number> {
  let out = "./.env.ref";
  for (let i = 0; i < io.argv.length; i++) {
    const arg = io.argv[i] ?? "";
    if (arg === "--out") {
      const next = io.argv[i + 1];
      if (next === undefined || next.length === 0) {
        io.err("--out requires a non-empty path\n");
        return 1;
      }
      out = next;
      i++;
    }
  }

  let store;
  try {
    store = await loadStore(await resolveKey(io), storePath());
  } catch {
    io.err("could not open the store; nothing written\n");
    return 1;
  }

  const refs: Reference[] = [];
  const seenEnvNames = new Set<string>();
  for (const secret of listSecrets(store)) {
    const provider = secret.slug.split("/")[0] ?? secret.slug;
    const single = secret.fields.length === 1;
    for (const field of secret.fields) {
      if (field.type !== "env") continue;
      const ref = single ? provider : `${secret.slug}#${field.key}`;
      const envName = entryFor(builtinRegistry, provider)?.env?.[field.key]?.[0] ?? field.key;
      if (seenEnvNames.has(envName)) {
        io.err(`duplicate env name ${envName}; qualify or rename before exporting\n`);
        return 1;
      }
      seenEnvNames.add(envName);
      refs.push({ envName, ref });
    }
  }

  await writeFile(out, serializeReferences(refs), "utf8");

  io.out(`exported ${refs.length} reference(s) to ${out}\n`);
  return 0;
}
