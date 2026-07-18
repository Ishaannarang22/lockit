import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RELAY, resolveRelay, cmdRelay } from "./relay.js";
import type { Io } from "./commands.js";

function makeIo(argv: string[], home: string, extraEnv: Record<string, string> = {}): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: "",
    env: { ...process.env, LOCKIT_HOME: home, ...extraEnv } as NodeJS.ProcessEnv,
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

describe("resolveRelay", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevRelay: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    prevHome = process.env.LOCKIT_HOME;
    prevRelay = process.env.LOCKIT_RELAY;
    process.env.LOCKIT_HOME = home;
    delete process.env.LOCKIT_RELAY;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevRelay === undefined) delete process.env.LOCKIT_RELAY;
    else process.env.LOCKIT_RELAY = prevRelay;
    rmSync(home, { recursive: true, force: true });
  });

  it("falls back to the built-in public relay", () => {
    const io = makeIo([], home);
    expect(resolveRelay(io)).toEqual({ url: DEFAULT_RELAY, source: "default" });
  });

  it("prefers an explicit --relay value over everything", () => {
    writeFileSync(join(home, "relay"), "https://config.example\n");
    const io = makeIo([], home, { LOCKIT_RELAY: "https://env.example" });
    expect(resolveRelay(io, "https://flag.example")).toEqual({
      url: "https://flag.example",
      source: "flag",
    });
  });

  it("prefers LOCKIT_RELAY over the config file and default", () => {
    writeFileSync(join(home, "relay"), "https://config.example\n");
    const io = makeIo([], home, { LOCKIT_RELAY: "https://env.example" });
    expect(resolveRelay(io)).toEqual({ url: "https://env.example", source: "env" });
  });

  it("prefers the persisted config over the default", () => {
    writeFileSync(join(home, "relay"), "https://config.example\n");
    const io = makeIo([], home);
    expect(resolveRelay(io)).toEqual({ url: "https://config.example", source: "config" });
  });

  it("rejects a malformed configured URL with a hard error naming the file", () => {
    writeFileSync(join(home, "relay"), "not a url\n");
    const io = makeIo([], home);
    expect(() => resolveRelay(io)).toThrowError(/relay/);
  });

  it("rejects a non-http scheme", () => {
    const io = makeIo([], home, { LOCKIT_RELAY: "ftp://nope.example" });
    expect(() => resolveRelay(io)).toThrowError(/http/);
  });
});

describe("cmdRelay", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevRelay: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
    prevHome = process.env.LOCKIT_HOME;
    prevRelay = process.env.LOCKIT_RELAY;
    process.env.LOCKIT_HOME = home;
    delete process.env.LOCKIT_RELAY;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevRelay === undefined) delete process.env.LOCKIT_RELAY;
    else process.env.LOCKIT_RELAY = prevRelay;
    rmSync(home, { recursive: true, force: true });
  });

  it("shows the default relay and its source", async () => {
    const io = makeIo([], home);
    expect(await cmdRelay(io)).toBe(0);
    expect(io.stdout).toContain(DEFAULT_RELAY);
    expect(io.stdout).toContain("(default)");
  });

  it("set persists a valid URL and show reports it as configured", async () => {
    const setIo = makeIo(["set", "https://relay.mycorp.example"], home);
    expect(await cmdRelay(setIo)).toBe(0);
    expect(readFileSync(join(home, "relay"), "utf8").trim()).toBe("https://relay.mycorp.example");

    const showIo = makeIo([], home);
    expect(await cmdRelay(showIo)).toBe(0);
    expect(showIo.stdout).toContain("https://relay.mycorp.example");
    expect(showIo.stdout).toContain("(config)");
  });

  it("set rejects an invalid URL and writes nothing", async () => {
    const io = makeIo(["set", "not a url"], home);
    expect(await cmdRelay(io)).toBe(1);
    expect(existsSync(join(home, "relay"))).toBe(false);
  });

  it("reset removes the config and returns to the default", async () => {
    await cmdRelay(makeIo(["set", "https://relay.mycorp.example"], home));
    const resetIo = makeIo(["reset"], home);
    expect(await cmdRelay(resetIo)).toBe(0);
    expect(existsSync(join(home, "relay"))).toBe(false);

    const showIo = makeIo([], home);
    await cmdRelay(showIo);
    expect(showIo.stdout).toContain("(default)");
  });

  it("show reports the env source when LOCKIT_RELAY is set", async () => {
    const io = makeIo([], home, { LOCKIT_RELAY: "https://env.example" });
    expect(await cmdRelay(io)).toBe(0);
    expect(io.stdout).toContain("https://env.example");
    expect(io.stdout).toContain("(env)");
  });

  it("rejects unknown subcommands with usage", async () => {
    const io = makeIo(["frobnicate"], home);
    expect(await cmdRelay(io)).toBe(1);
    expect(io.stderr).toContain("usage");
  });
});
