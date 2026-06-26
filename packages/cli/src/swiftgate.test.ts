import { describe, it, expect, vi } from "vitest";
import { runSwiftGate } from "./swiftgate.js";

describe("runSwiftGate", () => {
  it("returns null when the `swift` toolchain cannot be launched (spawn error)", async () => {
    const spawner = vi.fn(async () => ({ code: null, spawnError: true }));
    expect(await runSwiftGate("admit", spawner)).toBe(null);
  });

  it("passes the swift exit code through on success (0)", async () => {
    const spawner = vi.fn(async () => ({ code: 0, spawnError: false }));
    expect(await runSwiftGate("admit", spawner)).toBe(0);
  });

  it("passes the swift exit code through on user cancel (2)", async () => {
    const spawner = vi.fn(async () => ({ code: 2, spawnError: false }));
    expect(await runSwiftGate("admit", spawner)).toBe(2);
  });

  it("invokes the spawner with `swift`, a script path, and the reason argument", async () => {
    const spawner = vi.fn(async (_cmd: string, _args: string[]) => ({
      code: 0,
      spawnError: false,
    }));
    await runSwiftGate("confirm it's you", spawner);
    expect(spawner).toHaveBeenCalledOnce();
    const [cmd, args] = spawner.mock.calls[0]!;
    expect(cmd).toBe("swift");
    expect(args[args.length - 1]).toBe("confirm it's you");
    // a script file path precedes the reason
    expect(args.length).toBeGreaterThanOrEqual(2);
    expect(args[0]).toMatch(/\.swift$/);
  });
});
