import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyStore, saveStore, storePath, upsertField } from "@lockit/core";
import { cmdExport } from "./export.js";
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

async function seed(fields: { slug: string; schema: string; key: string; value: string }[]) {
  let store = emptyStore();
  for (const f of fields) {
    store = upsertField(store, { ...f, type: "env" });
  }
  await saveStore(store, PASS, storePath());
}

describe("cmdExport", () => {
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

  it("never writes a value: a single-field secret exports ENV=@provider only", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "sk-SECRET-123" }]);

    const io = makeIo([], home);
    expect(await cmdExport(io)).toBe(0);

    const text = readFileSync(join(dir, ".env.ref"), "utf8");
    expect(text).toContain("PULSE_API_KEY=@pulse");
    expect(text).not.toContain("sk-SECRET-123");
  });

  it("a multi-field secret exports the more specific slug#field reference", async () => {
    await seed([
      { slug: "supabase/acme", schema: "supabase", key: "SUPABASE_URL", value: "https://x" },
      { slug: "supabase/acme", schema: "supabase", key: "SUPABASE_ANON_KEY", value: "anon-1" },
    ]);

    const io = makeIo([], home);
    expect(await cmdExport(io)).toBe(0);

    const text = readFileSync(join(dir, ".env.ref"), "utf8");
    expect(text).toContain("SUPABASE_URL=@supabase/acme#SUPABASE_URL");
    expect(text).toContain("SUPABASE_ANON_KEY=@supabase/acme#SUPABASE_ANON_KEY");
    expect(text).not.toContain("https://x");
    expect(text).not.toContain("anon-1");
  });

  it("honors --out <path>", async () => {
    await seed([{ slug: "pulse", schema: "pulse", key: "API_KEY", value: "sk-SECRET-123" }]);

    const out = join(dir, "custom.ref");
    const io = makeIo(["--out", out], home);
    expect(await cmdExport(io)).toBe(0);

    const text = readFileSync(out, "utf8");
    expect(text).toContain("PULSE_API_KEY=@pulse");
  });

  it("refuses to export duplicate env names", async () => {
    await seed([
      { slug: "pulse/a", schema: "pulse", key: "API_KEY", value: "a" },
      { slug: "pulse/b", schema: "pulse", key: "API_KEY", value: "b" },
    ]);

    const io = makeIo([], home);
    expect(await cmdExport(io)).toBe(1);
    expect(io.stderr).toContain("duplicate env name");
    expect(existsSync(join(dir, ".env.ref"))).toBe(false);
  });
});
