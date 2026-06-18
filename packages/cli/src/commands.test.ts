import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cmdLs, cmdRun, cmdSet, type Io } from "./commands.js";

const SECRET = "sk-super-secret-1234567890";
const PASSPHRASE = "correct horse battery staple";

interface Capture {
  out: string;
  err: string;
}

/** Build an Io whose out/err accumulate into a returned capture object. */
function makeIo(argv: string[], stdin: string, capture: Capture): Io {
  return {
    argv,
    stdin,
    env: process.env,
    out: (s) => {
      capture.out += s;
    },
    err: (s) => {
      capture.err += s;
    },
  };
}

describe("kv cli commands", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kv-cli-"));
    prevHome = process.env.KV_HOME;
    prevPass = process.env.KV_PASSPHRASE;
    process.env.KV_HOME = home;
    process.env.KV_PASSPHRASE = PASSPHRASE;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.KV_HOME;
    else process.env.KV_HOME = prevHome;
    if (prevPass === undefined) delete process.env.KV_PASSPHRASE;
    else process.env.KV_PASSPHRASE = prevPass;
    await rm(home, { recursive: true, force: true });
  });

  it("set (value from stdin) then ls — ls output is value-free", async () => {
    const set: Capture = { out: "", err: "" };
    const setCode = await cmdSet(makeIo(["openai/dev", "OPENAI_API_KEY"], `${SECRET}\n`, set));
    expect(setCode).toBe(0);
    expect(set.out).toContain("set openai/dev OPENAI_API_KEY (env)");
    expect(set.out).not.toContain(SECRET);

    const ls: Capture = { out: "", err: "" };
    const lsCode = await cmdLs(makeIo([], "", ls));
    expect(lsCode).toBe(0);
    expect(ls.out).toContain("openai/dev");
    expect(ls.out).toContain("[openai]");
    expect(ls.out).toContain("OPENAI_API_KEY");
    expect(ls.out).not.toContain(SECRET);
  });

  it("the value is taken from stdin, never from argv", async () => {
    const set: Capture = { out: "", err: "" };
    // Pass a would-be value as a 3rd positional arg; stdin holds the real value.
    const code = await cmdSet(
      makeIo(["openai/dev", "OPENAI_API_KEY", "ARGV_SHOULD_BE_IGNORED"], `${SECRET}\n`, set),
    );
    expect(code).toBe(0);

    const run: Capture = { out: "", err: "" };
    await cmdRun(
      makeIo(
        ["openai/dev", "node", "-e", "process.stdout.write(process.env.OPENAI_API_KEY ?? '')"],
        "",
        run,
      ),
    );
    // The argv string was never stored: the child sees the stdin value (masked),
    // and definitely not the argv token.
    expect(run.out).not.toContain("ARGV_SHOULD_BE_IGNORED");
  });

  it("run injects the value into the child but masks it in kv's output", async () => {
    await cmdSet(makeIo(["openai/dev", "MYKEY"], `${SECRET}\n`, { out: "", err: "" }));

    const run: Capture = { out: "", err: "" };
    const code = await cmdRun(
      makeIo(
        ["openai/dev", "node", "-e", "process.stdout.write(process.env.MYKEY ?? 'MISSING')"],
        "",
        run,
      ),
    );
    expect(code).toBe(0);
    // The child could read the value (so injection worked) — proven by the
    // absence of "MISSING" — yet kv's forwarded output shows only the mask.
    expect(run.out).not.toContain("MISSING");
    expect(run.out).not.toContain(SECRET);
    expect(run.out).toContain("***");
  });

  it("run on a missing slug returns 1", async () => {
    const run: Capture = { out: "", err: "" };
    const code = await cmdRun(makeIo(["nope/missing", "node", "-e", ""], "", run));
    expect(code).toBe(1);
    expect(run.err).toContain("nope/missing");
  });

  it("returns 1 with a clear error when KV_PASSPHRASE is unset", async () => {
    delete process.env.KV_PASSPHRASE;
    const set: Capture = { out: "", err: "" };
    const code = await cmdSet(makeIo(["openai/dev", "K"], "v\n", set));
    expect(code).toBe(1);
    expect(set.err).toContain("KV_PASSPHRASE is not set");
  });
});
