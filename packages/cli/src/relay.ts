import { readFileSync, existsSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { lockitHome } from "@lockit/core";
import type { Io } from "./commands.js";

/** The shared public relay every lockit install can reach out of the box.
 *  It stores only ciphertext and public keys; all crypto is client-side. */
export const DEFAULT_RELAY = "https://lockit-u8ii.onrender.com";

export type RelaySource = "flag" | "env" | "config" | "default";

export interface ResolvedRelay {
  url: string;
  source: RelaySource;
}

function relayConfigPath(): string {
  return join(lockitHome(), "relay");
}

function validateRelayUrl(url: string, origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${origin}: not a valid relay URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${origin}: relay URL must be http(s), got ${parsed.protocol}//`);
  }
  return url;
}

/** The relay to use, by fixed precedence: --relay flag, LOCKIT_RELAY env,
 *  $LOCKIT_HOME/relay config file, built-in public relay. The config file is
 *  value-free (a public URL), so it lives beside the store as plain text. */
export function resolveRelay(io: Io, explicit?: string): ResolvedRelay {
  if (explicit !== undefined) {
    return { url: validateRelayUrl(explicit, "--relay"), source: "flag" };
  }
  const env = io.env.LOCKIT_RELAY;
  if (env !== undefined && env.length > 0) {
    return { url: validateRelayUrl(env, "LOCKIT_RELAY"), source: "env" };
  }
  const path = relayConfigPath();
  if (existsSync(path)) {
    const configured = readFileSync(path, "utf8").trim();
    if (configured.length > 0) {
      return { url: validateRelayUrl(configured, path), source: "config" };
    }
  }
  return { url: DEFAULT_RELAY, source: "default" };
}

const RELAY_USAGE = "usage: lockit relay [set <url> | reset]\n";

/** `lockit relay` — show the active relay and where it came from.
 *  `lockit relay set <url>` — persist a relay choice ("bring your own").
 *  `lockit relay reset` — return to the built-in public relay.
 *  No secret material involved, so no store unlock. */
export async function cmdRelay(io: Io): Promise<number> {
  const sub = io.argv[0];

  if (sub === undefined) {
    let resolved: ResolvedRelay;
    try {
      resolved = resolveRelay(io);
    } catch (e) {
      io.err(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    io.out(`${resolved.url} (${resolved.source})\n`);
    return 0;
  }

  if (sub === "set") {
    const url = io.argv[1];
    if (url === undefined || io.argv.length > 2) {
      io.err(RELAY_USAGE);
      return 1;
    }
    try {
      validateRelayUrl(url, "relay set");
    } catch (e) {
      io.err(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await writeFile(relayConfigPath(), `${url}\n`, { encoding: "utf8", mode: 0o644 });
    io.out(`relay set to ${url}\n`);
    return 0;
  }

  if (sub === "reset") {
    if (io.argv.length > 1) {
      io.err(RELAY_USAGE);
      return 1;
    }
    await rm(relayConfigPath(), { force: true });
    io.out(`relay reset to default (${DEFAULT_RELAY})\n`);
    return 0;
  }

  io.err(RELAY_USAGE);
  return 1;
}
