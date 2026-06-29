import { describe, it, expect } from "vitest";
import { parseReferences, serializeReferences } from "./reference.js";

describe("parseReferences", () => {
  it("round-trip: parses well-formed reference file and serializes back", () => {
    const text = "PULSE_API_KEY=@pulse\nSUPABASE_URL=@supabase/acme#SUPABASE_URL\n";
    const refs = parseReferences(text);
    expect(refs).toEqual([
      { envName: "PULSE_API_KEY", ref: "pulse" },
      { envName: "SUPABASE_URL", ref: "supabase/acme#SUPABASE_URL" },
    ]);
    expect(serializeReferences(refs)).toBe(text);
  });

  it("throws on a line with a real value (not a @reference)", () => {
    expect(() => parseReferences("PULSE_API_KEY=sk-live-123")).toThrow(/line 1/);
  });

  it("skips blank lines", () => {
    const refs = parseReferences("\nPULSE_API_KEY=@pulse\n\n");
    expect(refs).toEqual([{ envName: "PULSE_API_KEY", ref: "pulse" }]);
  });

  it("skips # comment lines", () => {
    const refs = parseReferences("# this is a comment\nPULSE_API_KEY=@pulse\n");
    expect(refs).toEqual([{ envName: "PULSE_API_KEY", ref: "pulse" }]);
  });

  it("strips optional 'export ' prefix", () => {
    const refs = parseReferences("export PULSE_API_KEY=@pulse\n");
    expect(refs).toEqual([{ envName: "PULSE_API_KEY", ref: "pulse" }]);
  });

  it("throws with correct line number for invalid key", () => {
    expect(() => parseReferences("VALID=@ok\n123INVALID=@ref\n")).toThrow(/line 2/);
  });

  it("throws for invalid key naming the key in message", () => {
    expect(() => parseReferences("123BAD=@ref")).toThrow(/invalid key/);
  });

  it("error message says 'value is not a @reference' when value missing @", () => {
    expect(() => parseReferences("FOO=bar")).toThrow(/value is not a @reference/);
  });

  it("stores ref without leading @", () => {
    const refs = parseReferences("MY_KEY=@some/path#FIELD\n");
    expect(refs[0]?.ref).toBe("some/path#FIELD");
  });

  it("throws on duplicate env names", () => {
    expect(() => parseReferences("A=@one\nA=@two\n")).toThrow(/duplicate env name/);
  });
});

describe("serializeReferences", () => {
  it("emits ENV=@ref\\n for each entry in order", () => {
    const result = serializeReferences([
      { envName: "A", ref: "x" },
      { envName: "B", ref: "y/z" },
    ]);
    expect(result).toBe("A=@x\nB=@y/z\n");
  });

  it("returns empty string for empty array", () => {
    expect(serializeReferences([])).toBe("");
  });
});
