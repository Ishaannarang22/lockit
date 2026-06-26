import { describe, it, expect, vi } from "vitest";
import { makeAuthorize } from "./localauth.js";

describe("makeAuthorize (OS local-auth orchestration)", () => {
  it("uses the tty fallback on non-darwin platforms and never runs the OS gate", async () => {
    const runGate = vi.fn();
    const fallback = vi.fn(async () => true);
    const authorize = makeAuthorize({ platform: "linux", runGate, fallback });

    expect(await authorize("confirm")).toBe(true);
    expect(runGate).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledWith("confirm");
  });

  it("returns true on darwin when the gate authenticates (exit 0), without falling back", async () => {
    const runGate = vi.fn(async () => 0);
    const fallback = vi.fn(async () => false);
    const authorize = makeAuthorize({ platform: "darwin", runGate, fallback });

    expect(await authorize("admit GITHUB_TOKEN")).toBe(true);
    expect(runGate).toHaveBeenCalledWith("admit GITHUB_TOKEN");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("returns false on an explicit user cancel/deny (exit 2) and does NOT fall back to y/N", async () => {
    const runGate = vi.fn(async () => 2);
    const fallback = vi.fn(async () => true);
    const authorize = makeAuthorize({ platform: "darwin", runGate, fallback });

    expect(await authorize("admit")).toBe(false);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to the tty prompt when the gate cannot evaluate (exit 3)", async () => {
    const runGate = vi.fn(async () => 3);
    const fallback = vi.fn(async () => true);
    const warn = vi.fn();
    const authorize = makeAuthorize({ platform: "darwin", runGate, fallback, warn });

    expect(await authorize("admit")).toBe(true);
    expect(fallback).toHaveBeenCalledWith("admit");
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the tty prompt when the gate cannot be launched (null, no toolchain)", async () => {
    const runGate = vi.fn(async () => null);
    const fallback = vi.fn(async () => false);
    const authorize = makeAuthorize({ platform: "darwin", runGate, fallback });

    expect(await authorize("admit")).toBe(false);
    expect(fallback).toHaveBeenCalledWith("admit");
  });
});
