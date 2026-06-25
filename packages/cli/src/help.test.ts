import { describe, it, expect } from "vitest";
import { cmdHelp } from "./help.js";
import type { Io } from "./commands.js";

function makeIo(): Io & { stdout: string; stderr: string } {
  const io = {
    argv: [],
    stdin: "",
    env: process.env,
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

describe("cmdHelp", () => {
  it("prints usage covering every command to stdout, exit 0", async () => {
    const io = makeIo();
    expect(await cmdHelp(io)).toBe(0);
    for (const c of ["set", "ls", "run", "import", "pull", "install", "completion"]) {
      expect(io.stdout).toContain(c);
    }
    expect(io.stdout).toContain("LOCKIT_PASSPHRASE");
    expect(io.stdout).toContain("No account, no server");
    expect(io.stderr).toBe("");
  });
});
