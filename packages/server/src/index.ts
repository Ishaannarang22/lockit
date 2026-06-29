#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

interface RelayMessage {
  id: string;
  to: string;
  artifact: string;
  receivedAt: string;
}

interface RelayOptions {
  host: string;
  port: number;
}

const messages: RelayMessage[] = [];

function parseArgs(argv: string[]): RelayOptions {
  let host = "127.0.0.1";
  let port = 8787;
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
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port must be an integer from 0 to 65535");
      }
      i++;
    } else {
      throw new Error("usage: lockit-relay [--host <host>] [--port <port>]");
    }
  }
  return { host, port };
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

export function createRelayServer() {
  return createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://lockit.local");
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/messages") {
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
  if (req.method === "POST" && url.pathname === "/messages") {
    const body = JSON.parse(await readBody(req)) as { to?: unknown; artifact?: unknown };
    if (typeof body.to !== "string" || body.to.length === 0) throw new Error("missing recipient");
    if (typeof body.artifact !== "string" || body.artifact.length === 0) {
      throw new Error("missing artifact");
    }
    const id = randomUUID();
    messages.push({ id, to: body.to, artifact: body.artifact, receivedAt: new Date().toISOString() });
    sendJson(res, 201, { id });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/messages/")) {
    const to = decodeURIComponent(url.pathname.slice("/messages/".length));
    sendJson(res, 200, {
      messages: messages
        .filter((m) => m.to === to)
        .map((m) => ({ id: m.id, artifact: m.artifact, receivedAt: m.receivedAt })),
    });
    return;
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/messages/")) {
    const id = decodeURIComponent(url.pathname.slice("/messages/".length));
    const index = messages.findIndex((m) => m.id === id);
    if (index >= 0) messages.splice(index, 1);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendText(res, 404, "not found\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const server = createRelayServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : opts.port;
  process.stdout.write(`lockit relay listening on http://${opts.host}:${String(port)}\n`);
}

if (process.argv[1]?.endsWith("/index.js") ?? false) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
