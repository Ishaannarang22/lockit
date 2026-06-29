import { readFile, writeFile } from "node:fs/promises";
import {
  acceptSecretShare,
  createSecretShare,
  loadOrCreateIdentity,
  loadStore,
  parsePublicIdentity,
  publicIdentity,
  saveStore,
  serializePublicIdentity,
  storePath,
} from "@lockit/core";
import { resolveKey, type Io } from "./commands.js";

interface RelayMessage {
  id: string;
  artifact: string;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.length === 0) throw new Error(`${flag} requires a non-empty value`);
  return value;
}

export async function cmdIdentity(io: Io): Promise<number> {
  let out: string | undefined;
  try {
    for (let i = 0; i < io.argv.length; i++) {
      const arg = io.argv[i] ?? "";
      if (arg === "--out") {
        out = requireValue(io.argv, i, "--out");
        i++;
      } else {
        io.err("usage: lockit identity [--out <file>]\n");
        return 1;
      }
    }
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const identity = await loadOrCreateIdentity(await resolveKey(io));
  const text = serializePublicIdentity(publicIdentity(identity));
  if (out !== undefined) {
    await writeFile(out, text, { encoding: "utf8", mode: 0o644 });
    io.out(`wrote public identity ${identity.id} to ${out}\n`);
  } else {
    io.out(text);
  }
  return 0;
}

export async function cmdShare(io: Io): Promise<number> {
  const slug = io.argv[0];
  if (slug === undefined) {
    io.err("usage: lockit share <slug> --to <public-identity.json> [--out <file>] [--relay <url>]\n");
    return 1;
  }
  let to: string | undefined;
  let out: string | undefined;
  let relay: string | undefined;
  try {
    for (let i = 1; i < io.argv.length; i++) {
      const arg = io.argv[i] ?? "";
      if (arg === "--to") {
        to = requireValue(io.argv, i, "--to");
        i++;
      } else if (arg === "--out") {
        out = requireValue(io.argv, i, "--out");
        i++;
      } else if (arg === "--relay") {
        relay = requireValue(io.argv, i, "--relay");
        i++;
      } else {
        io.err("usage: lockit share <slug> --to <public-identity.json> [--out <file>] [--relay <url>]\n");
        return 1;
      }
    }
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  if (to === undefined) {
    io.err("--to is required\n");
    return 1;
  }

  const passphrase = await resolveKey(io);
  const recipient = parsePublicIdentity(await readFile(to, "utf8"));
  const sender = await loadOrCreateIdentity(passphrase);
  const store = await loadStore(passphrase, storePath());
  let artifact: string;
  try {
    artifact = await createSecretShare(store, slug, { sender, recipient });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  if (out !== undefined) {
    await writeFile(out, `${artifact}\n`, { encoding: "utf8", mode: 0o600 });
    io.out(`wrote encrypted share for ${recipient.id} to ${out}\n`);
  }
  if (relay !== undefined) {
    try {
      const id = await postRelay(relay, recipient.id, artifact);
      io.out(`sent encrypted share ${id} to ${recipient.id}\n`);
    } catch (e) {
      io.err(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }
  if (out === undefined && relay === undefined) {
    io.out(`${artifact}\n`);
  }
  return 0;
}

export async function cmdAccept(io: Io): Promise<number> {
  const file = io.argv[0];
  if (file === undefined) {
    io.err("usage: lockit accept <share-file> [--as <slug>]\n");
    return 1;
  }
  let as: string | undefined;
  try {
    for (let i = 1; i < io.argv.length; i++) {
      const arg = io.argv[i] ?? "";
      if (arg === "--as") {
        as = requireValue(io.argv, i, "--as");
        i++;
      } else {
        io.err("usage: lockit accept <share-file> [--as <slug>]\n");
        return 1;
      }
    }
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const passphrase = await resolveKey(io);
  const identity = await loadOrCreateIdentity(passphrase);
  const store = await loadStore(passphrase, storePath());
  try {
    const options = as === undefined ? {} : { as };
    const accepted = await acceptSecretShare(store, await readFile(file, "utf8"), identity, options);
    await saveStore(accepted.store, passphrase, storePath());
    io.out(`accepted encrypted share as ${accepted.slug}\n`);
    return 0;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

export async function cmdReceive(io: Io): Promise<number> {
  let relay: string | undefined;
  try {
    for (let i = 0; i < io.argv.length; i++) {
      const arg = io.argv[i] ?? "";
      if (arg === "--relay") {
        relay = requireValue(io.argv, i, "--relay");
        i++;
      } else {
        io.err("usage: lockit receive --relay <url>\n");
        return 1;
      }
    }
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  if (relay === undefined) {
    io.err("--relay is required\n");
    return 1;
  }

  const passphrase = await resolveKey(io);
  const identity = await loadOrCreateIdentity(passphrase);
  const messages = await getRelayMessages(relay, identity.id);
  let store = await loadStore(passphrase, storePath());
  let count = 0;
  for (const message of messages) {
    try {
      const accepted = await acceptSecretShare(store, message.artifact, identity);
      store = accepted.store;
      count++;
      await deleteRelayMessage(relay, message.id);
    } catch (e) {
      io.err(`skipped share ${message.id}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  await saveStore(store, passphrase, storePath());
  io.out(`received ${count} share${count === 1 ? "" : "s"}\n`);
  return 0;
}

async function postRelay(relay: string, to: string, artifact: string): Promise<string> {
  const res = await fetch(`${relay.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, artifact }),
  });
  if (!res.ok) throw new Error(`relay send failed: ${res.status}`);
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error("relay send failed: missing message id");
  return body.id;
}

async function getRelayMessages(relay: string, to: string): Promise<RelayMessage[]> {
  const res = await fetch(`${relay.replace(/\/$/, "")}/messages/${encodeURIComponent(to)}`);
  if (!res.ok) throw new Error(`relay receive failed: ${res.status}`);
  const body = (await res.json()) as { messages?: unknown };
  if (!Array.isArray(body.messages)) throw new Error("relay receive failed: malformed response");
  return body.messages.filter((m): m is RelayMessage => {
    if (typeof m !== "object" || m === null) return false;
    const row = m as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.artifact === "string";
  });
}

async function deleteRelayMessage(relay: string, id: string): Promise<void> {
  await fetch(`${relay.replace(/\/$/, "")}/messages/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
