import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { runLockit, withSandbox } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY_BIN = resolve(HERE, "../packages/server/dist/index.js");

function startRelay(): Promise<{ child: ChildProcessWithoutNullStreams; url: string }> {
  return new Promise((resolveP, reject) => {
    const child = spawn(process.execPath, [RELAY_BIN, "--host", "127.0.0.1", "--port", "0"]);
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/listening on (http:\/\/[^\s]+)/);
      if (match?.[1] !== undefined && !settled) {
        settled = true;
        resolveP({ child, url: match[1] });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!settled) reject(new Error(chunk.toString("utf8")));
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!settled) reject(new Error(`relay exited before ready: ${String(code)}`));
    });
  });
}

describe("share over local relay (e2e, real binaries)", () => {
  it("sends ciphertext over the relay and recipient accepts a local copy", async () => {
    const relay = await startRelay();
    try {
      await withSandbox(async (homeA) => {
        await withSandbox(async (homeB) => {
          const dir = mkdtempSync(join(tmpdir(), "lockit-share-"));
          try {
            const bobPub = join(dir, "bob.lockit-id.json");
            const bobId = await runLockit(homeB, ["identity", "--out", bobPub], {
              passphrase: "pwB",
            });
            expect(bobId.code).toBe(0);

            const setA = await runLockit(homeA, ["set", "openai/dev", "OPENAI_API_KEY"], {
              passphrase: "pwA",
              stdin: "sk-alice-secret",
            });
            expect(setA.code).toBe(0);

            const send = await runLockit(
              homeA,
              ["share", "openai/dev", "--to", bobPub, "--relay", relay.url],
              { passphrase: "pwA" },
            );
            expect(send.code).toBe(0);
            expect(send.stdout).not.toContain("sk-alice-secret");

            const relayMessages = (await fetch(`${relay.url}/messages`)) as Response;
            const relayText = await relayMessages.text();
            expect(relayText).not.toContain("sk-alice-secret");

            const receive = await runLockit(homeB, ["receive", "--relay", relay.url], {
              passphrase: "pwB",
            });
            expect(receive.code).toBe(0);
            expect(receive.stdout).toContain("received 1 share");
            expect(receive.stdout).not.toContain("sk-alice-secret");

            const ls = await runLockit(homeB, ["ls", "--vars"], { passphrase: "pwB" });
            expect(ls.code).toBe(0);
            expect(ls.stdout).toContain("OPENAI_API_KEY");
            expect(ls.stdout).not.toContain("sk-alice-secret");

            const storeText = readFileSync(join(homeB, "store.json"), "utf8");
            expect(storeText).not.toContain("sk-alice-secret");
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        });
      });
    } finally {
      relay.child.kill();
    }
  });
});
