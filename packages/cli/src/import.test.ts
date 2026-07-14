import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("derives the canonical provider as identity and records cwd as a source tag (not identity)", async () => {
    // Run with a cwd whose basename is `plugin-manager`. The old behavior would
    // have used that as the slug; the new behavior derives the provider (`pulse`)
    // from the registry and records `source:plugin-manager` only as a tag.
    const projDir = join(dir, "plugin-manager");
    mkdirSync(projDir, { recursive: true });
    const envFile = join(projDir, ".env");
    writeFileSync(envFile, "PULSE_API_KEY=sk-1\n");

    const prevCwd = process.cwd();
    process.chdir(projDir);
    try {
      const imp = makeIo([envFile], home);
      expect(await cmdImport(imp)).toBe(0);
    } finally {
      process.chdir(prevCwd);
    }

    const ls = makeIo(["--vars"], home);
    expect(await cmdLs(ls)).toBe(0);
    expect(ls.stdout).toContain("pulse");
    expect(ls.stdout).not.toContain("plugin-manager");
    expect(ls.stdout).not.toContain("sk-1");

    // Inspect the persisted store directly to assert the tag and the absence of a
    // `plugin-manager` slug.
    const { loadStore, storePath, getSecret } = await import("@lockit/core");
    const store = await loadStore(PASS, storePath());
    const pulse = getSecret(store, "pulse");
    expect(pulse).toBeDefined();
    expect(pulse?.tags).toContain("source:plugin-manager");
    expect(getSecret(store, "plugin-manager")).toBeUndefined();
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
