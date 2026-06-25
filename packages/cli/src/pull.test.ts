import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSet } from "./commands.js";
import { cmdPull } from "./pull.js";
import type { Io } from "./commands.js";

const PASS = "test-passphrase";

function makeIo(
  argv: string[],
  home: string,
  opts: { stdin?: string; authorize?: () => Promise<string | null> } = {},
): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: opts.stdin ?? "",
    env: { ...process.env, LOCKIT_HOME: home, LOCKIT_PASSPHRASE: PASS } as NodeJS.ProcessEnv,
    authorize: opts.authorize,
    stdout: "",
    stderr: "",
    out(s: string) { (this as { stdout: string }).stdout += s; },
    err(s: string) { (this as { stderr: string }).stderr += s; },
  };
  return io as Io & { stdout: string; stderr: string };
}

async function seed(home: string, slug: string, key: string, value: string) {
  const set = makeIo([slug, key], home, { stdin: value });
  await cmdSet(set);
}

describe("cmdPull", () => {
  let home: string;
  let dir: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    dir = mkdtempSync(join(tmpdir(), "lockit-proj-"));
    // storePath() reads the global process.env.LOCKIT_HOME — point it at this
    // test's fresh home so the suite never touches the real ~/.lockit store.
    prevHome = process.env.LOCKIT_HOME;
    prevPass = process.env.LOCKIT_PASSPHRASE;
    process.env.LOCKIT_HOME = home;
    process.env.LOCKIT_PASSPHRASE = PASS;
    await seed(home, "app/dev", "API_KEY", "sk-live-123");
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevPass === undefined) delete process.env.LOCKIT_PASSPHRASE;
    else process.env.LOCKIT_PASSPHRASE = prevPass;
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the real value into a new .env after authorization, at 0600", async () => {
    const out = join(dir, ".env");
    const io = makeIo(["API_KEY", "--out", out], home, { authorize: async () => PASS });
    expect(await cmdPull(io)).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("API_KEY=sk-live-123");
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(io.stdout).not.toContain("sk-live-123");
  });

  it("writes nothing and exits 1 when authorization is denied", async () => {
    const out = join(dir, ".env");
    const io = makeIo(["API_KEY", "--out", out], home, { authorize: async () => null });
    expect(await cmdPull(io)).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(io.stderr.toLowerCase()).toContain("authorization");
  });

  it("aborts on an unknown variable, writing nothing", async () => {
    const out = join(dir, ".env");
    const io = makeIo(["NOPE", "--out", out], home, { authorize: async () => PASS });
    expect(await cmdPull(io)).toBe(1);
    expect(io.stderr).toMatch(/not found/i);
    expect(existsSync(out)).toBe(false);
  });

  it("skips an existing key unless --force", async () => {
    const out = join(dir, ".env");
    writeFileSync(out, "API_KEY=old\n");
    const io = makeIo(["API_KEY", "--out", out], home, { authorize: async () => PASS });
    expect(await cmdPull(io)).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("API_KEY=old");
    expect(io.stdout).toMatch(/skipped 1/);

    const forced = makeIo(["API_KEY", "--out", out, "--force"], home, { authorize: async () => PASS });
    expect(await cmdPull(forced)).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("API_KEY=sk-live-123");
  });
});
