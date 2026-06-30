import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSharingIdentity, publicIdentityToWire, publicSharingIdentity } from "@lockit/crypto";
import { createRelayServer, loadRelayStore, parseRelayOptions } from "./index.js";

const servers: ReturnType<typeof createRelayServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

async function listen(server: ReturnType<typeof createRelayServer>): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("missing test address");
  return `http://127.0.0.1:${String(address.port)}`;
}

describe("relay options", () => {
  it("uses Railway-style PORT with 0.0.0.0 by default", () => {
    expect(parseRelayOptions([], { PORT: "1234" })).toEqual({
      host: "0.0.0.0",
      port: 1234,
    });
  });

  it("allows an explicit data path for persistent ciphertext storage", () => {
    expect(parseRelayOptions(["--data", "/tmp/relay.json"], {})).toEqual({
      host: "127.0.0.1",
      port: 8787,
      dataPath: "/tmp/relay.json",
    });
  });

  it("uses DATABASE_URL for Postgres-backed public username storage", () => {
    expect(parseRelayOptions([], { DATABASE_URL: "postgres://example" })).toEqual({
      host: "127.0.0.1",
      port: 8787,
      databaseUrl: "postgres://example",
    });
  });
});

describe("persistent relay store", () => {
  it("persists ciphertext relay messages to disk and reloads them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lockit-relay-test-"));
    try {
      const dataPath = join(dir, "messages.json");
      const store = await loadRelayStore(dataPath);
      const server = createRelayServer(store);
      const url = await listen(server);

      const post = await fetch(`${url}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "kid_123", artifact: "encrypted-artifact" }),
      });
      expect(post.status).toBe(201);

      const text = await readFile(dataPath, "utf8");
      expect(text).toContain("encrypted-artifact");
      expect(text).not.toContain("plaintext-secret");

      const reloaded = await loadRelayStore(dataPath);
      expect(await reloaded.listForRecipient("kid_123")).toEqual([
        expect.objectContaining({ to: "kid_123", artifact: "encrypted-artifact" }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("username registry", () => {
  it("registers globally unique normalized usernames and resolves public identities", async () => {
    const server = createRelayServer();
    const url = await listen(server);
    const identity = publicIdentityToWire(publicSharingIdentity(await generateSharingIdentity()));
    const other = publicIdentityToWire(publicSharingIdentity(await generateSharingIdentity()));

    const first = await fetch(`${url}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "Bob", identity }),
    });
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toEqual({
      user: expect.objectContaining({
        username: "bob",
        usernameDisplay: "Bob",
        identityId: identity.id,
      }),
    });

    const resolved = await fetch(`${url}/users/bob`);
    await expect(resolved.json()).resolves.toEqual({
      user: expect.objectContaining({
        username: "bob",
        identityId: identity.id,
        boxPublicKey: identity.boxPublicKey,
        signPublicKey: identity.signPublicKey,
      }),
    });

    const duplicate = await fetch(`${url}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "BOB", identity: other }),
    });
    expect(duplicate.status).toBe(409);
  });

  it("persists username records with relay messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lockit-users-test-"));
    try {
      const dataPath = join(dir, "relay.json");
      const identity = publicIdentityToWire(publicSharingIdentity(await generateSharingIdentity()));
      const store = await loadRelayStore(dataPath);
      const server = createRelayServer(store);
      const url = await listen(server);

      const registered = await fetch(`${url}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "riya", identity }),
      });
      expect(registered.status).toBe(201);

      const reloaded = await loadRelayStore(dataPath);
      expect(await reloaded.getUser("riya")).toEqual(
        expect.objectContaining({ username: "riya", identityId: identity.id }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
