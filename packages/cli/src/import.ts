import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  addTag,
  builtinRegistry,
  emptyStore,
  loadStore,
  parseDotenv,
  providerForEnv,
  saveStore,
  storePath,
  upsertField,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

/** Turn an arbitrary string into a valid lowercase slug segment. */
function slugifySegment(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return s.length > 0 ? s : "imported";
}

/** Free-string provider fallback when the registry doesn't recognize an env key:
 *  the lowercased leading underscore-segment, slugified (e.g. `FOO_API_KEY` ->
 *  `foo`, `TOKEN` -> `token`). Never the cwd. */
function fallbackProvider(envKey: string): string {
  const lead = envKey.split("_")[0] ?? envKey;
  return slugifySegment(lead);
}

/** `lockit import [path] [--as <slug>]` — read a .env into the encrypted store. */
export async function cmdImport(io: Io): Promise<number> {
  const passphrase = await resolveKey(io);

  let path: string | undefined;
  let slug: string | undefined;
  for (let i = 0; i < io.argv.length; i++) {
    const arg = io.argv[i] ?? "";
    if (arg === "--as") {
      const next = io.argv[i + 1];
      if (next === undefined || next.length === 0) {
        io.err("--as requires a non-empty slug\n");
        return 1;
      }
      slug = next;
      i++;
    } else if (path === undefined) {
      path = arg;
    }
  }
  const filePath = path ?? "./.env";
  // The cwd is provenance, never identity: it becomes a `source:` tag only.
  const cwdName = slugifySegment(basename(process.cwd()));
  const sourceTag = `source:${cwdName}`;

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let entries;
  try {
    entries = parseDotenv(text);
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const sp = storePath();
  let store;
  try {
    store = await loadStore(passphrase, sp);
  } catch {
    store = emptyStore();
  }

  let target: string;
  if (slug !== undefined) {
    // Explicit identity: all entries land under `slug`; schema is its first segment.
    const schema = slug.split("/")[0] ?? slug;
    for (const entry of entries) {
      store = upsertField(store, {
        slug,
        schema,
        key: entry.key,
        type: "env",
        value: entry.value,
      });
    }
    store = addTag(store, slug, sourceTag);
    target = slug;
  } else {
    // Per entry, derive the canonical provider from the registry (or a free-string
    // fallback). The provider is both slug and schema; the cwd is only a tag.
    for (const entry of entries) {
      const provider = providerForEnv(builtinRegistry, entry.key) ?? fallbackProvider(entry.key);
      store = upsertField(store, {
        slug: provider,
        schema: provider,
        key: entry.key,
        type: "env",
        value: entry.value,
      });
      store = addTag(store, provider, sourceTag);
    }
    target = "the store";
  }

  await saveStore(store, passphrase, sp);

  io.out(`imported ${entries.length} var(s) into ${target}\n`);
  return 0;
}
