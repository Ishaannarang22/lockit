import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  emptyStore,
  loadStore,
  parseDotenv,
  saveStore,
  storePath,
  upsertField,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

/** Turn an arbitrary directory name into a valid lowercase slug segment. */
function slugifyDir(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return s.length > 0 ? s : "imported";
}

/** `lockit import [path] [--as <slug>]` — read a .env into the encrypted store. */
export async function cmdImport(io: Io): Promise<number> {
  const passphrase = resolveKey(io);

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
  const resolvedSlug = slug ?? slugifyDir(basename(process.cwd()));
  const schema = resolvedSlug.split("/")[0] ?? resolvedSlug;

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
  for (const entry of entries) {
    store = upsertField(store, {
      slug: resolvedSlug,
      schema,
      key: entry.key,
      type: "env",
      value: entry.value,
    });
  }
  await saveStore(store, passphrase, sp);

  io.out(`imported ${entries.length} var(s) into ${resolvedSlug}\n`);
  return 0;
}
