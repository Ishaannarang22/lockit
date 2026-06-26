import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyStore, upsertField } from "@lockit/core";
import { completionCandidates, cmdCompleteList, cmdCompletion } from "./completion.js";
import { cmdSet } from "./commands.js";
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

describe("completionCandidates", () => {
  it("emits bare names, qualified bundle#KEY forms, and bundle slugs, sorted and value-free", () => {
    let s = upsertField(emptyStore(), {
      slug: "nvidia/dev",
      schema: "nvidia",
      key: "NVIDIA_API_KEY",
      type: "env",
      value: "secret-xyz",
    });
    s = upsertField(s, {
      slug: "app/dev",
      schema: "app",
      key: "DB_URL",
      type: "env",
      value: "pg://",
    });

    const c = completionCandidates(s);
    expect(c).toContain("NVIDIA_API_KEY");
    expect(c).toContain("nvidia/dev#NVIDIA_API_KEY");
    expect(c).toContain("nvidia/dev");
    expect(c).toContain("DB_URL");
    expect(c).not.toContain("secret-xyz");
    expect(c).toEqual([...c].sort()); // stable sort
  });

  it("is empty for an empty store", () => {
    expect(completionCandidates(emptyStore())).toEqual([]);
  });
});

describe("cmdCompleteList", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
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
  });

  it("prints candidates value-free when unlocked", async () => {
    const set = makeIo(["nvidia/dev", "NVIDIA_API_KEY"], home);
    (set as { stdin: string }).stdin = "secret-xyz";
    await cmdSet(set);

    const io = makeIo([], home);
    expect(await cmdCompleteList(io)).toBe(0);
    expect(io.stdout).toContain("NVIDIA_API_KEY");
    expect(io.stdout).not.toContain("secret-xyz");
  });

  // The no-LOCKIT_PASSPHRASE path now bootstraps the key into the macOS keychain
  // (Touch-ID-gated), not a plaintext keyfile — that is exercised headlessly in
  // storekey.test.ts (loadStoreKey). An end-to-end run here would need a real Touch
  // ID and would create a real keychain item, so it is intentionally not unit-tested.
});

describe("cmdCompletion", () => {
  it("emits a zsh script wiring _lockit to __complete-list", async () => {
    const io = makeIo(["zsh"], "/tmp/unused");
    expect(await cmdCompletion(io)).toBe(0);
    expect(io.stdout).toContain("compdef _lockit lockit");
    expect(io.stdout).toContain("lockit __complete-list");
    expect(io.stdout).toContain("_LOCKIT_COMP_TS");
  });

  it("emits a bash script wiring complete -F _lockit", async () => {
    const io = makeIo(["bash"], "/tmp/unused");
    expect(await cmdCompletion(io)).toBe(0);
    expect(io.stdout).toContain("complete -F _lockit lockit");
    expect(io.stdout).toContain("lockit __complete-list");
  });

  it("errors with usage on a missing/unknown shell", async () => {
    const io = makeIo([], "/tmp/unused");
    expect(await cmdCompletion(io)).toBe(1);
    expect(io.stderr).toContain("usage: lockit completion <zsh|bash>");
  });
});
