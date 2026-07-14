#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { assertIdentityId, publicIdentityFromWire } from "@lockit/crypto";

interface RelayMessage {
  id: string;
  to: string;
  artifact: string;
  receivedAt: string;
}

interface RelayUser {
  username: string;
  usernameDisplay: string;
  identityId: string;
  boxPublicKey: string;
  signPublicKey: string;
  createdAt: string;
  updatedAt: string;
}

interface RelayOptions {
  host: string;
  port: number;
  dataPath?: string;
  databaseUrl?: string;
}

export interface RelayStore {
  listAll(): Promise<RelayMessage[]>;
  append(message: RelayMessage): Promise<void>;
  listForRecipient(to: string): Promise<RelayMessage[]>;
  delete(id: string): Promise<void>;
  getUser(username: string): Promise<RelayUser | undefined>;
  registerUser(user: RelayUser): Promise<"created" | "same" | "conflict">;
}

export type RelayLogger = (line: string) => void;

export interface RelayServerOptions {
  logger?: RelayLogger;
}

const USERNAME_RE = /^[a-z0-9_][a-z0-9_-]{2,31}$/;

export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_RE.test(normalized)) {
    throw new Error("username must be 3-32 chars: lowercase letters, numbers, _ or -");
  }
  return normalized;
}

