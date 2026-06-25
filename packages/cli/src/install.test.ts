import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseZshTarget, chooseBashTarget, cmdInstall } from "./install.js";
import type { Io } from "./commands.js";

function makeIo(argv: string[], env: NodeJS.ProcessEnv): Io & { stdout: string; stderr: string } {
  const io = {
    argv,
    stdin: "",
    env,
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

describe("chooseZshTarget", () => {
  it("honors LOCKIT_COMPLETION_DIR with no rc edit", () => {
    const t = chooseZshTarget({ LOCKIT_COMPLETION_DIR: "/tmp/fp" } as NodeJS.ProcessEnv, "/home/u");
    expect(t.path).toBe("/tmp/fp/_lockit");
    expect(t.rcLine).toBeUndefined();
  });

  it("uses the first writable standard dir, no rc edit", () => {
    const t = chooseZshTarget({} as NodeJS.ProcessEnv, "/home/u", ["/a", "/b"], (d) => d === "/b");
    expect(t.path).toBe("/b/_lockit");
    expect(t.rcLine).toBeUndefined();
  });

  it("falls back to ~/.zsh/completions with an rc line when nothing is writable", () => {
    const t = chooseZshTarget({} as NodeJS.ProcessEnv, "/home/u", ["/a"], () => false);
    expect(t.path).toBe("/home/u/.zsh/completions/_lockit");
    expect(t.rcFile).toBe("/home/u/.zshrc");
    expect(t.rcLine).toContain("fpath=");
  });
});

describe("chooseBashTarget", () => {
  it("falls back to ~/.bash_completion.d with a source line", () => {
    const t = chooseBashTarget({} as NodeJS.ProcessEnv, "/home/u", ["/a"], () => false);
    expect(t.path).toBe("/home/u/.bash_completion.d/lockit");
    expect(t.rcFile).toBe("/home/u/.bashrc");
    expect(t.rcLine).toContain(".bash_completion.d");
  });
});

describe("cmdInstall", () => {
  let dir: string;
  let home: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lockit-fp-"));
    home = mkdtempSync(join(tmpdir(), "lockit-home-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("writes a #compdef _lockit file into the override dir and reports the path", async () => {
    const io = makeIo(["zsh"], { LOCKIT_COMPLETION_DIR: dir, HOME: home } as NodeJS.ProcessEnv);
    expect(await cmdInstall(io)).toBe(0);
    const written = readFileSync(join(dir, "_lockit"), "utf8");
    expect(written.startsWith("#compdef lockit")).toBe(true);
    expect(written).toContain("lockit __complete-list");
    expect(io.stdout).toContain(join(dir, "_lockit"));
    expect(io.stdout).toContain("restart your shell");
  });

  it("also installs the Claude skill into ~/.claude/skills (global)", async () => {
    const io = makeIo(["zsh"], { LOCKIT_COMPLETION_DIR: dir, HOME: home } as NodeJS.ProcessEnv);
    expect(await cmdInstall(io)).toBe(0);
    const skill = readFileSync(
      join(home, ".claude", "skills", "lockit-agent-safe", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("lockit run");
    expect(skill).toContain("Never");
    expect(io.stdout).toContain("Claude skill");
  });

  it("--no-skill skips the Claude skill", async () => {
    const io = makeIo(["zsh", "--no-skill"], {
      LOCKIT_COMPLETION_DIR: dir,
      HOME: home,
    } as NodeJS.ProcessEnv);
    expect(await cmdInstall(io)).toBe(0);
    expect(existsSync(join(home, ".claude", "skills", "lockit-agent-safe", "SKILL.md"))).toBe(
      false,
    );
  });

  it("writes a bash completion file when asked for bash", async () => {
    const io = makeIo(["bash"], {
      LOCKIT_BASH_COMPLETION_DIR: dir,
      HOME: home,
    } as NodeJS.ProcessEnv);
    expect(await cmdInstall(io)).toBe(0);
    const written = readFileSync(join(dir, "lockit"), "utf8");
    expect(written).toContain("complete -F _lockit lockit");
  });

  // NOTE: cmdInstall tests always set an override dir. Without one, chooseZshTarget
  // would pick a real writable system dir (e.g. Homebrew's site-functions) and the
  // test would pollute the machine. The fallback/rc-edit path is unit-tested via
  // chooseZshTarget directly above.
});
