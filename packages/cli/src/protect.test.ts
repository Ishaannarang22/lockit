import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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

  it("reports no key yet on a fresh home (the key is created in the keychain on first use)", async () => {
    const { io, out } = makeIo(["status"]);
    expect(await cmdProtect(io)).toBe(0);
    expect(out.join("")).toMatch(/created in the keychain on first use/);
    // status must NOT create a plaintext keyfile as a side effect
    expect(existsSync(join(home, "key"))).toBe(false);
  });

  it("reports the LOCKIT_PASSPHRASE-managed key in status", async () => {
    const { io, out } = makeIo(["status"], { LOCKIT_PASSPHRASE: "override" });
    expect(await cmdProtect(io)).toBe(0);
    expect(out.join("")).toMatch(/LOCKIT_PASSPHRASE/);
  });

  it("refuses to turn protection off — it is mandatory", async () => {
    const { io, err } = makeIo(["off"]);
    expect(await cmdProtect(io)).toBe(1);
    expect(err.join("")).toMatch(/always protects|can't be turned off/i);
  });

  it("refuses 'protect on' when LOCKIT_PASSPHRASE is set", async () => {
    const { io } = makeIo(["on"], { LOCKIT_PASSPHRASE: "override" });
    expect(await cmdProtect(io)).toBe(1);
  });
});
