import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdImport } from "./import.js";
import { cmdLs } from "./commands.js";
import type { Io } from "./commands.js";

const PASS = "test-passphrase";

function makeIo(argv: string[], home: string): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: "",
    env: { ...process.env, LOCKIT_HOME: home, LOCKIT_PASSPHRASE: PASS } as NodeJS.ProcessEnv,
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

describe("cmdImport", () => {
  let home: string;
  let dir: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    dir = mkdtempSync(join(tmpdir(), "lockit-proj-"));
    // storePath() reads the global process.env.LOCKIT_HOME — point it at this
    // test's fresh home so the suite never touches the real ~/.lockit store.
    prevHome = process.env.LOCKIT_HOME;
    prevPass = process.env.LOCKIT_PASSPHRASE;
    process.env.LOCKIT_HOME = home;
    process.env.LOCKIT_PASSPHRASE = PASS;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevPass === undefined) delete process.env.LOCKIT_PASSPHRASE;
    else process.env.LOCKIT_PASSPHRASE = prevPass;
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports every var under an explicit --as slug and lists them value-free", async () => {
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "FOO=bar\nAPI_KEY=sk-live-123\n");
    const imp = makeIo([envFile, "--as", "app/dev"], home);
    expect(await cmdImport(imp)).toBe(0);

    const ls = makeIo(["--vars"], home);
    expect(await cmdLs(ls)).toBe(0);
    expect(ls.stdout).toContain("FOO");
    expect(ls.stdout).toContain("API_KEY");
    expect(ls.stdout).toContain("app/dev");
    expect(ls.stdout).not.toContain("sk-live-123");
  });

  it("returns 1 and stores nothing on a parse error", async () => {
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "FOO=bar\nBROKEN_LINE\n");
    const imp = makeIo([envFile, "--as", "app/dev"], home);
    expect(await cmdImport(imp)).toBe(1);
    expect(imp.stderr).toContain("line 2");

    const ls = makeIo(["--vars"], home);
    await cmdLs(ls);
    expect(ls.stdout).toBe("");
  });

  it("returns 1 with a clear error when the file is missing", async () => {
    const imp = makeIo([join(dir, "nope.env"), "--as", "app/dev"], home);
    expect(await cmdImport(imp)).toBe(1);
    expect(imp.stderr.toLowerCase()).toContain("no such file");
  });
});
