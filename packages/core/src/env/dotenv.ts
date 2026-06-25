import { isValidFieldKey } from "../store/store.js";

export interface DotenvEntry {
  key: string;
  value: string;
}

/** Strip one matching pair of surrounding single or double quotes. */
function unquote(raw: string): string {
  if (raw.length >= 2) {
    const a = raw[0];
    const b = raw[raw.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return raw.slice(1, -1);
  }
  return raw;
}

/** Parse `.env`-format text into ordered entries. Throws on a malformed line,
 *  naming the 1-based line number. Does not deduplicate — the caller upserts. */
export function parseDotenv(text: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) throw new Error(`malformed .env line ${i + 1}: no "=" found`);
    const key = withoutExport.slice(0, eq).trim();
    if (!isValidFieldKey(key))
      throw new Error(`malformed .env line ${i + 1}: invalid key ${JSON.stringify(key)}`);
    const value = unquote(withoutExport.slice(eq + 1).trim());
    entries.push({ key, value });
  }
  return entries;
}

export interface MergeResult {
  text: string;
  wrote: string[];
  skipped: string[];
}

const KEY_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** The key a line assigns, or null for blanks/comments/other lines. */
function lineKey(line: string): string | null {
  const m = KEY_LINE_RE.exec(line.endsWith("\r") ? line.slice(0, -1) : line);
  return m ? (m[1] ?? null) : null;
}

/** Serialize a value, quoting only when it contains whitespace, `#`, or quotes. */
function serializeValue(value: string): string {
  return /[\s#'"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Merge entries into `.env` text. Present keys are skipped unless `force`,
 *  in which case their existing lines are dropped and the new value appended. */
export function mergeDotenv(
  existingText: string,
  entries: DotenvEntry[],
  opts: { force: boolean },
): MergeResult {
  const present = new Set<string>();
  for (const line of existingText.split("\n")) {
    const k = lineKey(line);
    if (k) present.add(k);
  }
  const entryKeys = new Set(entries.map((e) => e.key));

  let baseText = existingText;
  const wrote: string[] = [];
  const skipped: string[] = [];
  let toAppend: DotenvEntry[];

  if (opts.force) {
    baseText = existingText
      .split("\n")
      .filter((line) => {
        const k = lineKey(line);
        return !(k !== null && entryKeys.has(k));
      })
      .join("\n");
    toAppend = entries;
    for (const e of entries) wrote.push(e.key);
  } else {
    toAppend = [];
    for (const e of entries) {
      if (present.has(e.key)) skipped.push(e.key);
      else {
        toAppend.push(e);
        wrote.push(e.key);
      }
    }
  }

  let text = baseText;
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  for (const e of toAppend) text += `${e.key}=${serializeValue(e.value)}\n`;
  return { text, wrote, skipped };
}
