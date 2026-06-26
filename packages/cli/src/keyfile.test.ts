import { describe, it, expect } from "vitest";
import { parseKeyfile, keychainMarker } from "./keyfile.js";

describe("parseKeyfile", () => {
  it("treats a plain base64 key as a plaintext keyfile (trimmed)", () => {
    const parsed = parseKeyfile("c29tZS1iYXNlNjQta2V5\n");
    expect(parsed).toEqual({ kind: "plaintext", key: "c29tZS1iYXNlNjQta2V5" });
  });

  it("recognizes a keychain marker and extracts service + account", () => {
    const marker = keychainMarker("dev.lockit.cli.store-key", "abc123");
    const parsed = parseKeyfile(marker);
    expect(parsed).toEqual({
      kind: "keychain",
      service: "dev.lockit.cli.store-key",
      account: "abc123",
    });
  });

  it("falls back to plaintext for malformed JSON (never loses a real key)", () => {
    const parsed = parseKeyfile('{"protection":"keychain"'); // truncated, no closing brace
    expect(parsed).toEqual({ kind: "plaintext", key: '{"protection":"keychain"' });
  });

  it("falls back to plaintext for JSON without the keychain protection field", () => {
    const parsed = parseKeyfile('{"v":1,"something":"else"}');
    expect(parsed.kind).toBe("plaintext");
  });
});

describe("keychainMarker", () => {
  it("produces a parseable, newline-terminated marker", () => {
    const marker = keychainMarker("svc", "acct");
    expect(marker.endsWith("\n")).toBe(true);
    expect(parseKeyfile(marker)).toEqual({ kind: "keychain", service: "svc", account: "acct" });
  });
});