function parsePort(value: string | undefined, source: string): number | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${source} must be an integer from 0 to 65535`);
  }
  return port;
}

export function parseRelayOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RelayOptions {
  const envPort = parsePort(env.PORT, "PORT");
  let host = env.HOST ?? (envPort === undefined ? "127.0.0.1" : "0.0.0.0");
  let port = envPort ?? 8787;
  let dataPath = env.LOCKIT_RELAY_DATA_PATH;
  let databaseUrl = env.LOCKIT_RELAY_DATABASE_URL ?? env.DATABASE_URL;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--host") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) throw new Error("--host requires a value");
      host = value;
      i++;
    } else if (arg === "--port") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) throw new Error("--port requires a value");
      port = parsePort(value, "--port") ?? port;
      i++;
    } else if (arg === "--data") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) throw new Error("--data requires a value");
      dataPath = value;
      i++;
    } else if (arg === "--database-url") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("--database-url requires a value");
      }
      databaseUrl = value;
      i++;
    } else {
      throw new Error(
        "usage: lockit-relay [--host <host>] [--port <port>] [--data <path>] [--database-url <url>]",
      );
    }
  }
  if (dataPath !== undefined && databaseUrl !== undefined) {
    throw new Error("choose either LOCKIT_RELAY_DATA_PATH or DATABASE_URL, not both");
  }
  return {
    host,
    port,
    ...(dataPath === undefined ? {} : { dataPath }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
  };
}

export function createMemoryRelayStore(
  initial: { messages?: RelayMessage[]; users?: RelayUser[] } | RelayMessage[] = {},
): RelayStore {
  const initialMessages = Array.isArray(initial) ? initial : (initial.messages ?? []);
  const initialUsers = Array.isArray(initial) ? [] : (initial.users ?? []);
  const users = new Map(initialUsers.map((user) => [user.username, user]));
  const messages = [...initialMessages];
  return {
    async listAll() {
      return [...messages];
    },
    async append(message) {
      messages.push(message);
    },
    async listForRecipient(to) {
      return messages.filter((m) => m.to === to);
    },
    async delete(id) {
      const index = messages.findIndex((m) => m.id === id);
      if (index >= 0) messages.splice(index, 1);
    },
    async getUser(username) {
      return users.get(normalizeUsername(username));
    },
    async registerUser(user) {
      const existing = users.get(user.username);
      if (existing !== undefined) {
        if (
          existing.identityId === user.identityId &&
          existing.boxPublicKey === user.boxPublicKey &&
          existing.signPublicKey === user.signPublicKey
        ) {
          return "same";
        }
        return "conflict";
      }
      users.set(user.username, user);
      return "created";
    },
  };
}

function isRelayMessage(value: unknown): value is RelayMessage {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.to === "string" &&
    typeof row.artifact === "string" &&
    typeof row.receivedAt === "string"
  );
}

function isRelayUser(value: unknown): value is RelayUser {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.username === "string" &&
    typeof row.usernameDisplay === "string" &&
    typeof row.identityId === "string" &&
    typeof row.boxPublicKey === "string" &&
    typeof row.signPublicKey === "string" &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string"
  );
}

async function writeRelayData(
  path: string,
  messages: RelayMessage[],
  users: RelayUser[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${String(process.pid)}`;
  await writeFile(tmp, `${JSON.stringify({ v: 1, messages, users }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, path);
}

export async function loadRelayStore(path: string): Promise<RelayStore> {
  let messages: RelayMessage[] = [];
  let users: RelayUser[] = [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      v?: unknown;
      messages?: unknown;
      users?: unknown;
    };
    if (parsed.v !== 1 || !Array.isArray(parsed.messages)) {
      throw new Error("malformed relay data file");
    }
    if (!parsed.messages.every(isRelayMessage)) {
      throw new Error("malformed relay message in data file");
    }
    if (parsed.users !== undefined) {
      if (!Array.isArray(parsed.users) || !parsed.users.every(isRelayUser)) {
        throw new Error("malformed relay user in data file");
      }
      users = parsed.users;
    }
    messages = parsed.messages;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const userMap = new Map(users.map((user) => [user.username, user]));

  async function persist(): Promise<void> {
    await writeRelayData(path, messages, [...userMap.values()]);
  }

  return {
    async listAll() {
      return [...messages];
    },
    async append(message) {
      messages.push(message);
      await persist();
    },
    async listForRecipient(to) {
      return messages.filter((m) => m.to === to);
    },
    async delete(id) {
      const before = messages.length;
      messages = messages.filter((m) => m.id !== id);
      if (messages.length !== before) await persist();
    },
    async getUser(username) {
      return userMap.get(normalizeUsername(username));
    },
    async registerUser(user) {
      const existing = userMap.get(user.username);
      if (existing !== undefined) {
        if (
          existing.identityId === user.identityId &&
          existing.boxPublicKey === user.boxPublicKey &&
          existing.signPublicKey === user.signPublicKey
        ) {
          return "same";
        }
        return "conflict";
      }
      userMap.set(user.username, user);
      await persist();
      return "created";
    },
  };
}

interface MessageRow extends QueryResultRow {
  id: string;
  to_id: string;
  artifact: string;
  received_at: Date | string;
}

interface UserRow extends QueryResultRow {
  username: string;
  username_display: string;
  identity_id: string;
  box_public_key: string;
  sign_public_key: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function messageFromRow(row: MessageRow): RelayMessage {
  return {
    id: row.id,
    to: row.to_id,
    artifact: row.artifact,
    receivedAt:
      row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
  };
}

function userFromRow(row: UserRow): RelayUser {
  return {
    username: row.username,
    usernameDisplay: row.username_display,
    identityId: row.identity_id,
    boxPublicKey: row.box_public_key,
    signPublicKey: row.sign_public_key,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function loadPostgresRelayStore(databaseUrl: string): Promise<RelayStore> {
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`
    create table if not exists lockit_relay_users (
      username text primary key,
      username_display text not null,
      identity_id text not null unique,
      box_public_key text not null,
      sign_public_key text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `);
  await pool.query(`
    create table if not exists lockit_relay_messages (
      id text primary key,
      to_id text not null,
      artifact text not null,
      received_at timestamptz not null
    )
  `);
  await pool.query(`
    create index if not exists lockit_relay_messages_to_id_idx
      on lockit_relay_messages (to_id, received_at)
  `);

  async function getUser(username: string): Promise<RelayUser | undefined> {
    const result = await pool.query<UserRow>(
      "select username, username_display, identity_id, box_public_key, sign_public_key, created_at, updated_at from lockit_relay_users where username = $1",
      [normalizeUsername(username)],
    );
    return result.rows[0] === undefined ? undefined : userFromRow(result.rows[0]);
  }

  return {
    async listAll() {
      const result = await pool.query<MessageRow>(
        "select id, to_id, artifact, received_at from lockit_relay_messages order by received_at",
      );
      return result.rows.map(messageFromRow);
    },
    async append(message) {
      await pool.query(
        "insert into lockit_relay_messages (id, to_id, artifact, received_at) values ($1, $2, $3, $4)",
        [message.id, message.to, message.artifact, message.receivedAt],
      );
    },
    async listForRecipient(to) {
      const result = await pool.query<MessageRow>(
        "select id, to_id, artifact, received_at from lockit_relay_messages where to_id = $1 order by received_at",
        [to],
      );
      return result.rows.map(messageFromRow);
    },
    async delete(id) {
      await pool.query("delete from lockit_relay_messages where id = $1", [id]);
    },
    getUser,
    async registerUser(user) {
      const existing = await getUser(user.username);
      if (existing !== undefined) {
        if (
          existing.identityId === user.identityId &&
          existing.boxPublicKey === user.boxPublicKey &&
          existing.signPublicKey === user.signPublicKey
        ) {
          return "same";
        }
        return "conflict";
      }
      try {
        await pool.query(
          "insert into lockit_relay_users (username, username_display, identity_id, box_public_key, sign_public_key, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
          [
            user.username,
            user.usernameDisplay,
            user.identityId,
            user.boxPublicKey,
            user.signPublicKey,
            user.createdAt,
            user.updatedAt,
          ],
        );
        return "created";
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === "23505") return "conflict";
        throw err;
      }
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function logRelay(logger: RelayLogger | undefined, event: string, fields: Record<string, unknown>): void {
  if (logger === undefined) return;
  const parts = [`event=${event}`];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`${key}=${String(value)}`);
  }
  logger(`[lockit-relay] ${new Date().toISOString()} ${parts.join(" ")}`);
}

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createRelayServer(
  store: RelayStore = createMemoryRelayStore(),
  options: RelayServerOptions = {},
) {
  return createServer((req, res) => {
    void handle(store, options.logger, req, res).catch((e: unknown) => {
      logRelay(options.logger, "request_error", {
        method: req.method ?? "UNKNOWN",
        path: req.url ?? "/",
        error: e instanceof Error ? e.message : String(e),
      });
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    });
  });
}

async function handle(
  store: RelayStore,
  logger: RelayLogger | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://lockit.local");
  if (req.method === "GET" && url.pathname === "/health") {
    logRelay(logger, "health", { status: 200 });
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/messages") {
    const messages = await store.listAll();
    logRelay(logger, "messages_list_all", { status: 200, count: messages.length });
    sendJson(res, 200, {
      messages: messages.map((m) => ({
        id: m.id,
        to: m.to,
        artifact: m.artifact,
        receivedAt: m.receivedAt,
      })),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/users") {
    const body = JSON.parse(await readBody(req)) as {
      username?: unknown;
      identity?: unknown;
    };
    if (typeof body.username !== "string") throw new Error("missing username");
    const username = normalizeUsername(body.username);
    const identity = parsePublicIdentityBody(body.identity);
    const now = new Date().toISOString();
    const result = await store.registerUser({
      username,
      usernameDisplay: body.username.trim(),
      identityId: identity.id,
      boxPublicKey: identity.boxPublicKey,
      signPublicKey: identity.signPublicKey,
      createdAt: now,
      updatedAt: now,
    });
    if (result === "conflict") {
      logRelay(logger, "user_register", { status: 409, username, identityId: identity.id });
      sendJson(res, 409, { error: "username already registered" });
      return;
    }
    const user = await store.getUser(username);
    logRelay(logger, "user_register", {
      status: result === "created" ? 201 : 200,
      result,
      username,
      identityId: identity.id,
    });
    sendJson(res, result === "created" ? 201 : 200, { user });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/users/")) {
    const username = decodeURIComponent(url.pathname.slice("/users/".length));
    const user = await store.getUser(username);
    if (user === undefined) {
      logRelay(logger, "user_lookup", { status: 404, username: normalizeUsername(username) });
      sendJson(res, 404, { error: "username not found" });
      return;
    }
    logRelay(logger, "user_lookup", {
      status: 200,
      username: user.username,
      identityId: user.identityId,
    });
    sendJson(res, 200, { user });
    return;
  }
  if (req.method === "POST" && url.pathname === "/messages") {
    const body = JSON.parse(await readBody(req)) as { to?: unknown; artifact?: unknown };
    if (typeof body.to !== "string" || body.to.length === 0) throw new Error("missing recipient");
    if (typeof body.artifact !== "string" || body.artifact.length === 0) {
      throw new Error("missing artifact");
    }
    const id = randomUUID();
    await store.append({
      id,
      to: body.to,
      artifact: body.artifact,
      receivedAt: new Date().toISOString(),
    });
    logRelay(logger, "message_post", {
      status: 201,
      id,
      to: body.to,
      artifactBytes: Buffer.byteLength(body.artifact),
    });
    sendJson(res, 201, { id });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/messages/")) {
    const to = decodeURIComponent(url.pathname.slice("/messages/".length));
    const messages = await store.listForRecipient(to);
    logRelay(logger, "messages_fetch", { status: 200, to, count: messages.length });
    sendJson(res, 200, {
      messages: messages.map((m) => ({
        id: m.id,
        artifact: m.artifact,
        receivedAt: m.receivedAt,
      })),
    });
    return;
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/messages/")) {
    const id = decodeURIComponent(url.pathname.slice("/messages/".length));
    await store.delete(id);
    logRelay(logger, "message_delete", { status: 200, id });
    sendJson(res, 200, { ok: true });
    return;
  }
  logRelay(logger, "not_found", { status: 404, method: req.method ?? "UNKNOWN", path: url.pathname });
  sendText(res, 404, "not found\n");
}

function parsePublicIdentityBody(body: unknown): {
  id: string;
  boxPublicKey: string;
  signPublicKey: string;
} {
  if (typeof body !== "object" || body === null) throw new Error("missing identity");
  const record = body as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.boxPublicKey !== "string" ||
    typeof record.signPublicKey !== "string"
  ) {
    throw new Error("invalid identity");
  }
  const identity = publicIdentityFromWire({
    id: record.id,
    boxPublicKey: record.boxPublicKey,
    signPublicKey: record.signPublicKey,
  });
  assertIdentityId(identity);
  return {
    id: record.id,
    boxPublicKey: record.boxPublicKey,
    signPublicKey: record.signPublicKey,
  };
}

async function main(): Promise<void> {
  const opts = parseRelayOptions(process.argv.slice(2));
  const store =
    opts.databaseUrl !== undefined
      ? await loadPostgresRelayStore(opts.databaseUrl)
      : opts.dataPath === undefined
        ? createMemoryRelayStore()
        : await loadRelayStore(opts.dataPath);
  const server = createRelayServer(store, { logger: (line) => process.stdout.write(`${line}\n`) });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : opts.port;
  process.stdout.write(`lockit relay listening on http://${opts.host}:${String(port)}\n`);
}

const invokedAs = process.argv[1] ?? "";
if (
  invokedAs.endsWith("/index.js") ||
  invokedAs.endsWith("\\index.js") ||
  invokedAs.endsWith("lockit-relay")
) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
