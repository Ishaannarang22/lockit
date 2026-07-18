import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyStore,
  loadOrCreateIdentity,
  publicIdentity,
  saveStore,
  serializePublicIdentity,
  storePath,
  upsertField,
  createSecretShare,
} from "@lockit/core";
import { cmdShare, cmdReceive, cmdIdentity } from "./share.js";
import { DEFAULT_RELAY } from "./relay.js";
import type { Io } from "./commands.js";

const PASS = "test-passphrase";

function makeIo(argv: string[], home: string, extraEnv: Record<string, string> = {}): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: "",
    env: { ...process.env, LOCKIT_HOME: home, LOCKIT_PASSPHRASE: PASS, ...extraEnv } as NodeJS.ProcessEnv,
    stdout: "",
    stderr: "",
    out(s: string) {
      (this as { stdout: string }).stdout += s;
    },
    err(s: string) {
      (this as { stderr: string }).stderr += s;
    },
  };
  return io as Io & { stdout: string; stderr: string };
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; json?: unknown }): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const res = handler(url, init);
    return Promise.resolve({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: () => Promise.resolve(res.json ?? {}),
    });
  });
  return calls;
}

describe("sharing with the default public relay", () => {
  let senderHome: string;
  let recipientHome: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;
  let prevRelay: string | undefined;
  let recipientPub: { id: string; boxPublicKey: string; signPublicKey: string };

  async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
    const before = process.env.LOCKIT_HOME;
    process.env.LOCKIT_HOME = home;
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.LOCKIT_HOME;
      else process.env.LOCKIT_HOME = before;
    }
  }

  beforeEach(async () => {
    senderHome = mkdtempSync(join(tmpdir(), "lockit-sender-"));
    recipientHome = mkdtempSync(join(tmpdir(), "lockit-recipient-"));
    prevHome = process.env.LOCKIT_HOME;
    prevPass = process.env.LOCKIT_PASSPHRASE;
    prevRelay = process.env.LOCKIT_RELAY;
    process.env.LOCKIT_PASSPHRASE = PASS;
    delete process.env.LOCKIT_RELAY;

    recipientPub = await withHome(recipientHome, async () => {
      const identity = await loadOrCreateIdentity(PASS);
      const wire = JSON.parse(serializePublicIdentity(publicIdentity(identity))) as {
        id: string;
        boxPublicKey: string;
        signPublicKey: string;
      };
      return { id: wire.id, boxPublicKey: wire.boxPublicKey, signPublicKey: wire.signPublicKey };
    });

    await withHome(senderHome, async () => {
      let store = emptyStore();
      store = upsertField(store, { slug: "openai/dev", schema: "api", key: "OPENAI_API_KEY", value: "sk-test", type: "env" });
      await saveStore(store, PASS, storePath());
      await loadOrCreateIdentity(PASS);
    });
    process.env.LOCKIT_HOME = senderHome;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevPass === undefined) delete process.env.LOCKIT_PASSPHRASE;
    else process.env.LOCKIT_PASSPHRASE = prevPass;
    if (prevRelay === undefined) delete process.env.LOCKIT_RELAY;
    else process.env.LOCKIT_RELAY = prevRelay;
    rmSync(senderHome, { recursive: true, force: true });
    rmSync(recipientHome, { recursive: true, force: true });
  });

  function relayUserJson() {
    return {
      user: {
        username: "bob",
        usernameDisplay: "bob",
        identityId: recipientPub.id,
        boxPublicKey: recipientPub.boxPublicKey,
        signPublicKey: recipientPub.signPublicKey,
      },
    };
  }

  it("share --to @user with no --relay looks up and posts via the default relay", async () => {
    const calls = stubFetch((url, init) => {
      if (url.includes("/users/")) return { status: 200, json: relayUserJson() };
      if (url.endsWith("/messages") && init?.method === "POST") return { status: 200, json: { id: "m1" } };
      return { status: 404 };
    });
    const io = makeIo(["openai/dev", "--to", "@bob"], senderHome);
    expect(await cmdShare(io)).toBe(0);
    expect(calls[0]?.url).toBe(`${DEFAULT_RELAY}/users/bob`);
    expect(calls[1]?.url).toBe(`${DEFAULT_RELAY}/messages`);
    expect(io.stdout).toContain("sent encrypted share m1 to @bob");
    expect(io.stdout).toContain(new URL(DEFAULT_RELAY).host);
  });

  it("share --to @user honors LOCKIT_RELAY over the default", async () => {
    const calls = stubFetch((url, init) => {
      if (url.includes("/users/")) return { status: 200, json: relayUserJson() };
      if (url.endsWith("/messages") && init?.method === "POST") return { status: 200, json: { id: "m1" } };
      return { status: 404 };
    });
    const io = makeIo(["openai/dev", "--to", "@bob"], senderHome, { LOCKIT_RELAY: "https://relay.corp.example" });
    expect(await cmdShare(io)).toBe(0);
    expect(calls[0]?.url).toBe("https://relay.corp.example/users/bob");
    expect(calls[1]?.url).toBe("https://relay.corp.example/messages");
  });

  it("share --to @user --out writes the artifact and does not post", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/users/")) return { status: 200, json: relayUserJson() };
      return { status: 404 };
    });
    const out = join(senderHome, "share.json");
    const io = makeIo(["openai/dev", "--to", "@bob", "--out", out], senderHome);
    expect(await cmdShare(io)).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${DEFAULT_RELAY}/users/bob`);
  });

  it("share --to <identity file> with no flags prints ciphertext and never touches the network", async () => {
    const calls = stubFetch(() => ({ status: 500 }));
    const idFile = join(senderHome, "bob.lockit-id.json");
    const doc = {
      v: 1,
      kind: "lockit.identity.v1",
      id: recipientPub.id,
      boxPublicKey: recipientPub.boxPublicKey,
      signPublicKey: recipientPub.signPublicKey,
    };
    await import("node:fs/promises").then((fs) => fs.writeFile(idFile, JSON.stringify(doc)));
    const io = makeIo(["openai/dev", "--to", idFile], senderHome);
    expect(await cmdShare(io)).toBe(0);
    expect(calls).toHaveLength(0);
    expect(io.stdout).toContain("lockit.share.v1");
  });

  it("receive with no --relay fetches from the default relay and accepts shares", async () => {
    const artifact = await withHome(senderHome, async () => {
      const identity = await loadOrCreateIdentity(PASS);
      const { loadStore } = await import("@lockit/core");
      const store = await loadStore(PASS, storePath());
      const doc = {
        v: 1,
        kind: "lockit.identity.v1",
        id: recipientPub.id,
        boxPublicKey: recipientPub.boxPublicKey,
        signPublicKey: recipientPub.signPublicKey,
      };
      const { parsePublicIdentity } = await import("@lockit/core");
      return await createSecretShare(store, "openai/dev", {
        sender: identity,
        recipient: parsePublicIdentity(JSON.stringify(doc)),
      });
    });
    const calls = stubFetch((url, init) => {
      if (url.includes("/messages/") && (init?.method ?? "GET") === "GET") {
        return { status: 200, json: { messages: [{ id: "m1", artifact }] } };
      }
      if (init?.method === "DELETE") return { status: 200, json: {} };
      return { status: 404 };
    });
    process.env.LOCKIT_HOME = recipientHome;
    const io = makeIo([], recipientHome);
    expect(await cmdReceive(io)).toBe(0);
    expect(calls[0]?.url).toBe(`${DEFAULT_RELAY}/messages/${encodeURIComponent(recipientPub.id)}`);
    expect(io.stdout).toContain("received 1 share");
    expect(io.stdout).toContain(new URL(DEFAULT_RELAY).host);
  });

  it("identity register with no --relay registers on the default relay", async () => {
    const calls = stubFetch((url, init) => {
      if (url.endsWith("/users") && init?.method === "POST") return { status: 200, json: relayUserJson() };
      return { status: 404 };
    });
    const io = makeIo(["register", "bob"], senderHome);
    expect(await cmdIdentity(io)).toBe(0);
    expect(calls[0]?.url).toBe(`${DEFAULT_RELAY}/users`);
    expect(io.stdout).toContain("registered @bob");
  });

  it("identity whois with no --relay resolves via the default relay", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/users/")) return { status: 200, json: relayUserJson() };
      return { status: 404 };
    });
    const io = makeIo(["whois", "bob"], senderHome);
    expect(await cmdIdentity(io)).toBe(0);
    expect(calls[0]?.url).toBe(`${DEFAULT_RELAY}/users/bob`);
    expect(io.stdout).toContain(recipientPub.id);
  });
});
