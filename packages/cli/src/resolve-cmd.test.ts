import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindKey,
  emptyStore,
  initProject,
  saveStore,
  storePath,
  upsertField,
  writeVault,
  readVault,
} from "@lockit/core";
import { cmdResolve } from "./resolve-cmd.js";
import type { Io } from "./commands.js";

const PASS = "test-passphrase";

function makeIo(
  argv: string[],
  home: string,
  authorize?: (prompt?: string) => Promise<boolean>,
): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: "",
    env: { ...process.env, LOCKIT_HOME: home, LOCKIT_PASSPHRASE: PASS } as NodeJS.ProcessEnv,
    cwd: process.cwd(),
    authorize,
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

async function seed(fields: { slug: string; schema: string; key: string; value: string }[]) {
  let store = emptyStore();
  for (const f of fields) {
    store = upsertField(store, { ...f, type: "env" });
  }
  await saveStore(store, PASS, storePath());
}

describe("cmdResolve", () => {
  let home: string;
  let dir: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;
  let prevCwd: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    dir = mkdtempSync(join(tmpdir(), "lockit-proj-"));
    prevHome = process.env.LOCKIT_HOME;
    prevPass = process.env.LOCKIT_PASSPHRASE;
    process.env.LOCKIT_HOME = home;
    process.env.LOCKIT_PASSPHRASE = PASS;
    prevCwd = process.cwd();
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevPass === undefined) delete process.env.LOCKIT_PASSPHRASE;
    else process.env.LOCKIT_PASSPHRASE = prevPass;
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("fills from own store on admit", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\n");

    const io = makeIo([], home, async () => true);
    expect(await cmdResolve(io)).toBe(0);

    const text = readFileSync(join(dir, ".env"), "utf8");
    expect(text).toContain("PULSE_API_KEY=my-own-key");
  });

  it("rejects --yes because admission must prove human presence", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\n");

    const io = makeIo(["--yes"], home);
    expect(await cmdResolve(io)).toBe(1);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(io.stderr).toContain("--yes");
  });

  it("writes nothing when denied", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\n");

    const io = makeIo([], home, async () => false);
    expect(await cmdResolve(io)).not.toBe(0);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("strict on unresolved: writes nothing and reports the env name", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    writeFileSync(join(dir, ".env.ref"), "MISSING_KEY=@nope\n");

    const io = makeIo([], home, async () => true);
    expect(await cmdResolve(io)).not.toBe(0);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(io.stderr).toContain("MISSING_KEY");
  });

  it("inside a project, refuses refs that were not admitted to the vault", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    initProject(dir);
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\n");

    const io = makeIo([], home, async () => true);
    expect(await cmdResolve(io)).toBe(1);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(io.stderr).toContain("not admitted");
  });

  it("inside a project, fills only refs matching admitted vault bindings", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    initProject(dir);
    writeVault(dir, bindKey(readVault(dir), "PULSE_API_KEY", "pulse#API_KEY"));
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\n");

    const io = makeIo([], home, async () => true);
    expect(await cmdResolve(io)).toBe(0);
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("PULSE_API_KEY=my-own-key");
  });

  it("rejects duplicate env names in a reference file before writing", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\nPULSE_API_KEY=@pulse\n");

    const io = makeIo([], home, async () => true);
    expect(await cmdResolve(io)).toBe(1);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(io.stderr).toContain("duplicate env name");
  });

  it("adds .env to .gitignore when creating plaintext in a git repo", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "my-own-key" }]);
    writeFileSync(join(dir, ".env.ref"), "PULSE_API_KEY=@pulse\n");
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    writeFileSync(join(dir, ".git"), "");

    const io = makeIo([], home, async () => true);
    expect(await cmdResolve(io)).toBe(0);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".env\n");
    expect(io.stderr).toContain("plaintext secrets");
  });
});
