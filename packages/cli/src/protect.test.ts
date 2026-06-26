import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdProtect } from "./protect.js";
import type { Io } from "./commands.js";

function makeIo(argv: string[], env: Record<string, string> = {}): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    argv,
    stdin: "",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  return { io, out, err };
}

describe("cmdProtect (status + guards — paths that need no Touch ID)", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-protect-"));
    prevHome = process.env.LOCKIT_HOME;
    process.env.LOCKIT_HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("reports unprotected on a fresh (plaintext) keyfile", async () => {
    const { io, out } = makeIo(["status"]);
    expect(await cmdProtect(io)).toBe(0);
    expect(out.join("")).toMatch(/unprotected/);
  });

  it("is a no-op when turning protection off while already unprotected", async () => {
    const { io, out } = makeIo(["off"]);
    expect(await cmdProtect(io)).toBe(0);
    expect(out.join("")).toMatch(/already unprotected/);
  });

  it("refuses to protect (returns 1, keyfile unchanged) when LOCKIT_PASSPHRASE is set", async () => {
    const { io } = makeIo(["on"], { LOCKIT_PASSPHRASE: "override" });
    expect(await cmdProtect(io)).toBe(1);
    // keyfile must remain a plaintext key, never a keychain marker
    const content = readFileSync(join(home, "key"), "utf8");
    expect(content).not.toMatch(/keychain/);
    expect(existsSync(join(home, "key"))).toBe(true);
  });
});
